import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyReportDomain,
  resolveReportDomainForSelectedMode,
} from "../app/lib/report-engine/domain.ts";
import { createExpertiseProfileFallback } from "../app/lib/ai/expertise-profile.ts";

// Reproduces a real, confirmed production bug: a Business Idea Validation
// prompt describing an AI SaaS platform that reduces commercial-building
// energy costs was routed to the real-estate investment-analysis report
// (zoning, parcel, title deed, municipality, cadastral content) instead of
// the Business Idea report. Root cause was two-fold:
//   1. expertise-profile.ts's own realEstateSignals regex listed
//      "office building"/"commercial building" as real-estate triggers --
//      words that describe WHAT a business serves, not that the request
//      is itself a property/land transaction.
//   2. resolveReportDomainForSelectedMode let ANY upstream real-estate
//      signal (however it was produced) override the user's own explicit
//      "plan" (Business Idea Validation) selection.
// The fix removes the two over-broad keywords AND makes "plan" (like
// "market" already did) unconditionally resolve to "business", so this
// class of misrouting is structurally impossible regardless of what any
// upstream classifier -- current or future -- infers.

const domainSource = readFileSync("app/lib/report-engine/domain.ts", "utf8");
const expertiseProfileSource = readFileSync("app/lib/ai/expertise-profile.ts", "utf8");

const businessIdeaPrompts = [
  "I'm building an AI SaaS platform that helps commercial building owners reduce energy costs using IoT sensors and HVAC optimization software.",
  "An AI-driven SaaS platform that helps commercial building owners cut energy costs through smart HVAC and IoT-based facility management.",
  "I'm building a property management SaaS platform for landlords managing 5-50 residential units, handling maintenance requests and rent collection.",
  "HVAC field service management platform for repair companies handling dispatch, scheduling, and invoicing.",
  "A facility management SaaS platform that uses IoT and AI to optimize energy consumption across a portfolio of commercial buildings.",
  "I'm building a coworking space management platform handling member billing, meeting room booking, and access control for small operators.",
];

test("classifyReportDomain never classifies a commercial-building / energy / IoT / HVAC / facility / property-management SaaS idea as real_estate", () => {
  for (const prompt of businessIdeaPrompts) {
    const domain = classifyReportDomain(prompt);
    assert.equal(domain, "business", `expected "business" for: ${prompt}`);
  }
});

test("resolveReportDomainForSelectedMode always returns \"business\" for Business Idea Validation (\"plan\"), regardless of what any upstream classifier infers", () => {
  for (const prompt of businessIdeaPrompts) {
    const inferredDomain = classifyReportDomain(prompt);

    // Even if some upstream signal (client-supplied reportReadiness, an
    // AI-driven /understanding call, or a future classifier bug) resolves
    // the expertise domain to "real_estate", "plan" mode must still
    // resolve to "business" -- this is the actual bulletproof fix.
    for (const expertiseDomain of [undefined, "business", "real_estate", "legal"]) {
      const reportDomain = resolveReportDomainForSelectedMode({
        selectedMode: "plan",
        inferredDomain,
        expertiseDomain,
      });

      assert.equal(
        reportDomain,
        "business",
        `expected "business" for prompt="${prompt}" expertiseDomain=${expertiseDomain}`
      );
    }
  }
});

test("createExpertiseProfileFallback never resolves a commercial-building / energy SaaS prompt to the real_estate expertise domain under Business Idea Validation", () => {
  for (const prompt of businessIdeaPrompts) {
    const profile = createExpertiseProfileFallback({
      prompt,
      selectedMode: "plan",
      detectedDomain: classifyReportDomain(prompt),
    });

    assert.equal(profile.domain, "business", `expected "business" domain for: ${prompt}`);
  }
});

test("Strategic Advisory (\"chat\") for a genuine real-estate acquisition request is unaffected by this fix", () => {
  const genuineRealEstatePrompt =
    "I am evaluating buying a 6,000 sqm parcel of land with title deed and zoning approval for long-term rental income.";
  const inferredDomain = classifyReportDomain(genuineRealEstatePrompt);

  assert.equal(inferredDomain, "real_estate");
  assert.equal(
    resolveReportDomainForSelectedMode({
      selectedMode: "chat",
      inferredDomain,
      expertiseDomain: "real_estate",
    }),
    "real_estate"
  );
});

test("expertise-profile.ts's realEstateSignals regex no longer lists office building / commercial building as real-estate triggers (drift check)", () => {
  assert.doesNotMatch(expertiseProfileSource, /office building\|commercial building/);
  assert.match(
    expertiseProfileSource,
    /real\[\\s-\]\?estate\|property\|land\|parcel\|title deed\|deed\|cadastr\|zoning\|investment property\)/
  );
});

test("resolveReportDomainForSelectedMode unconditionally returns business for real_estate/legal/finance/etc under plan/market modes, with a single deliberate exception for acquisition under plan (drift check)", () => {
  // "market" is still an unconditional return -- unaffected by the
  // acquisition exception, which is scoped to "plan" only (confirmed
  // product decision: Market Intelligence never consults this function's
  // return value for routing in the first place, since its own pipeline
  // short-circuits before reportDomain-based branching runs).
  assert.match(
    domainSource,
    /if \(selectedMode === "market"\) \{\s*return "business";\s*\}/
  );
  // "plan" now has exactly one named exception (acquisition); every other
  // inferredDomain value still unconditionally resolves to "business".
  assert.match(
    domainSource,
    /if \(selectedMode === "plan"\) \{\s*return inferredDomain === "acquisition" \? "acquisition" : "business";\s*\}/
  );
  assert.doesNotMatch(domainSource, /hasRealEstateDomain/);
});
