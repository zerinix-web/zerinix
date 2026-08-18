import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { sanitizeAiResponseText } from "../app/lib/ai/response-sanitization.ts";
import {
  localizePdfPresentationText,
} from "../app/lib/pdf-normalization.mjs";
import { dedupeReportParagraphsAcrossSections } from "../app/lib/report-content-quality.mjs";
import { labelModelDerivedFinancialClaims } from "../app/lib/report-engine/financial-claim-labeling.ts";

test("Turkish chat output removes remaining English presentation labels", () => {
  const output = sanitizeAiResponseText([
    "Recommendation: Bekle",
    "Why: İmar durumu doğrulanmadı.",
    "Key Risks: Tapu ve erişim belirsiz.",
    "Immediate Actions: Resmî belgeleri inceleyin.",
    "Next Actions: Emsal araştırmasını tamamlayın.",
    "Validation Required",
    "AI Analysis",
    "Estimated",
  ].join("\n"));

  assert.doesNotMatch(
    output,
    /Recommendation|\bWhy\b|Immediate Actions|Next Actions|Validation Required|AI Analysis|Estimated/i
  );
  assert.match(output, /TAVS[İi]YE: Bekle/i);
  assert.match(output, /Gerekçe: İmar durumu doğrulanmadı/);
  assert.match(output, /Acil Adımlar/);
});

test("Turkish PDF output naturalizes unavailable values and removes fake bare market metrics", () => {
  const output = localizePdfPresentationText([
    "Recommendation: Bekle",
    "Why: Yeterli doğrulanmış veri yok.",
    "TAM=3",
    "Değerleme sağlanmadı; mevcut kanıtlardan hesaplanamaz.",
  ].join("\n"), "tr");

  assert.doesNotMatch(output, /Recommendation|\bWhy\b|TAM\s*[=:]\s*3/i);
  assert.match(output, /TAVS[İi]YE: Bekle/i);
  assert.match(output, /TAM: Hesaplanamadı/);
  assert.match(output, /Veri bulunamadı/);
});

test("duplicate recommendations become one concise cross-reference", () => {
  const recommendation =
    "Yönetici Tavsiyesi: Resmî imar, temiz tapu ve yasal erişim doğrulanana kadar sermaye taahhüdünde bulunmayın; doğrulama olumluysa yatırımı yeniden değerlendirin.";
  const report = dedupeReportParagraphsAcrossSections({
    executiveSummary: recommendation,
    executiveRecommendation: recommendation.replace("Yönetici Tavsiyesi", "Tavsiye"),
  });

  assert.equal(report.executiveSummary, recommendation);
  assert.equal(
    report.executiveRecommendation,
    "Birleştirilmiş değerlendirme Yönetici Özeti bölümünde sunulmuştur."
  );
});

test("Turkish report output replaces raw missing values with contextual explanations", () => {
  const output = sanitizeAiResponseText([
    "Değerleme: null",
    "Yatırım hedefi: Not provided",
    "İmar belgesi: undefined",
    "Konum: N/A",
    "Executive Summary: Karar için mevcut bilgiler değerlendirildi.",
  ].join("\n"));

  assert.doesNotMatch(output, /\b(?:null|undefined|N\/?A|Not provided|Executive Summary)\b/i);
  assert.match(output, /Değerleme: Yeterli veri olmadığı için hesaplanamadı/);
  assert.match(output, /Yatırım hedefi: Kullanıcı tarafından belirtilmemiş/);
  assert.match(output, /İmar belgesi: Doğrulanmış kayıt mevcut değil/);
  assert.match(output, /Yönetici Özeti/);
});

