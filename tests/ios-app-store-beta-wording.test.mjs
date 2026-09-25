import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dictionaries } from "@/app/lib/i18n/dictionaries.ts";
import { iosCopy } from "@/app/lib/i18n/ios-copy.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// App Store Review Guideline 2.2 rejects builds that present themselves as
// beta, demo, trial or pre-release software. The iOS shell loads the same
// deployment as the website, so the copy cannot be chosen on the server:
// every page renders both wordings and app/globals.css hides one of them.
// These tests guard the half of that mechanism that can silently rot -- a
// new beta phrase added outside a .zx-web-only region would ship straight
// into the App Store build with nothing to catch it.

// ---------------------------------------------------------------------------
// A minimal JSX region scanner.
//
// Source-text matching alone cannot answer the question that matters ("can
// iOS render this word?"), because the answer depends on which element the
// word sits inside. So the scan resolves containment: it tokenises JSX tags,
// matches them into a tree, and records the character ranges covered by
// elements the iOS build never paints.
// ---------------------------------------------------------------------------

function stripComments(source) {
  // Explanatory comments in this repo necessarily contain the very phrases
  // under test ("App Store Review Guideline 2.2 ... beta"), so they are
  // removed before scanning. Replaced with spaces to keep offsets stable.
  const blank = (match) => " ".repeat(match.length);
  return source
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, blank)
    .replace(/\/\*[\s\S]*?\*\//g, blank)
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, lead) => lead + " ".repeat(m.length - lead.length));
}

function skipString(src, i) {
  const quote = src[i];
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === quote) return j + 1;
    else j += 1;
  }
  return j;
}

function skipTemplate(src, i) {
  let j = i + 1;
  while (j < src.length) {
    if (src[j] === "\\") j += 2;
    else if (src[j] === "`") return j + 1;
    else if (src[j] === "$" && src[j + 1] === "{") j = matchBrace(src, j + 1);
    else j += 1;
  }
  return j;
}

/** Index just past the `}` matching the `{` at `i`. */
function matchBrace(src, i) {
  let depth = 0;
  let j = i;
  while (j < src.length) {
    const c = src[j];
    if (c === '"' || c === "'") j = skipString(src, j);
    else if (c === "`") j = skipTemplate(src, j);
    else if (c === "{") { depth += 1; j += 1; }
    else if (c === "}") { depth -= 1; j += 1; if (depth === 0) return j; }
    else j += 1;
  }
  return j;
}

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link", "source"]);

/**
 * Character ranges the App Store build never paints, i.e. the subtrees of
 * elements whose own className carries `zx-web-only`.
 *
 * Written as a lexer rather than a regex because a prop can hold JSX
 * (`title={<><span className="zx-web-only">...</span></>}`), and a regex that
 * swallows such a prop wholesale reports the OUTER element as web-only --
 * which silently marks the entire page safe. Attribute expressions are
 * recursed into instead, with `base` keeping the reported offsets absolute.
 */
