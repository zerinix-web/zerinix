import type { ExecutiveDecisionCode } from "@/app/lib/report-engine/executive-decision-brief";
import type { ResponseLanguage } from "@/app/lib/report-engine/schema";

// Hard-fail safety net for the "single Executive Decision layer" principle:
// when the authoritative decision is NO_GO, no other freeform, AI-authored
// section may still recommend piloting, scaling, entering, or proceeding.
// Deliberately one-directional -- GO/CONDITIONAL_GO recommending an action
// is expected and not itself a contradiction; only a NO_GO report that
// still tells the reader to move forward is the failure mode this guards
// against. Follows the same find*/assert* convention as
// report-isolation-validator.ts / executive-quality-gate.ts.

export type DecisionContradiction = {
  field: string;
  phrase: string;
  excerpt: string;
};

const affirmativeActionPatterns: Record<ResponseLanguage, RegExp[]> = {
  English: [
    /\b(?:start|run|launch|begin)(?:s|ed|ing)?\s+a\s+pilot\b/i,
    /\bpilot\s+program\b/i,
    /\bscale(?:s|d|ing)?\s+(?:up|the\s+business|operations|this\s+market)\b/i,
    /\bproceed(?:s|ed|ing)?\s+with\b/i,
    /\bgo[\s-]?ahead\b/i,
    /\benter(?:s|ed|ing)?\s+(?:the|this)\s+market\b/i,
    /\bprioritize\s+entry\b/i,
    /\bexpand(?:s|ed|ing)?\s+into\s+this\s+market\b/i,
    /\bbegin(?:s|ning)?\s+execution\b/i,
    /\brecommend(?:s|ed|ing)?\s+(?:immediate\s+)?execution\b/i,
    /\bcommit(?:s|ted|ting)?\s+(?:budget|capital|investment|resources|funding)\s+to\s+this\s+market\b/i,
    /\bmove\s+forward\s+with\b/i,
    /\binvest(?:s|ed|ing)?\s+in\s+this\s+market\b/i,
  ],
  // Note: JS regex `\b`/`\w` are ASCII-only, so a leading `\b` placed
  // directly before a Turkish-specific letter (ö, ı, ş, ğ, ü, ç) can never
  // match -- the position right before that letter is never a valid word
  // boundary because neither side is an ASCII word character. Patterns
  // below either start on an ASCII letter or omit the leading `\b`.
  // "büyüt(me)"/"ölçeklendir(me)" -- the bare gerund/infinitive-as-noun
  // form ("büyütme kararı", "ölçeklendirme önerilmemektedir") is almost
  // always meta-discussion of the concept, not a command to do it; only
  // an actual imperative/obligation form (büyütün, büyütmeli,
  // ölçeklendirin, ...) is a real recommendation. The negative lookahead
  // excludes the bare gerund while still matching those inflections.
  Turkish: [
    /\bpilot\b[^.!?\n]{0,30}\b(?:başlat|yürüt|çalıştır)\w*\b/i,
    /ölçeklendir(?!me\b|meye\b|menin\b|meden\b)\w*\b/i,
    /\bbüyüt(?!me\b|meye\b|menin\b|meden\b)\w*\b/i,
    /\bdevam\s+ed\w*\b/i,
    /\bpazara\s+gir(?:in|ilmeli|ilsin)?\b/i,
    /\bgirişe\s+öncelik\s+ver\w*\b/i,
    /\buygulamaya\s+geç\w*\b/i,
    /\byürütmeye\s+başla\w*\b/i,
  ],
  German: [
    /\beinen\s+piloten\s+starten\b/i,
    /\bskalieren\b/i,
    /\bfortfahren\s+mit\b/i,
    /\bin\s+den\s+markt\s+eintreten\b/i,
    /\bmarkteintritt\s+priorisieren\b/i,
  ],
  French: [
    /\blancer\s+un\s+pilote\b/i,
    /\bmettre\s+à\s+l'échelle\b/i,
    /\bprocéder\b/i,
    /\bentrer\s+sur\s+le\s+marché\b/i,
  ],
  Spanish: [
    /\biniciar\s+un\s+piloto\b/i,
    /\bescalar\b/i,
    /\bproceder\b/i,
    /\bentrar\s+en\s+el\s+mercado\b/i,
  ],
};

