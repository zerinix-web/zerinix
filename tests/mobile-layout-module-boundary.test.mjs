import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const layout = read("components/mobile-layout.ts");
const navigation = read("components/MobileNavigation.tsx");

const CONSTANTS = ["MOBILE_SAFE_AREA_TOP", "MOBILE_NAV_CLEARANCE", "MOBILE_SCROLLER_TAIL"];
const isClientModule = (source) => /^\s*["']use client["']/.test(source);

// Every file that uses any of the constants.
const CONSUMERS = [
  "components/AIChatWorkspace.tsx",
  "components/MobileNavigation.tsx",
  "components/mobile/MobileAccountHome.tsx",
  "components/mobile/MobileHomeDashboard.tsx",
  "components/mobile/MobileReportsHome.tsx",
  "components/mobile/MobileWorkspaceDetail.tsx",
  "components/mobile/MobileWorkspaceHome.tsx",
];

test("the layout constants live in a module server components can actually import", () => {
  // THE DEFECT THIS GUARDS, measured on a physical iPhone against production:
  // these constants used to be exported from MobileNavigation.tsx, a
  // "use client" module. A server component importing a non-component export
  // from a client module does not get the value -- Next.js substitutes a
  // client-reference proxy. Interpolating that proxy into a template literal
  // does not throw; it serialises the proxy's SOURCE TEXT into the class
  // attribute. Home's scroll container shipped as:
  //
  //   class="px-4 pt-6 function(){throw Error("Attempted to call
  //          MOBILE_SCROLLER_TAIL() from "
  //
  // so the padding utility never existed, padding-bottom computed to 0px, and
  // the scroll range collapsed to 13px. No CSS or structural test could see
  // this: the stylesheet, the DOM tree and the constants were all correct.
  assert.ok(
    !isClientModule(layout),
    'components/mobile-layout.ts must NOT be a client module'
  );
  for (const name of CONSTANTS) {
    assert.match(layout, new RegExp(`export const ${name}`), `${name} must be defined here`);
  }
});

test("no screen imports the constants from a client module", () => {
  for (const path of CONSUMERS) {
    const source = read(path);

    for (const match of source.matchAll(/import \{([^}]*)\} from "([^"]+)";/g)) {
      const [, names, from] = match;
      const imported = CONSTANTS.filter((name) => names.includes(name));
      if (imported.length === 0) continue;

      assert.equal(
        from,
        "@/components/mobile-layout",
        `${path} must import ${imported.join(", ")} from the plain module, not ${from}`
      );
    }
  }
});

test("the navigation component does not re-export them", () => {
  // A re-export from this "use client" module would hand server components the
  // same broken proxy again, through a different import path.
  assert.ok(isClientModule(navigation), "the navigation is still a client component");
  for (const name of CONSTANTS) {
    assert.doesNotMatch(
      navigation,
      new RegExp(`export (?:const|\\{[^}]*)\\s*${name}`),
      `${name} must not be exported from a client module`
    );
  }
});

test("the shared module stays inert, so it can never become client-only", () => {
  // No hooks, no JSX, no browser globals -- nothing that would tempt someone
  // to add "use client" and silently reintroduce the bug.
  for (const forbidden of [/use(?:State|Effect|Ref|Router)\s*\(/, /<[A-Za-z]/, /\bwindow\./, /\bdocument\./]) {
    assert.doesNotMatch(layout, forbidden);
  }
  // Values only.
  for (const name of CONSTANTS) {
    assert.match(layout, new RegExp(`export const ${name}[\\s\\S]{0,120}?"[^"]+"`));
  }
});

test("every mobile screen that renders under the bar still consumes them", () => {
  // The constants reaching the DOM is the point; this keeps the consumer list
  // honest if a screen is added or renamed.
  const screens = readdirSync(new URL("../components/mobile", import.meta.url))
    .filter((file) => file.endsWith(".tsx"));

  for (const file of screens) {
    const source = read(`components/mobile/${file}`);
    if (!CONSTANTS.some((name) => source.includes(name))) continue;

    assert.match(
      source,
      /from "@\/components\/mobile-layout"/,
      `components/mobile/${file} must take them from the plain module`
    );
  }
});