function webOnlyRanges(src, base = 0) {
  const ranges = [];
  const stack = [];
  let i = 0;

  while (i < src.length) {
    if (src[i] !== "<") {
      i += 1;
      continue;
    }

    const closing = src[i + 1] === "/";
    let j = i + (closing ? 2 : 1);
    const nameStart = j;
    while (j < src.length && /[\w.]/.test(src[j])) j += 1;
    const name = src.slice(nameStart, j);

    // Not a tag: a comparison, a generic, or `<` in text.
    if (!name || !/^[A-Za-z]/.test(name)) {
      i += 1;
      continue;
    }

    if (closing) {
      const gt = src.indexOf(">", j);
      const end = gt === -1 ? src.length : gt + 1;
      for (let k = stack.length - 1; k >= 0; k -= 1) {
        if (stack[k].name !== name) continue;
        // Splice off everything above the match too: unbalanced entries are
        // generics and comparisons misread as tags, never real elements.
        const [open] = stack.splice(k, stack.length - k);
        if (open.webOnly) ranges.push([base + open.start, base + end]);
        break;
      }
      i = end;
      continue;
    }

    let className = null;
    let selfClosing = false;

    while (j < src.length) {
      const c = src[j];
      if (c === '"' || c === "'") {
        j = skipString(src, j);
      } else if (c === "`") {
        j = skipTemplate(src, j);
      } else if (c === "{") {
        const end = matchBrace(src, j);
        ranges.push(...webOnlyRanges(src.slice(j + 1, end - 1), base + j + 1));
        j = end;
      } else if (c === "/" && src[j + 1] === ">") {
        selfClosing = true;
        j += 2;
        break;
      } else if (c === ">") {
        j += 1;
        break;
      } else if (src.startsWith("className", j)) {
        let k = j + "className".length;
        while (k < src.length && /\s/.test(src[k])) k += 1;
        if (src[k] !== "=") {
          j = k;
          continue;
        }
        k += 1;
        while (k < src.length && /\s/.test(src[k])) k += 1;
        if (src[k] === '"' || src[k] === "'") {
          const end = skipString(src, k);
          className = src.slice(k + 1, end - 1);
          j = end;
        } else if (src[k] === "{") {
          const end = matchBrace(src, k);
          className = src.slice(k + 1, end - 1);
          ranges.push(...webOnlyRanges(src.slice(k + 1, end - 1), base + k + 1));
          j = end;
        } else {
          j = k;
        }
      } else {
        j += 1;
      }
    }

    const webOnly = className !== null && /zx-web-only/.test(className);
    if (selfClosing || VOID_TAGS.has(name)) {
      if (webOnly) ranges.push([base + i, base + j]);
    } else {
      stack.push({ name, start: i, webOnly });
    }
    i = j;
  }

  return ranges;
}

const insideWebOnly = (ranges, index) =>
  ranges.some(([from, to]) => index >= from && index < to);

// ---------------------------------------------------------------------------
// Which dictionary keys carry pre-release wording, in ANY locale.
// ---------------------------------------------------------------------------

// English, Turkish and German. A key is treated as pre-release wording if any
// locale's value trips one of these, so a neutral English string cannot hide
// a German "Frühzugang".
const PRERELEASE_VALUE =
  /\b(private beta|beta|early access|erken eri[şs]im|fr[üu]hzugang|invite[- ]only|invitation[- ]only|invited|davet|eingeladen|einladung|waitlist|wait list|warteliste|bekleme listesi|trial|deneme|coming soon|[çc]ok yak[ıi]nda|demalbald|developer login|geli[şs]tirici giri[şs]i|entwickler[- ]login)\b/i;

function prereleaseDictionaryKeys() {
  const source = read("app/lib/i18n/dictionaries.ts");
  const keys = new Set();
  // Values may be single- or multi-line; capture the key and everything up to
  // the next key at the same indentation.
  for (const m of source.matchAll(/^ {6}([a-zA-Z][\w]*):\s*([\s\S]*?)(?=^ {6}[a-zA-Z][\w]*:|^ {4}\},)/gm)) {
    const [, key, value] = m;
    if (PRERELEASE_VALUE.test(value)) keys.add(key);
  }
  return keys;
}

// Multi-word phrases: literal UI copy written straight into JSX. Identifiers
// are camelCase and have no spaces, so this cannot collide with code.
const PRERELEASE_PHRASE =
  /\b(private beta|beta users?|beta access|early access|invite[- ]only|invitation[- ]only|coming soon|free trial|developer login|join the waitlist)\b/i;

