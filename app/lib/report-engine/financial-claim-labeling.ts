export function labelModelDerivedFinancialClaims({
  content,
  metricValues,
  metricDisplayValues,
  knownFacts,
  fieldName,
  detectedBusinessModelLabel,
  language,
  sourceContext,
}: {
  content: string;
  metricValues: readonly string[];
  // Canonical, already-computed value for every financial metric this
  // report's own engine produces (ARR, ARPA, CAC, Runway, ...), keyed by
  // every label form that metric is displayed under elsewhere in the same
  // report (case-insensitive). When a line about one of these metrics gets
  // flagged as unverifiable, the metric is never actually "unavailable" --
  // it is computed the same way ARR/Runway/Year-3 revenue are -- so this
  // substitutes the same canonical figure (marked as a planning assumption)
  // instead of a contradictory "cannot be calculated" message sitting next
  // to other metrics from the exact same model presented as known.
  metricDisplayValues?: Readonly<Record<string, string>>;
  // Already-established facts from earlier sections of the SAME validated
  // report (target buyer/ICP, beachhead segment) -- the single source of
  // truth those concepts already have elsewhere in this report. When a
  // line about one of these concepts would otherwise be flagged as
  // unverifiable, this is used instead of a generic "not available"
  // message, since the information demonstrably already exists in this
  // report's own validated state.
  knownFacts?: Readonly<{ buyer?: string; beachhead?: string }>;
  // Which report field this content belongs to (e.g. "businessModel",
  // "goToMarketPlan"). The model does not reliably label its own prose
  // with a recognizable "Who pays:" / "Beachhead positioning:" prefix --
  // in production it just as often writes "Revenue mechanics:" or "İş
  // Modeli:" for the exact same concept. knownFactForLabel only catches
  // the former; this field-level fallback catches the latter, since the
  // *field* (not the model's chosen label text) is what ties the line to
  // an already-known concept.
  fieldName?: string;
  // The already-detected canonical business-model classification (e.g.
  // "subscription software", "D2C Brand / E-commerce") -- reused in
  // place of the generic "Unspecified business model" placeholder
  // whenever a flagged clause's own "Professional Services" misdetection
  // is replaced, since this report already has a real, specific answer
  // for what the business model is.
  detectedBusinessModelLabel?: string;
  language: "English" | "Turkish" | "German" | "French" | "Spanish";
  sourceContext: string;
}) {
  const copy = {
    English: {
      assumption: "Planning assumption",
      unspecifiedModel: "Unspecified business model",
      unavailable: "requires additional verified data before this can be shown",
    },
    Turkish: {
      assumption: "Planlama varsayımı",
      unspecifiedModel: "Belirtilmemiş iş modeli",
      unavailable: "mevcut kanıtlarla hesaplanamıyor; doğrulanmış ek veri gerekir",
    },
    German: {
      assumption: "Planungsannahme",
      unspecifiedModel: "Nicht angegebenes Geschäftsmodell",
      unavailable: "erfordert zusätzliche geprüfte Daten, bevor dies angezeigt werden kann",
    },
    French: {
      assumption: "Hypothèse de planification",
      unspecifiedModel: "Modèle économique non précisé",
      unavailable: "nécessite des données supplémentaires vérifiées avant de pouvoir être affiché",
    },
    Spanish: {
      assumption: "Supuesto de planificación",
      unspecifiedModel: "Modelo de negocio no especificado",
      unavailable: "requiere datos verificados adicionales antes de poder mostrarse",
    },
  }[language];
  const escapePattern = (value: string) =>
    value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const values = [...new Set(metricValues.map((value) => value.trim()).filter(Boolean))];
  const metricPattern = values.length
    ? new RegExp(values.map(escapePattern).join("|"), "i")
    : null;
  const assumptionLabel = copy.assumption;
  const userProvidedPattern =
    /(?:\bUser-provided\b|\bKullanıcı tarafından\b)/i;
  const planningEstimatePattern =
    /(?:\b(?:Estimated|Assumption|Planning assumption|Planungsannahme|Annahme|Hypothèse de planification|Hypothèse|Supuesto de planificación|Supuesto)\b|\b(?:Tahmin|Varsayım|Planlama varsayımı)\b)/i;
  const hasExplicitServiceModel =
    /\b(?:consulting|consultancy|agency|professional services?|service business|danışmanlık|ajans|profesyonel hizmet)\b/i.test(
      sourceContext
    );
  const planningScenarioRequested =
    /\b(?:scenario|forecast|projection|planning assumption|what if|senaryo|tahmin|projeksiyon|planlama varsayımı|szenario|prognose|scénario|prévision|escenario|proyección)\b/i.test(
      sourceContext
    );
  // Concepts that are already established, real facts elsewhere in THIS
  // same validated report (Target Customer / ICP defines the buyer;
  // Market Opportunity defines the reachable niche/beachhead) -- a line
  // that only fails to restate one of these with a number attached must
  // reuse the already-known fact rather than claim it is unavailable.
  const buyerLabelPattern = /\b(?:who pays|payer|buyer|economic buyer|kim öder|ödeyen taraf|ödeyen)\b/i;
  const beachheadLabelPattern = /\bbeachhead\b|\bbaşlangıç\s*pazar/i;
  const knownFactForLabel = (fieldLabel: string) => {
    if (knownFacts?.buyer && buyerLabelPattern.test(fieldLabel)) {
      return knownFacts.buyer;
    }
    if (knownFacts?.beachhead && beachheadLabelPattern.test(fieldLabel)) {
      return knownFacts.beachhead;
    }
    return "";
  };
  // Field-level fallback: businessModel's central unresolved concept is
  // always "who pays" and goToMarketPlan's is always "beachhead
  // positioning", regardless of what label the model happened to put in
  // front of the flagged line. Only used once a line has already failed
  // every more-specific check (an exact known-metric name, or the line's
  // own label literally naming the concept), so a real CAC/ARPA/TAM line
  // inside either field still gets its own precise value or explanation.
  const knownFactForField =
    fieldName === "businessModel"
      ? knownFacts?.buyer
      : fieldName === "goToMarketPlan"
        ? knownFacts?.beachhead
        : undefined;
  // Every metric this report's financial engine computes (ARR, ARPA, CAC,
  // Runway, ...) always has a real, deterministic value -- it is never
  // actually "unavailable" the way genuinely unverified user data is.
  // Matched by the metric's own display label (lower-cased) plus a few
  // spelled-out aliases the model sometimes uses instead of the acronym.
  const metricLabelAliases: Record<string, string> = {
    "average revenue per account": "arpa",
    "annual contract value": "arpa",
    "customer acquisition cost": "cac",
    "customer lifetime value": "ltv",
    "annual recurring revenue": "arr",
    "monthly recurring revenue": "mrr",
    "cac payback": "cac payback",
    "cac payback period": "cac payback",
    // Bare/shortened Turkish forms the model uses even when the full
    // localized label (already added to metricDisplayValues at the call
    // site, e.g. "Başabaş Ayı") is a longer phrase -- confirmed live,
    // "Başabaş" alone (without "Ayı") is a common shortened form.
    "başabaş": "break-even month",
    "geri ödeme": "cac payback",
    "geri ödeme süresi": "cac payback",
    "brüt marj": "gross margin",
    "nakit yakımı": "monthly burn",
  };
  const knownMetricValueForLabel = (fieldLabel: string) => {
    if (!metricDisplayValues) return "";
    const normalized = fieldLabel.trim().toLowerCase();
    const key = metricLabelAliases[normalized] || normalized;
    return metricDisplayValues[key] || "";
  };
  // "Revenue"/"gelir"/"ciro" alone is ambiguous inside businessModel/
  // goToMarketPlan specifically: those fields' whole subject is revenue
  // mechanics, so a clause the model labels e.g. "Revenue mechanics" or
  // "İş Modeli" is really restating the SAME "who pays" concept the
  // field-level known fact already covers, not a distinct financial
  // metric. Confirmed live: without this, "Revenue mechanics: $49/month
  // per seat from the salon owner" matched the bare "revenue" word and
  // returned a generic "revenue data missing" message instead of
  // reusing the already-known buyer -- reproducing the exact bug this
  // was asked to fix. A real, precisely-NAMED metric (ARR/MRR) still
  // always wins even inside these two fields.
  const revenueOnlyWordIsAmbiguous =
    (fieldName === "businessModel" || fieldName === "goToMarketPlan") &&
    Boolean(knownFactForField);

  // Each category also carries what the founder should actually go
  // collect -- requirement 5 asks for why-missing plus what's-missing
  // plus what-to-collect-next in one clean sentence, not a bare label.
  // Returns null when the label doesn't name a specific known metric
  // category -- callers fall back to the field-level known fact (if any)
  // before the bare default, so a clause that's actually about CAC/
  // margin/etc. inside businessModel/goToMarketPlan still gets its own
  // precise category message instead of being swallowed by the generic
  // buyer/beachhead reuse meant for genuinely unclassified clauses.
  const specificCategoryUnavailableCopy = (fieldLabel: string): string | null => {
    if (language === "Turkish") {
      if (/\b(?:CAC|LTV|edinim|dönüşüm|geri ödeme|payback|ödeme isteği|wtp)\b/i.test(fieldLabel)) {
        return "gerçek müşteri edinimi ve elde tutma verisi bulunmadığı için hesaplanamıyor; kurucunun kanal başına edinim maliyeti ve kohort elde tutma kayıtlarını toplaması gerekir";
      }
      if (
        /\bARR\b|\bMRR\b|\bARPA\b/i.test(fieldLabel) ||
        (!revenueOnlyWordIsAmbiguous && /\b(?:gelir|ciro|revenue)\b/i.test(fieldLabel))
      ) {
        return "gerçekleşmiş gelir verisi bulunmadığı için hesaplanamıyor; kurucunun fatura/ödeme kayıtlarından gerçekleşmiş gelir verisini paylaşması gerekir";
      }
      if (/\b(?:TAM|SAM|SOM|pazar|market size)\b/i.test(fieldLabel)) {
        return "doğrulanmış pazar büyüklüğü verisi bulunmadığı için hesaplanamıyor; sektör raporu veya resmi istatistik gibi doğrulanmış kaynaklar gerekir";
      }
      if (
        /\b(?:runway|burn|funding|fonlama|finansman|gider|maliyet|nakit\s*yak[ıi]m[ıi]?|finansal\s*pist|başabaş|breakeven|break-even|yatırım|ebitda)\b/i.test(
          fieldLabel
        )
      ) {
        return "güncel gider ve finansman verisi bulunmadığı için hesaplanamıyor; kurucunun güncel nakit pozisyonu ve aylık giderlerini paylaşması gerekir";
      }
      if (/\b(?:margin|marj|kârlılık|profit)\b/i.test(fieldLabel)) {
        return "gerçekleşmiş gelir ve maliyet verisi bulunmadığı için hesaplanamıyor; kurucunun birim maliyet ve satış fiyatı verisini paylaşması gerekir";
      }

      return null;
    }

    if (language === "English") {
      if (/\b(?:CAC|LTV|acquisition|conversion|payback|willingness\s*to\s*pay|wtp)\b/i.test(fieldLabel)) {
        return "requires real customer acquisition and retention data; the founder should collect channel-level acquisition cost and cohort retention records to calculate this";
      }
      if (
        /\bARR\b|\bMRR\b|\bARPA\b/i.test(fieldLabel) ||
        (!revenueOnlyWordIsAmbiguous && /\brevenue\b/i.test(fieldLabel))
      ) {
        return "requires realized revenue data; the founder should share actual invoicing or payment records to calculate this";
      }
      if (/\b(?:TAM|SAM|SOM|market size)\b/i.test(fieldLabel)) {
        return "requires verified market-sizing data; independent industry reports or official statistics are needed to calculate this";
      }
      if (
        /\b(?:runway|burn|funding|monthly\s*burn|break-?even|investment\s*needed|ebitda)\b/i.test(fieldLabel)
      ) {
        return "requires current expense and financing data; the founder should share current cash position and monthly spend to calculate this";
      }
      if (/\b(?:margin|profit)\b/i.test(fieldLabel)) {
        return "requires realized revenue and cost data; the founder should share unit cost and selling price to calculate this";
      }

      return null;
    }

    return null;
  };

  // Embedding the field label as the subject (below) stopped two DIFFERENT
  // labels from ever colliding, but confirmed live (e-commerce inventory
  // SaaS report): the explanatory clause after the subject was still one
  // single fixed sentence for every field, so whenever the model produced
  // an unlabeled/subjectless flagged line (or several fields' flagged
  // lines shared a generic label), the same verbatim explanation still
  // showed up 4+ times across otherwise-unrelated sections (Competitor
  // Landscape, Scenario Analysis, both 30-60-90 roadmap lines). Each
  // report field has a different KIND of evidence that would actually
  // resolve its own gap -- a missing competitor claim needs named
  // competitor data, a missing roadmap milestone needs execution/pilot
  // evidence, a missing scenario needs the specific assumption it
  // depends on -- so the explanation is now keyed by fieldName instead
  // of being one generic sentence, on top of the existing per-label
  // subject variation. Fields not listed here (executive summary,
  // problem/solution, market sizing, unit economics, ...) keep the
  // original generic evidence clause; those already get their own
  // precise wording from specificCategoryUnavailableCopy above whenever
  // the label names a known metric.
  const fieldEvidenceContext: Partial<Record<string, { en: string; tr: string }>> = {
    competitorLandscape: {
      en: "the founder should share named competitor pricing, feature, or market-share data",
      tr: "kurucunun isimlendirilmiş rakiplerin fiyatlandırma, özellik veya pazar payı verisini paylaşması gerekir",
    },
    scenarioAnalysis: {
      en: "the founder should share the specific pricing, churn, or acquisition assumption this scenario depends on",
      tr: "kurucunun bu senaryonun dayandığı fiyatlandırma, kayıp oranı veya edinim varsayımını paylaşması gerekir",
    },
    roadmap306090: {
      en: "the founder should share the execution evidence (pilot results, signed LOIs, or channel test data) behind this milestone",
      tr: "kurucunun bu kilometre taşının dayandığı yürütme kanıtını (pilot sonuçları, imzalı niyet mektupları veya kanal test verisi) paylaşması gerekir",
    },
    founderRoadmap: {
      en: "the founder should share the execution or capability evidence behind this milestone",
      tr: "kurucunun bu kilometre taşının dayandığı yürütme veya yetkinlik kanıtını paylaşması gerekir",
    },
    swotAnalysis: {
      en: "the founder should share the customer, cost, or competitive evidence behind this claim",
      tr: "kurucunun bu iddianın dayandığı müşteri, maliyet veya rekabet kanıtını paylaşması gerekir",
    },
    portersFiveForces: {
      en: "the founder should share supplier, buyer, or competitive-intensity data specific to this force",
      tr: "kurucunun bu güce özgü tedarikçi, alıcı veya rekabet yoğunluğu verisini paylaşması gerekir",
    },
    risks: {
      en: "the founder should share the probability, impact, or mitigation evidence behind this risk",
      tr: "kurucunun bu riskin dayandığı olasılık, etki veya azaltma kanıtını paylaşması gerekir",
    },
    kpis: {
      en: "the founder should share the historical or pilot data this threshold depends on",
      tr: "kurucunun bu eşiğin dayandığı geçmiş veya pilot verisini paylaşması gerekir",
    },
    kpiDashboard: {
      en: "the founder should share the historical or pilot data this metric depends on",
      tr: "kurucunun bu metriğin dayandığı geçmiş veya pilot verisini paylaşması gerekir",
    },
    pricingStrategy: {
      en: "the founder should share willingness-to-pay or competitor pricing data behind this figure",
      tr: "kurucunun bu değerin dayandığı ödeme isteği veya rakip fiyatlandırma verisini paylaşması gerekir",
    },
    goToMarketPlan: {
      en: "the founder should share channel-test or early-traction data behind this figure",
      tr: "kurucunun bu değerin dayandığı kanal testi veya erken çekiş verisini paylaşması gerekir",
    },
    salesStrategy: {
      en: "the founder should share sales-cycle or pipeline-conversion data behind this figure",
      tr: "kurucunun bu değerin dayandığı satış döngüsü veya boru hattı dönüşüm verisini paylaşması gerekir",
    },
    businessModel: {
      en: "the founder should share the pricing or margin evidence behind this figure",
      tr: "kurucunun bu değerin dayandığı fiyatlandırma veya marj kanıtını paylaşması gerekir",
    },
    // Confirmed live: a deterministic "AI Executive Insight" heading is
    // reused for BOTH competitorLandscape's own insight AND tamSamSom's
    // market-sizing insight (buildExecutiveInsight, called once per
    // field with a different focus argument) -- if either flags with no
    // field-specific context, it would fall back to the exact same
    // subject AND the exact same generic suffix as a completely
    // unrelated field's own fallback line. tamSamSom (and the other
    // remaining fields below) get their own evidence clause so no two
    // fields can ever produce a byte-identical full unavailable line.
    tamSamSom: {
      en: "the founder should share verified market-sizing data (industry reports or official statistics) behind this figure",
      tr: "kurucunun bu değerin dayandığı doğrulanmış pazar büyüklüğü verisini (sektör raporu veya resmi istatistik) paylaşması gerekir",
    },
    executiveSummary: {
      en: "the founder should share the primary evidence behind this decision-critical figure",
      tr: "kurucunun bu karara etki eden değerin dayandığı birincil kanıtı paylaşması gerekir",
    },
    problem: {
      en: "the founder should share customer-interview or support-ticket evidence behind this claim",
      tr: "kurucunun bu iddianın dayandığı müşteri görüşmesi veya destek talebi kanıtını paylaşması gerekir",
    },
    solution: {
      en: "the founder should share product usage or pilot-outcome evidence behind this claim",
      tr: "kurucunun bu iddianın dayandığı ürün kullanım veya pilot sonucu kanıtını paylaşması gerekir",
    },
    targetCustomer: {
      en: "the founder should share ICP interview or segment-sizing evidence behind this figure",
      tr: "kurucunun bu değerin dayandığı ideal müşteri profili görüşmesi veya segment büyüklüğü kanıtını paylaşması gerekir",
    },
    marketOpportunity: {
      en: "the founder should share independently sourced market-demand evidence behind this figure",
      tr: "kurucunun bu değerin dayandığı bağımsız kaynaklı pazar talebi kanıtını paylaşması gerekir",
    },
    unitEconomics: {
      en: "the founder should share the realized cost or revenue data behind this unit metric",
      tr: "kurucunun bu birim metriğin dayandığı gerçekleşmiş maliyet veya gelir verisini paylaşması gerekir",
    },
    financialDashboard: {
      en: "the founder should share the realized financial data behind this figure",
      tr: "kurucunun bu değerin dayandığı gerçekleşmiş finansal veriyi paylaşması gerekir",
    },
    financialAssumptions: {
      en: "the founder should share the planning input this assumption depends on",
      tr: "kurucunun bu varsayımın dayandığı planlama girdisini paylaşması gerekir",
    },
  };
  const genericUnavailableCopyForLabel = (fieldLabel: string) => {
    const subject = fieldLabel.trim();
    const fieldContext = fieldName ? fieldEvidenceContext[fieldName] : undefined;
    const evidenceClause = fieldContext
      ? language === "Turkish"
        ? fieldContext.tr
        : fieldContext.en
      : language === "Turkish"
        ? "kurucunun bu değerin dayandığı kanıtları paylaşması gerekir"
        : "the founder should share the evidence behind this figure to calculate it";

    return language === "Turkish"
      ? `${subject} için doğrulanmış veri bulunmadığından hesaplanamıyor; ${evidenceClause}`
      : `${subject} requires verified supporting data before this can be shown; ${evidenceClause}`;
  };

  // Tracks which output lines are actually a generated unavailable-data
  // explanation (as opposed to an ordinary line -- e.g. "Industry
  // benchmark: X" / "Business model: X" -- that only happens to share
  // its value with an unrelated line). Only lines this function itself
  // generated are eligible for consolidation below; every other line
  // is left exactly as it already was, regardless of what it says.
  const generatedUnavailableLines = new Set<string>();

  // The model frequently writes an entire field as one dense paragraph
  // with several distinct "Label: value." clauses joined by ". " instead
  // of a newline per clause (e.g. "Kim öder: restoran işletmesi. Ne
  // öder: aylık abonelik. Brüt marj: ... 78% ..."). Confirmed live: when
  // that whole paragraph was treated as a single atomic unit, one
  // unverifiable number anywhere in it (even in the LAST clause) flagged
  // the entire line, and the fieldLabel used for the replacement was
  // always just the FIRST clause's label -- discarding every other,
  // perfectly valid clause in the paragraph along with it. Splitting on
  // the boundary between a clause's own sentence-end and the next
  // capitalized "Label:" start lets each clause be evaluated and
  // (if needed) replaced independently, so unflagged clauses survive.
  const clauseBoundaryPattern = /(?<=[.;])\s+(?=[A-ZÇĞİÖŞÜ][^:\n]{1,40}:\s)/g;
  const splitIntoClauses = (line: string) => {
    const clauses = line.split(clauseBoundaryPattern);
    return clauses.length > 1 ? clauses : [line];
  };

  // "Unspecified business model" (and its Turkish equivalent) was itself
  // a raw-sounding placeholder leaking into user-facing prose --
  // "Recurring logic: Unspecified business model" reads like a broken
  // field, not a sentence. This report's own already-detected business
  // model classification (e.g. "subscription software") is a real,
  // specific answer to the exact same question, so it is used whenever
  // available; the generic phrase remains only as a last-resort default.
  const businessModelReplacement =
    (detectedBusinessModelLabel || "").trim() || copy.unspecifiedModel;
  // The model is separately instructed (a prompt requirement this
  // function cannot change) to tag its own claims with an evidence-
  // classification word (Verified/Estimated/Assumption/AI Analysis, or
  // their Turkish equivalents). Confirmed live: it sometimes writes that
  // tag AS IF it were a content label directly followed by a separator
  // ("Planlama varsayımı: Gelir $842k'a çıkar...") instead of an inline
  // annotation -- fieldLabel extraction below would then treat the tag
  // word itself as "the field name" and generate a nonsensical
  // "Planlama varsayımı: [unavailable message]" line, a duplicate,
  // meaningless entry with zero relation to any real metric. These tag
  // words are never valid field labels, so a clause whose extracted
  // label IS one is left untouched here and deferred entirely to
  // enforcePlanReportLanguage's later tag-cleanup pass.
  const evidenceTagWordPattern =
    /^(?:Verified|Estimated|Assumption|Planning assumption|AI Analysis|Model estimate|Model-derived estimate|Approximate|Doğrulanmış|Tahmini|Yaklaşık|Varsayım|Planlama varsayımı|AI Analizi|Model çıkarımı|Model tahmini)$/i;
  // knownFactForField is meant as a true last resort for the ONE clause
  // in a field that most plausibly needed the buyer/beachhead fact
  // restated -- not for every later, unrelated clause that also happens
  // to get flagged. Confirmed live: a businessModel field whose first
  // clause already correctly stated "Kim öder: Otel işletmesi (B2B)."
  // still had a much LATER, unrelated clause ("Tekrarlayan mantık:"/
  // Recurring logic) overwritten with the same buyer fact, producing
  // "Tekrarlayan mantık: öngörülen ilk kullanıcılar" -- a fallback
  // placeholder value substituted into a sentence it has nothing to do
  // with. Tracked once per labelModelDerivedFinancialClaims call (i.e.
  // once per field's content) via this closure flag -- seeded to true
  // up front whenever the content already has an explicit "Kim öder:"/
  // "Who pays:"-labeled clause SOMEWHERE, even one that was never itself
  // flagged (no dollar figure in it, so it never passes through
  // knownFactForLabel below): the concept is already established in
  // this field's own text, so no later clause should ever restate it
  // again via the field-level fallback.
  let knownFactAlreadyUsedForField =
    (fieldName === "businessModel" && buyerLabelPattern.test(content)) ||
    (fieldName === "goToMarketPlan" && beachheadLabelPattern.test(content));
  // consolidateRepeatedUnavailableLines (below) only ever sees whole
  // LINES, but a flagged clause is frequently one of several clauses on
  // the same line, rejoined with the others via labeledClauses.join(" ")
  // before consolidation ever runs -- so the exact fragment this
  // generates is never actually present as a standalone entry in
  // `lines`, and that later dedup pass can't recognize or merge it.
  // Confirmed live: a roadmap bullet's own "Next 6 months: ...; Proof:
  // [flagged]" and a later, different bullet's "Next 12 months: ...;
  // Proof: [flagged]" produced the exact same "Proof: <explanation>"
  // fragment twice in one field, invisible to the line-level dedup since
  // neither whole line matched the other. Tracking every generated
  // fragment directly at the point it's produced (not the line it ends
  // up embedded in) catches this regardless of what else is on the line.
  const seenGeneratedFragments = new Set<string>();

  const labelClause = (rawClause: string) => {
    let normalizedClause = rawClause;
    if (!hasExplicitServiceModel) {
      normalizedClause = normalizedClause.replace(
        /\bProfessional Services\b/gi,
        businessModelReplacement
      );
    }
    if (!metricPattern?.test(normalizedClause)) {
      return normalizedClause;
    }
    const clauseMetricValues = values.filter((value) =>
      normalizedClause.toLowerCase().includes(value.toLowerCase())
    );
    if (
      userProvidedPattern.test(normalizedClause) ||
      clauseMetricValues.some((value) =>
        sourceContext.toLowerCase().includes(value.toLowerCase())
      )
    ) {
      return normalizedClause;
    }
    // Everything below (including the planningScenarioRequested branch)
    // assumes a "Label: value" shape and rebuilds the clause as
    // "${fieldLabel}: ${message}". A clause with no colon/em dash at all
    // is free-flowing prose, not a labeled line -- treating the WHOLE
    // sentence as "the label" and appending a second message after it
    // produces a broken, doubled-up fragment. Confirmed live: a
    // deterministic SWOT bullet already correctly read "...16.4 months
    // payback is still a planning assumption until acquisition channels
    // are tested." -- since the sentence has no colon, the fallback
    // below treated the ENTIRE sentence as "the field label" and
    // appended a second, redundant, category-based explanation onto it
    // ("...tested.: requires real customer acquisition..."). There is no
    // safe label to rebuild around, so an unstructured sentence is left
    // exactly as-is; the flagged number in it is always one of this
    // report's own computed metric values (metricPattern is built from
    // context.metrics, never arbitrary AI-invented figures), so leaving
    // it in prose is not a validation safeguard being weakened.
    if (!/[:—]/.test(normalizedClause)) {
      return normalizedClause;
    }
    if (planningScenarioRequested) {
      return planningEstimatePattern.test(normalizedClause)
        ? normalizedClause
        : `${assumptionLabel} — ${normalizedClause}`;
    }

    const fieldLabel = normalizedClause.split(/\s*(?::|—)\s*/, 1)[0]?.trim();
    if (!fieldLabel) {
      generatedUnavailableLines.add(copy.unavailable);
      return copy.unavailable;
    }

    if (evidenceTagWordPattern.test(fieldLabel)) {
      return normalizedClause;
    }

    const knownFact = knownFactForLabel(fieldLabel);
    if (knownFact) {
      knownFactAlreadyUsedForField = true;
      return `${fieldLabel}: ${knownFact}`;
    }

    const knownMetricValue = knownMetricValueForLabel(fieldLabel);
    if (knownMetricValue) {
      return `${fieldLabel}: ${knownMetricValue} (${assumptionLabel})`;
    }

    const specificCopy = specificCategoryUnavailableCopy(fieldLabel);
    if (specificCopy) {
      const result = `${fieldLabel}: ${specificCopy}`;
      if (seenGeneratedFragments.has(result)) {
        return "";
      }
      seenGeneratedFragments.add(result);
      generatedUnavailableLines.add(result);
      return result;
    }

    if (knownFactForField && !knownFactAlreadyUsedForField) {
      knownFactAlreadyUsedForField = true;
      const result = `${fieldLabel}: ${knownFactForField}`;
      if (seenGeneratedFragments.has(result)) {
        return "";
      }
      seenGeneratedFragments.add(result);
      generatedUnavailableLines.add(result);
      return result;
    }

    const result = genericUnavailableCopyForLabel(fieldLabel);
    if (seenGeneratedFragments.has(result)) {
      return "";
    }
    seenGeneratedFragments.add(result);
    generatedUnavailableLines.add(result);
    return result;
  };

  const labeled = content.split("\n").map((line) => {
    const clauses = splitIntoClauses(line);
    // A clause dropped for repeating an already-shown explanation (see
    // seenGeneratedFragments above) comes back as "" here -- filtered
    // out before rejoining so the surviving clauses read as a clean
    // sentence instead of leaving a double space or dangling label
    // behind where the duplicate used to be.
    const labeledClauses = clauses.map(labelClause).filter(Boolean);

    return labeledClauses.length > 1 ? labeledClauses.join(" ") : labeledClauses[0] || "";
  });

  return consolidateRepeatedUnavailableLines(labeled, generatedUnavailableLines).join("\n");
}

