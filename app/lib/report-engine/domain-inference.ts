import type { ReportDomain } from "./domain.ts";
import { planFields } from "./prompts/plan.ts";
import { realEstateFields } from "./prompts/real-estate.ts";
import { domainAnalysisFields } from "./prompts/domain-analysis.ts";
import { acquisitionAnalysisFields } from "./prompts/acquisition-analysis.ts";

// CRITICAL FIX -- dual report generation / mismatched report identity.
// Confirmed live: an acquisition prompt could render a "Business Plan
// Report" placeholder and then complete with mismatched or missing
// content. Root cause was never the backend generator dispatch (that has
// always been a strict if/else-if chain of early returns in
// plan-executor.ts -- structurally exclusive, only one generator can ever
// run per request) -- it was the CLIENT's own report identity (title,
// output-field shape, PDF template) being decided from a classification
// pathway that can disagree with the worker's authoritative domain: in
// "chat" mode the client's pre-fetch guess depends on the LLM-based
// /api/understanding call's expertiseProfile.domain, which can
// misclassify an ambiguous or borderline prompt, while the backend
// generator that actually ran is determined server-side from the
// deterministic classifyReportDomain regex plus the resolved expertise
// profile (see app/lib/report-jobs/plan-executor.ts's dispatcher). When
// the two disagree, none of the client's guessed output fields match any
// field the worker actually persisted -- every report schema in this
// codebase deliberately shares zero field names with any other (see
// report-isolation-validator.ts and the acquisition/business field-
// overlap regression tests) -- so the UI would either show the wrong
// title over content it can't parse, or fail outright.
//
// Inspired by app/lib/report-jobs/worker.ts's own inferDomain, which uses
// the same "distinguishing fields" idea as its last-resort fallback (when
// neither the report-event stream's own authoritative reportDomain chunk
// nor the request payload's reportDomain is available) -- extracted here
// as a single shared, isomorphic source of truth so the client can self-
// correct against the same underlying idea the worker already trusts,
// rather than maintaining a second, potentially-drifting copy of it. Each
// domain's distinguishing set below is computed against ALL THREE other
// domains, not just one -- worker.ts's own version only ever subtracted
// planFields from realEstateFields, so a field real_estate happens to
// share with the *shared* legal/finance/accounting/operations/procurement
// schema (domainAnalysisFields) -- "missingInformation",
// "finalRecommendation", "sources" -- was left in as a false
// "distinguishing" real_estate field, which (since real_estate is checked
// first) could misclassify a Legal/Finance-only field set as real_estate
// whenever this fallback ever actually runs. Not a fix to worker.ts
// itself (out of scope, and worker.ts already has two more reliable
// signals checked ahead of this fallback) -- just built correctly here,
// where this module's only purpose is exactly this comparison.
const realEstateDistinguishingFields = realEstateFields.filter(
  (field) =>
    !(planFields as readonly string[]).includes(field) &&
    !(domainAnalysisFields as readonly string[]).includes(field) &&
    !(acquisitionAnalysisFields as readonly string[]).includes(field)
);
const domainAnalysisDistinguishingFields = domainAnalysisFields.filter(
  (field) =>
    !(planFields as readonly string[]).includes(field) &&
    !(realEstateFields as readonly string[]).includes(field) &&
    !(acquisitionAnalysisFields as readonly string[]).includes(field)
);
const acquisitionAnalysisDistinguishingFields = acquisitionAnalysisFields.filter(
  (field) =>
    !(planFields as readonly string[]).includes(field) &&
    !(realEstateFields as readonly string[]).includes(field) &&
    !(domainAnalysisFields as readonly string[]).includes(field)
);

// Never returns "market": Market Intelligence has its own dedicated
// pipeline, schema, and routing (checked first, independently, wherever
// this is called) and is out of scope for this field-based fallback.
export function inferReportDomainFromFieldNames(
  fieldNames: readonly string[]
): ReportDomain {
  const fieldSet = new Set(fieldNames);

  if (realEstateDistinguishingFields.some((field) => fieldSet.has(field))) {
    return "real_estate";
  }

  if (acquisitionAnalysisDistinguishingFields.some((field) => fieldSet.has(field))) {
    return "acquisition";
  }

  if (domainAnalysisDistinguishingFields.some((field) => fieldSet.has(field))) {
    return "legal";
  }

  return "business";
}