function isComparisonOperand(source, index) {
  const lineStart = source.lastIndexOf("\n", index) + 1;
  let lineEnd = source.indexOf("\n", index);
  if (lineEnd === -1) lineEnd = source.length;
  return /===|!==|\.includes\(|startsWith\(|toLowerCase\(\)/.test(
    source.slice(lineStart, lineEnd)
  );
}

// Keys whose only renderer is hidden wholesale on iOS: the waitlist form and
// the footer link that opens it. Test 2 proves that -- every <WaitlistForm and
// every "#waitlist" link must sit inside a .zx-web-only region -- so these
// strings need no neutral counterpart.
const WEB_ONLY_KEYS = new Set([
  "requestEarlyAccess",
  "requestAccess",
  "waitlistEyebrow",
  "waitlistTitle",
  "waitlistClose",
  "waitlistThanks",
  "waitlistName",
  "waitlistNamePlaceholder",
  "waitlistEmail",
  "waitlistEmailPlaceholder",
  "waitlistCompany",
  "waitlistCompanyPlaceholder",
  "joinWaitlist",
]);

// Every page and component the iOS shell can reach -- discovered, not listed,
// so a new screen is covered the day it is written rather than the day someone
// remembers to add it here.
function iosReachableFiles(dir, out = []) {
  for (const entry of readdirSync(new URL(`../${dir}`, import.meta.url), {
    withFileTypes: true,
  })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) {
      iosReachableFiles(path, out);
    } else if (entry.name.endsWith(".tsx") && !EXCLUDED.has(path)) {
      out.push(path);
    }
  }
  return out;
}

const EXCLUDED = new Set([
  // The mechanism itself: both of these exist to render a web wording next to
  // an iOS one, so they necessarily contain both.
  "components/PlatformCopy.tsx",
  "components/HomeLink.tsx",
  // Rendered only inside a .zx-web-only region on the landing page, which the
  // scan below asserts. Its own labels therefore never reach iOS.
  "components/WaitlistForm.tsx",
]);

const IOS_REACHABLE = [...iosReachableFiles("app"), ...iosReachableFiles("components")];

test("the App Store build has a platform switch that runs before first paint", () => {
  const css = read("app/globals.css");
  assert.match(
    css,
    /html:not\(\.zx-native-ios\)\s*\.zx-ios-only\s*\{\s*display:\s*none\s*!important/,
    "the website must hide .zx-ios-only copy"
  );
  assert.match(
    css,
    /html\.zx-native-ios\s*\.zx-web-only\s*\{\s*display:\s*none\s*!important/,
    "the App Store build must hide .zx-web-only copy"
  );

  const layout = read("app/layout.tsx");
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));
  assert.ok(head.includes("<script"), "the platform class must be set from a <head> script");
  assert.match(
    head,
    /classList\.add\("zx-native-ios"\)/,
    "the head script must add zx-native-ios"
  );
  assert.match(
    head,
    /getPlatform\(\)\s*===\s*"ios"/,
    "the class must be gated on the native iOS platform, so the website is untouched"
  );
  // A useEffect would paint the website copy first and swap it afterwards,
  // which is exactly the flash of "Private Beta" this must not produce.
  assert.ok(
    head.indexOf("zx-native-ios") < layout.indexOf("<body"),
    "the platform class must be decided before the body renders"
  );
});

test("no pre-release wording can render in the App Store build", () => {
  const prereleaseKeys = prereleaseDictionaryKeys();
  assert.ok(prereleaseKeys.size > 0, "the scan must actually find pre-release dictionary keys");

  const leaks = [];

  for (const path of IOS_REACHABLE) {
    const source = stripComments(read(path));
    const ranges = webOnlyRanges(source);

    // 1. Literal copy written into JSX.
    for (const m of source.matchAll(new RegExp(PRERELEASE_PHRASE, "gi"))) {
      if (insideWebOnly(ranges, m.index)) continue;
      // A string being compared is a protocol value, not copy: the API returns
      // "Private beta access only." as an error code and the UI matches on it
      // to choose which (dual-rendered) explanation to show.
      if (isComparisonOperand(source, m.index)) continue;
      leaks.push(`${path}: literal "${m[0].trim()}" renders on iOS`);
    }

    // 2. Dictionary lookups that resolve to pre-release wording.
    for (const m of source.matchAll(/\b(?:dictionary|labels)\.(?:\w+\.)?(\w+)\b/g)) {
      if (!prereleaseKeys.has(m[1])) continue;
      if (insideWebOnly(ranges, m.index)) continue;
      // platformCopy(x) renders x in a hidden span and iosCopy(locale, x)
      // beside it, so the reference itself is safe. The third test proves
      // iosCopy actually has a neutral counterpart for every such string.
      if (source.slice(0, m.index).endsWith("platformCopy(")) continue;
      // A collection reference: the items, not the array, are what renders.
      // The next assertion in this test pins each map body to platformCopy,
      // and the third test proves every item has a neutral counterpart.
      if (source.slice(m.index + m[0].length).startsWith(".map(")) continue;
      // Labels handed to a component that is itself web-only.
      if (WEB_ONLY_KEYS.has(m[1])) continue;
      leaks.push(`${path}: ${m[0]} renders on iOS`);
    }

    // 3. The waitlist form, and any link pointing at it.
    for (const m of source.matchAll(/<WaitlistForm\b|["']#waitlist["']/g)) {
      if (insideWebOnly(ranges, m.index)) continue;
      leaks.push(`${path}: ${m[0]} reaches iOS`);
    }
  }

  assert.deepEqual(leaks, [], `pre-release wording reachable from the App Store build:\n${leaks.join("\n")}`);
});

test("the landing page's mapped collections render their items through the platform switch", () => {
  // The scan above cannot follow an array into its map body, so the three
  // collections that hold pre-release wording are pinned explicitly. Each of
  // these is the exact expression that renders one item.
  const source = stripComments(read("app/page.tsx"));

  for (const expression of [
    "platformCopy(plan[1])", // pricing plans: the price line
    "platformCopy(plan[2])", // pricing plans: the plan description
    "platformCopy(answer)", // FAQ answers
    "platformCopy(item)", // security items
  ]) {
    assert.ok(
      source.includes(expression),
      `${expression} must render through the platform switch`
    );
  }
});

test("every locale ships the neutral replacements the iOS build renders", () => {
  const source = read("app/lib/i18n/dictionaries.ts");
  const NEUTRAL_KEYS = [
    "appAccessBadge",
    "appAccessTitle",
    "appAccessBody1",
    "appAccessBody2",
    "appAccessCta",
    "appAccessFooter",
    "appAccessDenied",
    "appAccessLabel",
  ];

  for (const key of NEUTRAL_KEYS) {
    const occurrences = [...source.matchAll(new RegExp(`^ {6}${key}:`, "gm"))];
    assert.equal(
      occurrences.length,
      3,
      `${key} must be defined in all three locales, found ${occurrences.length}`
    );
  }

  // The replacements must not themselves reintroduce the wording.
  for (const m of source.matchAll(/^ {6}(appAccess\w*):\s*([\s\S]*?)(?=^ {6}\w+:)/gm)) {
    assert.ok(
      !PRERELEASE_VALUE.test(m[2]),
      `${m[1]} must not contain pre-release wording: ${m[2].trim()}`
    );
  }
});

test("every landing string with pre-release wording has a neutral iOS counterpart", () => {
  // The strongest check here, because it runs against the real values rather
  // than the source text: whatever the landing page renders on iOS goes
  // through iosCopy(), so if a string with pre-release wording comes back
  // unchanged, the App Store build would display it.
  //
  // This is also the test that fires when someone adds new marketing copy: a
  // new "private beta" line in any of the three locales fails here until
  // app/lib/i18n/ios-copy.ts carries a neutral version of it.
  const uncovered = [];

  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    const walk = (value, path) => {
      if (typeof value === "string") {
        if (!PRERELEASE_VALUE.test(value)) return;
        // The waitlist form and its links are removed wholesale on iOS.
        if ([...WEB_ONLY_KEYS].some((key) => path.includes(`.${key}`))) return;

        const translated = iosCopy(locale, value);
        if (PRERELEASE_VALUE.test(translated)) {
          uncovered.push(`${locale}.${path}: ${JSON.stringify(value)}`);
        }
        return;
      }
      if (value && typeof value === "object") {
        for (const [key, child] of Object.entries(value)) {
          walk(child, path ? `${path}.${key}` : key);
        }
      }
    };

    walk(dictionary.landing, "landing");
  }

  assert.deepEqual(
    uncovered,
    [],
    `landing copy with no neutral iOS wording:\n${uncovered.join("\n")}`
  );
});

test("the neutral iOS wording never reintroduces pre-release framing", () => {
  // Guards the replacement side: an override that still says "beta" would
  // pass the test above only by accident of phrasing.
  for (const [locale, dictionary] of Object.entries(dictionaries)) {
    for (const value of [
      dictionary.auth.appAccessBadge,
      dictionary.auth.appAccessTitle,
      dictionary.auth.appAccessBody1,
      dictionary.auth.appAccessBody2,
      dictionary.auth.appAccessCta,
      dictionary.auth.appAccessFooter,
      dictionary.auth.appAccessDenied,
      dictionary.auth.appAccessLabel,
    ]) {
      assert.ok(
        !PRERELEASE_VALUE.test(value),
        `${locale}: neutral copy must not use pre-release wording: ${value}`
      );
    }
  }
});

// ---------------------------------------------------------------------------
// The App Store build's entry point.
//
// Guideline 2.2 is not only about words: an installed application that opens
// on its own public marketing site, complete with a waitlist, reads as
// pre-release regardless of the copy. These tests pin the two halves that
// keep iOS out of the landing page -- the cold-launch redirect and the in-app
// links -- because each one covers a case the other structurally cannot.
// ---------------------------------------------------------------------------

test("a cold launch on iOS lands on the sign-in screen, not the marketing page", () => {
  const layout = read("app/layout.tsx");
  const head = layout.slice(layout.indexOf("<head>"), layout.indexOf("</head>"));

  assert.match(
    head,
    /location\.pathname\s*===\s*"\/"/,
    "the redirect must be scoped to the landing route, so deep links are untouched"
  );
  assert.match(
    head,
    /location\.replace\("\/login"\)/,
    "iOS must be sent to /login, and with replace() so there is no history entry back onto the marketing page"
  );
  // Inside the platform check: the website must never redirect.
  const iosBranch = head.slice(head.indexOf('getPlatform()==="ios"'));
  assert.ok(
    iosBranch.includes('location.replace("/login")'),
    "the redirect must sit inside the native-iOS branch"
  );
});

test("no page inside the app links the user to the public marketing page", () => {
  // The cold-launch redirect is an inline <head> script, so it runs on a full
  // document load only -- a next/link navigation to "/" never reaches it. Every
  // such link therefore goes through HomeLink, which renders the web target and
  // the iOS target and lets CSS choose, with no script involved.
  const homeLink = read("components/HomeLink.tsx");
  assert.match(homeLink, /zx-web-only[\s\S]*?href="\/login"|href="\/"[\s\S]*?zx-ios-only/, "HomeLink must render both targets");
  assert.match(
    homeLink,
    /<Link href="\/login" className={`zx-ios-only/,
    "HomeLink's iOS target must be /login"
  );
  assert.match(
    homeLink,
    /<Link href="\/" className={`zx-web-only/,
    "HomeLink's web target must stay the landing page"
  );

  const offenders = [];
  for (const path of [
    "components/AuthShell.tsx", // /login and /register
    "app/privacy/page.tsx",
    "app/delete-account/page.tsx",
    "app/delete-account/deleted/page.tsx",
  ]) {
    const source = stripComments(read(path));
    for (const m of source.matchAll(/href="\/"/g)) {
      offenders.push(`${path}: a bare href="/" at ${m.index} bypasses HomeLink`);
    }
  }

  assert.deepEqual(offenders, [], offenders.join("\n"));
});