// When the same evidence gap applies to several metrics in one section
// (e.g. CAC, LTV, and Payback all missing the same acquisition data),
// labeling each metric's line independently produced the identical
// explanation sentence repeated back-to-back -- exactly the "dozens of
// times" pattern this was asked to remove. This merges consecutive
// lines that this function itself generated as an unavailable-data
// explanation and that ended up with the exact same reason text into
// one line listing every affected metric together. Lines it did not
// generate are never touched, even if they coincidentally share the
// same trailing text as a generated line (e.g. two unrelated "label:
// value" lines whose values happen to be identical).
function consolidateRepeatedUnavailableLines(
  lines: string[],
  generatedUnavailableLines: Set<string>
): string[] {
  const result: string[] = [];
  // Confirmed live: the model sometimes repeats the same milestone label
  // (e.g. "Next 30 Days") twice within one field -- once as the
  // structured bullet, once again in a later summary sentence -- and if
  // BOTH mentions independently flag as unverifiable, they each generate
  // the exact same "label: reason" line. The lookahead merge below only
  // ever catches CONSECUTIVE repeats; a second occurrence separated by
  // other content (a different bullet, other prose) sailed straight
  // through as a second, verbatim-identical line. This tracks every
  // generated line already emitted anywhere earlier in the field (not
  // just the immediately preceding one) and drops a later exact repeat
  // instead of showing the same boilerplate explanation twice.
  const seenGeneratedLines = new Set<string>();
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const match = generatedUnavailableLines.has(line)
      ? /^([^:\n]{1,80}):\s*(.+)$/.exec(line)
      : null;

    if (!match) {
      result.push(line);
      index += 1;
      continue;
    }

    if (seenGeneratedLines.has(line)) {
      index += 1;
      continue;
    }

    const [, firstLabel, reason] = match;
    const labels = [firstLabel.trim()];
    let lookahead = index + 1;

    while (lookahead < lines.length && generatedUnavailableLines.has(lines[lookahead])) {
      const nextMatch = /^([^:\n]{1,80}):\s*(.+)$/.exec(lines[lookahead]);
      if (!nextMatch || nextMatch[2] !== reason) {
        break;
      }
      labels.push(nextMatch[1].trim());
      lookahead += 1;
    }

    seenGeneratedLines.add(line);
    result.push(labels.length > 1 ? `${labels.join(", ")}: ${reason}` : line);
    index = lookahead > index + 1 ? lookahead : index + 1;
  }

  return result;
}