test("missing financial metrics use metric-specific Turkish explanations", () => {
  const output = labelModelDerivedFinancialClaims({
    content: [
      "ARR: 2 milyon dolar",
      "CAC: 5.000 dolar",
      "TAM: 3 milyar dolar",
      "Brüt marj: %58",
    ].join("\n"),
    metricValues: ["ARR", "CAC", "TAM", "Brüt marj"],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  assert.doesNotMatch(output, /sağlanmadı; mevcut kanıtlardan hesaplanamaz/i);
  // Each explanation states why the metric is missing, what evidence
  // is absent, and what the founder should collect next -- not a bare
  // one-line placeholder repeated identically across metrics.
  assert.match(output, /ARR: gerçekleşmiş gelir verisi bulunmadığı için hesaplanamıyor; kurucunun fatura\/ödeme kayıtlarından gerçekleşmiş gelir verisini paylaşması gerekir/);
  assert.match(output, /CAC: gerçek müşteri edinimi ve elde tutma verisi bulunmadığı için hesaplanamıyor; kurucunun kanal başına edinim maliyeti ve kohort elde tutma kayıtlarını toplaması gerekir/);
  assert.match(output, /TAM: doğrulanmış pazar büyüklüğü verisi bulunmadığı için hesaplanamıyor; sektör raporu veya resmi istatistik gibi doğrulanmış kaynaklar gerekir/);
  assert.match(output, /Brüt marj: gerçekleşmiş gelir ve maliyet verisi bulunmadığı için hesaplanamıyor; kurucunun birim maliyet ve satış fiyatı verisini paylaşması gerekir/);
});

test("unrelated lines that only coincidentally share the same trailing value are never merged", () => {
  // Reproduces a real bug: businessModel and benchmark.label can fall
  // back to the exact same generic string when nothing in the prompt
  // matches a specific industry, so "Industry benchmark: X" and
  // "Business model: X" ended up with an identical line ending -- the
  // consolidation pass must never merge these, since they are two
  // completely different, legitimate assumption entries that were
  // never generated as an unavailable-data explanation.
  const output = labelModelDerivedFinancialClaims({
    content: [
      "• Industry benchmark: Genel Hizmetler",
      "• İş modeli: Genel Hizmetler",
      "• Hedef müşteri: öngörülen ilk kullanıcılar",
    ].join("\n"),
    metricValues: [],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  assert.match(output, /• Industry benchmark: Genel Hizmetler/);
  assert.match(output, /• İş modeli: Genel Hizmetler/);
  assert.doesNotMatch(output, /Industry benchmark, /);
  assert.doesNotMatch(output, /,\s*İş modeli:/);
});

test("identical missing-data explanations within one section are consolidated instead of repeated", () => {
  const output = labelModelDerivedFinancialClaims({
    content: [
      "CAC: 5.000 dolar",
      "LTV: 12.000 dolar",
      "Geri ödeme süresi: 4 ay",
    ].join("\n"),
    metricValues: ["CAC", "LTV", "Geri ödeme süresi"],
    language: "Turkish",
    sourceContext: "Yeni bir iş fikrini değerlendiriyorum.",
  });

  const occurrences = output.match(/kurucunun kanal başına edinim maliyeti/g) || [];
  assert.equal(occurrences.length, 1, "the shared explanation must appear once, not once per metric");
  assert.match(output, /^CAC, LTV, Geri ödeme süresi: /m);
});

test("a genuinely High Risk Financial Quality status is never silently downgraded to Needs Validation by PDF normalization", () => {
  // Reproduces a real production bug found via live report generation:
  // localizePdfPresentationText had a blind `.replace(/\bHigh Risk\b/g,
  // "Needs Validation")` with no scoping. "High Risk" is not an internal
  // implementation label -- it is one of exactly three legitimate,
  // deterministically-computed FinancialQuality values (financial-model.ts:
  // Healthy | Needs Validation | High Risk), and the only place that text
  // appears anywhere in the codebase. The blind replace silently
  // reclassified every genuinely High Risk report as the weaker "Needs
  // Validation" -- a real financial-consistency/accuracy bug, not a
  // cosmetic one, since a founder reading the PDF would see a materially
  // different (and false) risk signal.
  const output = localizePdfPresentationText(
    "Financial Quality:\n- Status: High Risk\nFinancial Warnings:\n- Capital efficiency requires validation. (AI Planning Assumption)",
    "en"
  );

  assert.match(output, /Status: High Risk/);
  assert.doesNotMatch(output, /Status: Needs Validation/);
  // The same bug's blind text-mangling also truncated the adjacent
  // evidence-type label, dropping "Planning" from "AI Planning
  // Assumption" -- confirmed to share the same root cause.
  assert.match(output, /\(AI Planning Assumption\)/);
});

test("a genuinely Yüksek Risk Financial Quality status is never silently downgraded to Doğrulama Gerekli by PDF normalization", () => {
  const output = localizePdfPresentationText(
    "Finansal Kalite:\n- Durum: Yüksek Risk\nFinansal Uyarılar:\n- Sermaye verimliliği doğrulama gerektiriyor. (AI Planlama Varsayımı)",
    "tr"
  );

  assert.match(output, /Yüksek Risk/);
  assert.doesNotMatch(output, /Durum: Doğrulama Gerekli/);
});

test("English default unavailable copy never leaks the raw 'not provided' / 'cannot be calculated' status strings", () => {
  const output = labelModelDerivedFinancialClaims({
    content: ["Some Unlabeled Figure: $2M"].join("\n"),
    metricValues: ["$2M"],
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(output, /not provided/i);
  assert.doesNotMatch(output, /cannot be calculated from available evidence/i);
  // The generic fallback now embeds the field's own label so two
  // different unmatched fields never produce byte-identical text (see
  // the dedicated "no verbatim-repeated fallback sentence" test below).
  assert.match(output, /Some Unlabeled Figure requires verified supporting data before this can be shown/i);
});

test("two different fields that both fall through to the generic fallback never produce byte-identical unavailable text", () => {
  // Reproduces a real production bug found via live report generation:
  // the same bare fallback sentence ("requires additional verified data
  // before this can be shown") appeared verbatim 6+ times across one
  // real PDF (Scenario Analysis, WTP, Revenue, Next 30 Days, Next 6
  // months), because every field label that didn't match one of the
  // narrow financial-metric categories fell through to one shared,
  // generic constant with no per-field variation at all.
  const wtpOutput = labelModelDerivedFinancialClaims({
    content: "WTP: $500k",
    metricValues: ["$500k"],
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });
  const nextStepsOutput = labelModelDerivedFinancialClaims({
    content: "Next 30 Days: $500k",
    metricValues: ["$500k"],
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.notEqual(wtpOutput, nextStepsOutput);
  // WTP is a known category (willingness to pay is grouped with CAC/LTV
  // as a customer-acquisition-evidence concept); "Next 30 Days" matches
  // no category and hits the generic, label-embedding fallback.
  assert.match(wtpOutput, /requires real customer acquisition and retention data/i);
  assert.match(nextStepsOutput, /Next 30 Days requires verified supporting data/i);
});

test("a line about the already-established buyer/beachhead reuses the known fact instead of claiming it is unavailable", () => {
  const businessModelOutput = labelModelDerivedFinancialClaims({
    content: ["Who pays: $150/month subscription fee from the buyer"].join("\n"),
    metricValues: ["$150/month"],
    knownFacts: { buyer: "B2B / enterprise customers", beachhead: "B2B / enterprise customers" },
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(businessModelOutput, /requires additional verified data/i);
  assert.match(businessModelOutput, /^Who pays: B2B \/ enterprise customers$/m);

  const gtmOutput = labelModelDerivedFinancialClaims({
    content: ["Beachhead positioning: targeting a $500k pilot cohort"].join("\n"),
    metricValues: ["$500k"],
    knownFacts: { buyer: "B2B / enterprise customers", beachhead: "B2B / enterprise customers" },
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(gtmOutput, /requires additional verified data/i);
  assert.match(gtmOutput, /^Beachhead positioning: B2B \/ enterprise customers$/m);
});

test("businessModel/goToMarketPlan reuse the known buyer/beachhead fact even when the model labels the line something other than 'Who pays'/'Beachhead positioning'", () => {
  // Reproduces a real production bug found via live report generation:
  // the model does not reliably prefix these lines with the exact
  // concept name -- it just as often writes "Revenue mechanics:" or
  // "İş Modeli:" for the same underlying concept. knownFactForLabel only
  // matches the label text; this proves the field-level fallback (keyed
  // off which report field is being processed, not the model's own
  // wording) catches the case that label-matching alone missed.
  const businessModelOutput = labelModelDerivedFinancialClaims({
    content: "Revenue mechanics: $49/month per seat from the salon owner, billed via subscription",
    metricValues: ["$49/month"],
    knownFacts: { buyer: "Salon owners / independent salon operators", beachhead: "Salon owners / independent salon operators" },
    fieldName: "businessModel",
    language: "English",
    sourceContext: "beauty salon SaaS platform",
  });

  assert.doesNotMatch(businessModelOutput, /requires (?:additional verified data|realized revenue data)/i);
  assert.equal(businessModelOutput, "Revenue mechanics: Salon owners / independent salon operators");

  const gtmOutput = labelModelDerivedFinancialClaims({
    content: "Channel thesis: targeting $2M in pipeline via outbound sales",
    metricValues: ["$2M"],
    knownFacts: { buyer: "Career changers", beachhead: "Career changers seeking software roles" },
    fieldName: "goToMarketPlan",
    language: "English",
    sourceContext: "coding bootcamp platform",
  });

  assert.doesNotMatch(gtmOutput, /requires additional verified data/i);
  assert.equal(gtmOutput, "Channel thesis: Career changers seeking software roles");

  // A precisely-named metric (CAC) inside businessModel must still get
  // its own real computed value, not the buyer fallback -- the
  // field-level fallback must only apply once the more specific
  // known-metric-value check has already failed.
  const cacInsideBusinessModel = labelModelDerivedFinancialClaims({
    content: "CAC: $500 per customer via paid channels",
    metricValues: ["$500"],
    metricDisplayValues: { cac: "$1,050" },
    knownFacts: { buyer: "Salon owners", beachhead: "Salon owners" },
    fieldName: "businessModel",
    language: "English",
    sourceContext: "beauty salon SaaS platform",
  });

  assert.equal(cacInsideBusinessModel, "CAC: $1,050 (Planning assumption)");
});

test("a free-flowing sentence with no 'Label: value' structure is left untouched instead of having a broken fragment appended", () => {
  // Reproduces a real production bug found via live report generation: a
  // deterministic SWOT bullet already correctly read "...16.4 months
  // payback is still a planning assumption until acquisition channels
  // are tested." -- a full sentence, no colon anywhere. Because the
  // fallback logic assumed every flagged line has a "Label: value"
  // shape, it treated the ENTIRE sentence as "the label" and appended a
  // second, category-based explanation onto it, producing:
  // "...tested.: requires real customer acquisition and retention
  // data...". The sentence already honestly says the figure is a
  // planning assumption -- there is no safe label to rebuild around, so
  // it must be left exactly as-is.
  const alreadyLabeled = labelModelDerivedFinancialClaims({
    content: "- 16.4 months payback is still a planning assumption until acquisition channels are tested.",
    metricValues: ["16.4 months"],
    language: "English",
    sourceContext: "insurtech platform for claims automation",
  });

  assert.equal(
    alreadyLabeled,
    "- 16.4 months payback is still a planning assumption until acquisition channels are tested."
  );

  // A "Label: value" line must still be flagged and replaced normally --
  // this fix must not suppress flagging just because the word
  // "Estimated" appears in the LABEL portion before the colon.
  const stillFlagged = labelModelDerivedFinancialClaims({
    content: "Estimated required funding: $1.3M",
    metricValues: ["$1.3M"],
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(stillFlagged, /\$1\.3M/);
  assert.match(stillFlagged, /requires current expense and financing data/);
});

test("a dense multi-clause businessModel paragraph only has its flagged clause replaced -- every other clause survives untouched", () => {
  // Reproduces a real production bug found via live report generation:
  // the model wrote the entire businessModel field as ONE paragraph with
  // several distinct "Label: value." clauses joined by ". " instead of a
  // newline per clause. Because the whole line was treated as a single
  // atomic replaceable unit, one unverifiable number in the LAST clause
  // (a gross-margin percentage) caused the FIRST clause's label ("Kim
  // öder" / "Who pays") to be used for a replacement that discarded
  // every other clause in the paragraph -- five legitimate, unflagged
  // clauses of real content were silently destroyed.
  const output = labelModelDerivedFinancialClaims({
    content:
      "Kim öder: restoran işletmesi (abone). Ne öder: aylık abonelik ücreti. " +
      "Fiyat birimi: ARPA aylık/konum başı. Tekrarlayan mantık: abonelik yenilemesi. " +
      "Brüt marj: yazılım SaaS modeline uygun yüksek marj (modelde 78% olarak kullanıldı). " +
      "Retention loop: israf tasarrufu gösterdikçe abonelik yenilemesi.",
    metricValues: ["78%"],
    knownFacts: { buyer: "öngörülen ilk kullanıcılar", beachhead: "öngörülen ilk kullanıcılar" },
    fieldName: "businessModel",
    language: "Turkish",
    sourceContext: "restoran tedarik yönetimi SaaS",
  });

  // Every clause that was never flagged must survive verbatim.
  assert.match(output, /^Kim öder: restoran işletmesi \(abone\)\./);
  assert.match(output, /Ne öder: aylık abonelik ücreti\./);
  assert.match(output, /Fiyat birimi: ARPA aylık\/konum başı\./);
  assert.match(output, /Tekrarlayan mantık: abonelik yenilemesi\./);
  assert.match(output, /Retention loop: israf tasarrufu gösterdikçe abonelik yenilemesi\./);

  // Only the flagged clause (containing the unverifiable 78%) is
  // replaced, and with the margin-specific explanation -- not the bare
  // buyer/beachhead fallback, since "Brüt marj" names a distinct,
  // precise metric category rather than restating "who pays".
  assert.doesNotMatch(output, /78%/);
  assert.match(output, /Brüt marj: gerçekleşmiş gelir ve maliyet verisi bulunmadığı için hesaplanamıyor/);
  assert.doesNotMatch(output, /Brüt marj: öngörülen ilk kullanıcılar/);
});

test("a line about a metric this report's own financial engine already computed reuses that canonical value instead of claiming it is unavailable", () => {
  const output = labelModelDerivedFinancialClaims({
    content: ["ARPA: $412/month average across the base", "CAC: $980 fully loaded"].join("\n"),
    metricValues: ["$412", "$980"],
    metricDisplayValues: { arpa: "$480/month", cac: "$1,050" },
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(output, /requires additional verified data/i);
  assert.doesNotMatch(output, /not provided/i);
  assert.match(output, /^ARPA: \$480\/month \(Planning assumption\)$/m);
  assert.match(output, /^CAC: \$1,050 \(Planning assumption\)$/m);
});

test("a founderScore line is never wholesale-replaced just because its explanation happens to mention a number that coincidentally matches an unrelated metric's own displayValue elsewhere in the report", () => {
  // Reproduces a real production bug found via live report generation:
  // buildCanonicalFounderScore's canonical "Business Model Quality:
  // 66/100 - [explanation]" line is entirely deterministic (the score
  // from the decision engine, the explanation either a fixed fallback or
  // a short fragment of the model's own already-safe reasoning) -- but
  // it still passed through labelModelDerivedFinancialClaims like any
  // other field. When the explanation happened to mention a percentage
  // (e.g. "64% gross margin") that coincidentally equals a totally
  // unrelated metric's own canonical displayValue, the WHOLE line --
  // BOTH the deterministic score and the explanation -- was replaced
  // with the generic "unavailable" message, since founderScore's own
  // labels ("Business Model Quality") don't match any financial-metric
  // category and there is no buyer/beachhead known-fact for this field.
  // The fix: plan-executor.ts's call site passes metricValues: [] for
  // the founderScore field specifically, which this test proves is
  // sufficient (an empty array makes metricPattern null, a guaranteed
  // no-op for every line) without needing to touch the shared function.
  const founderScoreContent = [
    "Founder Readiness Score: 46/100",
    "Idea Quality: 58/100 - focused vertical with clear pain.",
    "Business Model Quality: 66/100 - SaaS margins plausible at 64% gross margin but capital efficiency weak.",
    "Founder Evidence: 25/100 - limited founder/team data provided.",
  ].join("\n");

  const output = labelModelDerivedFinancialClaims({
    content: founderScoreContent,
    metricValues: [],
    fieldName: "founderScore",
    language: "English",
    sourceContext: "HVAC field service SaaS",
  });

  assert.equal(output, founderScoreContent);
  assert.doesNotMatch(output, /requires additional verified data/i);
});

test("plan-executor.ts passes metricValues: [] specifically for the founderScore field (drift check)", () => {
  const src = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  assert.match(
    src,
    /metricValues: field === "founderScore" \? \[\] : Object\.values\(context\.metrics\)\.map\(/,
    "founderScore's metricValues exclusion has diverged from plan-executor.ts"
  );
});

test("a bare evidence-classification tag the model mistakenly wrote as a content label is never turned into a nonsensical fallback line", () => {
  // Reproduces a real production bug found via live report generation:
  // the model wrote its own required evidence-classification tag
  // ("Planlama varsayımı:"/"Planning assumption:") as if it were a
  // content label directly followed by a value, instead of an inline
  // annotation. fieldLabel extraction then treated the tag word itself
  // as "the field name" and generated a meaningless duplicate line:
  // "Planlama varsayımı: mevcut kanıtlarla hesaplanamıyor; doğrulanmış ek
  // veri gerekir" -- an explanation for a "metric" called "Planning
  // assumption", which doesn't exist.
  const output = labelModelDerivedFinancialClaims({
    content: "Planlama varsayımı: Gelir $842k'a çıkar. Risk: Yürütme riski: Yürütme hazırlığı: 30%.",
    metricValues: ["$842k", "30%"],
    language: "Turkish",
    sourceContext: "otel SaaS platformu",
  });

  assert.doesNotMatch(output, /Planlama varsayımı: mevcut kanıtlarla/);
  // The clause is left untouched (deferred to enforcePlanReportLanguage's
  // later tag-cleanup pass), so the model's own sentence survives.
  assert.match(output, /^Planlama varsayımı: Gelir \$842k'a çıkar\./m);
});

test("a known buyer/beachhead fact used once for an already-labeled clause is never reused again for a later, unrelated clause in the same field", () => {
  // Reproduces a real production bug found via live report generation: a
  // businessModel field whose first clause already correctly stated
  // "Kim öder: Otel işletmesi (B2B)." (matched via knownFactForLabel, the
  // label-text path) still had a much LATER, unrelated flagged clause
  // ("Tekrarlayan mantık:"/Recurring logic) overwritten with the SAME
  // buyer fact via the field-level fallback, producing "Tekrarlayan
  // mantık: öngörülen ilk kullanıcılar" -- a fallback placeholder
  // substituted into a sentence that has nothing to do with who pays.
  const output = labelModelDerivedFinancialClaims({
    content:
      "Kim öder: Otel işletmesi (B2B). Ne için öder: abonelik. " +
      "Tekrarlayan mantık: pilotten gelir artışı $842k'a çıkar.",
    metricValues: ["$842k"],
    knownFacts: { buyer: "öngörülen ilk kullanıcılar", beachhead: "öngörülen ilk kullanıcılar" },
    fieldName: "businessModel",
    language: "Turkish",
    sourceContext: "otel SaaS platformu",
  });

  assert.match(output, /^Kim öder: Otel işletmesi \(B2B\)\./m);
  assert.doesNotMatch(output, /Tekrarlayan mantık: öngörülen ilk kullanıcılar/);
});

test("a Turkish metric label (e.g. 'Aylık Nakit Yakımı') resolves to the same computed value the Financial Dashboard already shows, instead of a contradictory 'unavailable' message", () => {
  // Reproduces a real production bug found via live report generation:
  // knownMetricValueForLabel's alias map only had English metric names,
  // so a Turkish report's own model-generated prose (which names metrics
  // by their Turkish label, e.g. "Aylık Nakit Yakımı", "Finansal Pist",
  // "Başabaş") could never match its own already-computed value -- it
  // fell through to a generic "unavailable" message while the Financial
  // Dashboard, built from the exact same metric object, showed a
  // concrete number for the same field. Financial-claim-labeling.ts's
  // metricLabelAliases now covers the common bare Turkish forms;
  // plan-executor.ts's call site also adds each metric's own localized
  // label (localizeMetricLabel) as a key into metricDisplayValues.
  const output = labelModelDerivedFinancialClaims({
    content: "Aylık Nakit Yakımı: $248k/ay seviyesinde. Finansal Pist: 22.4 ay sürer. Başabaş: 45. ayda gerçekleşir.",
    metricValues: ["$248k", "22.4", "45"],
    metricDisplayValues: {
      "monthly burn": "$248k/month",
      "aylık nakit yakımı": "$248k/month",
      "runway": "22.4 months",
      "finansal pist": "22.4 months",
      "break-even month": "Month 45",
      "başabaş ayı": "Month 45",
    },
    language: "Turkish",
    sourceContext: "otel SaaS platformu",
  });

  assert.doesNotMatch(output, /mevcut kanıtlarla hesaplanamıyor/);
  assert.match(output, /Aylık Nakit Yakımı: \$248k\/month \(Planlama varsayımı\)/);
  assert.match(output, /Finansal Pist: 22\.4 months \(Planlama varsayımı\)/);
  assert.match(output, /Başabaş: Month 45 \(Planlama varsayımı\)/);
});

test("the generic 'Unspecified business model' placeholder is replaced by the report's own already-detected business model classification when available", () => {
  // Reproduces a real production bug found via live report generation:
  // "Unspecified business model" appeared in the Business Model section
  // under "Recurrence" -- a raw-sounding placeholder leaking into user-
  // facing prose ("Recurring logic: Unspecified business model") instead
  // of the report's own real, specific, already-detected classification.
  const output = labelModelDerivedFinancialClaims({
    content: "Recurring logic: Professional Services renewal cadence.",
    metricValues: [],
    detectedBusinessModelLabel: "subscription software",
    language: "English",
    sourceContext: "AI decision platform for SMEs",
  });

  assert.doesNotMatch(output, /Unspecified business model/);
  assert.match(output, /Recurring logic: subscription software renewal cadence\./);
});

test("plan-executor.ts adds each metric's own localized label as an extra metricDisplayValues key (drift check)", () => {
  const src = readFileSync("app/lib/report-jobs/plan-executor.ts", "utf8");
  assert.match(
    src,
    /const localizedLabel = localizeMetricLabel\(metric\.label, language\)\.toLowerCase\(\);/,
    "the localized-label metricDisplayValues key has diverged from plan-executor.ts"
  );
  assert.match(
    src,
    /detectedBusinessModelLabel: context\.inputs\.businessModel,/,
    "the detectedBusinessModelLabel wiring has diverged from plan-executor.ts"
  );
});