// If a sentence containing an otherwise-banned phrase also contains a
// negation marker, it's read as declining the action (e.g. "Do not start a
// pilot"), not recommending it -- so it is never a contradiction.
const negationMarkers: Record<ResponseLanguage, RegExp> = {
  English:
    /\b(?:do not|does not|did not|should not|must not|will not|won't|never|not recommended|not until|no longer|avoid(?:s|ed|ing)?|no\s+(?:entry|pilot|expansion))\b/i,
  // "önerilmez"/"önerilmiyor"/etc. start with a Turkish-specific letter
  // (ö), so they can't sit inside a shared leading-`\b` group -- see the
  // note on affirmativeActionPatterns.Turkish above. Matched without a
  // leading boundary instead. "öneril\w*me\w*" generically covers any
  // negative conjugation of "recommend" (önerilmez, önerilmiyor,
  // önerilmemektedir, önerilmemeli, ...) rather than enumerating each
  // conjugation by hand. "koşuluyla"/"şartıyla"/"takdirde" are Turkish
  // conditional particles ("only on condition that...") -- unlike "ancak"
  // (too generic a contrast word to safely treat as a decline: "enter the
  // market, ancak be careful" still recommends entering), these are
  // specific enough that a sentence containing one reliably gates an
  // action on a condition rather than recommending it outright.
  Turkish:
    /\b(?:değil|olmamalı|yapılmamalı|ayrılmamalı|ayırmayın|tavsiye edilmez|kaçın\w*|sürece|kadar|koşuluyla|şartıyla|takdirde)\b|öneril\w*me\w*|önerilmez|önerilmiyor/i,
  German: /\b(?:nicht|kein\w*|vermeiden)\b/i,
  French: /\b(?:ne\s+\w+\s+pas|n'\w+\s+pas|éviter)\b/i,
  Spanish: /\b(?:no\s+\w+|evitar)\b/i,
};

function splitSentences(text: string): string[] {
  return (text || "")
    .split(/(?<=[.!?\n])\s+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

export function findDecisionContradictions(
  decision: ExecutiveDecisionCode,
  sections: Partial<Record<string, string>>,
  fields: string[],
  language: ResponseLanguage
): DecisionContradiction[] {
  if (decision !== "NO_GO") return [];

  const patterns = affirmativeActionPatterns[language] || affirmativeActionPatterns.English;
  const negation = negationMarkers[language] || negationMarkers.English;
  const violations: DecisionContradiction[] = [];

  for (const field of fields) {
    const content = sections[field];
    if (!content) continue;

    for (const sentence of splitSentences(content)) {
      if (negation.test(sentence)) continue;

      for (const pattern of patterns) {
        const match = sentence.match(pattern);
        if (match) {
          violations.push({ field, phrase: match[0], excerpt: sentence.slice(0, 160) });
        }
      }
    }
  }

  return violations;
}

export class DecisionContradictionError extends Error {
  violations: DecisionContradiction[];

  constructor(violations: DecisionContradiction[]) {
    const summary = violations.map((v) => `${v.field}: "${v.phrase}"`).join("; ");
    super(`Report contradicts its own NO_GO decision (${violations.length} issue(s)): ${summary}`);
    this.name = "DecisionContradictionError";
    this.violations = violations;
  }
}

export function assertNoDecisionContradiction(
  decision: ExecutiveDecisionCode,
  sections: Partial<Record<string, string>>,
  fields: string[],
  language: ResponseLanguage
): void {
  const violations = findDecisionContradictions(decision, sections, fields, language);
  if (violations.length > 0) {
    throw new DecisionContradictionError(violations);
  }
}
