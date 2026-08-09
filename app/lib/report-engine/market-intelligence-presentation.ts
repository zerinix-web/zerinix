import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import type { MarketResearchCoverage } from "@/app/lib/ai/market-research-coverage";
import type { MarketReportField } from "@/app/lib/report-engine/prompts/market";
import type { ExecutiveDecisionBrief, ExecutiveDecisionCode } from "@/app/lib/report-engine/executive-decision-brief";

// Market Intelligence's OWN executive-summary / entry-recommendation
// synthesis. Deliberately has no dependency on AiFinancialModelContext,
// InvestmentScore, or ReportIntelligenceModel (app/lib/ai/investment-score.ts,
// app/lib/ai/financial-assumptions.ts, app/lib/ai/report-intelligence.ts) --
// that whole object graph is Business Idea Validation's founder/EBITDA/
// runway/decision-engine scoring model, and reusing any part of it here is
// exactly the cross-report contamination this module exists to prevent.
// Every input below is either the report's own already-generated,
// already-market-safe section text, or MarketResearchCoverage's
// market/competitive/product/market-sizing evidence dimensions -- never its
// founderReadiness or executionReadiness dimensions, which belong to a
// founder's pitch, not a market research report.

export type MarketEntryDecision = "ENTER" | "MONITOR" | "AVOID";

const marketEntryDecisionTranslations: Record<
  ResponseLanguage,
  Record<MarketEntryDecision, string>
> = {
  English: { ENTER: "ENTER", MONITOR: "MONITOR", AVOID: "AVOID" },
  Turkish: { ENTER: "GİR", MONITOR: "İZLE", AVOID: "KAÇIN" },
  German: { ENTER: "EINTRETEN", MONITOR: "BEOBACHTEN", AVOID: "VERMEIDEN" },
  French: { ENTER: "ENTRER", MONITOR: "SURVEILLER", AVOID: "ÉVITER" },
  Spanish: { ENTER: "ENTRAR", MONITOR: "MONITOREAR", AVOID: "EVITAR" },
};

export function localizeMarketEntryDecision(
  decision: MarketEntryDecision,
  language: ResponseLanguage
) {
  return marketEntryDecisionTranslations[language][decision];
}

function marketText(
  language: ResponseLanguage,
  english: string,
  turkish: string,
  german: string,
  french: string,
  spanish: string
) {
  if (language === "Turkish") return turkish;
  if (language === "German") return german;
  if (language === "French") return french;
  if (language === "Spanish") return spanish;
  return english;
}

// Only the market-native evidence dimensions -- never founderReadiness or
// executionReadiness, which score a founder's pitch, not a market.
export function assessMarketEntryConfidence(coverage: MarketResearchCoverage) {
  const { marketConfidence, competitiveEvidence, financialEvidence, productEvidence } =
    coverage.dimensions;
  const confidence = Math.round(
    marketConfidence * 0.4 +
      competitiveEvidence * 0.25 +
      financialEvidence * 0.2 +
      productEvidence * 0.15
  );
  const decision: MarketEntryDecision =
    confidence >= 65 ? "ENTER" : confidence >= 40 ? "MONITOR" : "AVOID";

  return { confidence, decision };
}

function firstSubstantiveLine(content: string) {
  const line = (content || "")
    .split("\n")
    .map((item) => item.replace(/^[-*•]\s*/, "").replace(/^#{1,6}\s*/, "").trim())
    .find((item) => item.length > 24 && !/^[A-Z0-9 /&-]{2,40}:?$/.test(item));

  return line?.replace(/\*\*/g, "").trim() || "";
}

type MarketSections = Partial<Record<MarketReportField, string>>;

function biggestOpportunity(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.opportunities || "") ||
    marketText(
      language,
      "A defensible entry window exists but has not yet been fully evidenced.",
      "Savunulabilir bir giriş penceresi mevcut, ancak henüz tam olarak kanıtlanmadı.",
      "Ein verteidigbares Zeitfenster für den Markteintritt besteht, ist jedoch noch nicht vollständig belegt.",
      "Une fenêtre d'entrée défendable existe, mais n'a pas encore été pleinement étayée par des preuves.",
      "Existe una ventana de entrada defendible que aún no se ha justificado por completo con evidencia."
    )
  );
}

function biggestRisk(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.threats || "") ||
    marketText(
      language,
      "Verified market-size and competitive endpoints remain incomplete.",
      "Doğrulanmış pazar büyüklüğü ve rekabet uç noktaları henüz tam değil.",
      "Verifizierte Marktgrößen- und Wettbewerbsdaten sind weiterhin unvollständig.",
      "Les paramètres vérifiés de taille de marché et de concurrence restent incomplets.",
      "Los parámetros verificados de tamaño de mercado y competencia siguen siendo incompletos."
    )
  );
}

function topMarketDriver(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.marketDrivers || "") ||
    firstSubstantiveLine(sections.marketOverview || "") ||
    marketText(
      language,
      "structural demand growth in the category",
      "kategorideki yapısal talep büyümesi",
      "das strukturelle Nachfragewachstum in der Kategorie",
      "la croissance structurelle de la demande dans la catégorie",
      "el crecimiento estructural de la demanda en la categoría"
    )
  );
}

function whereToEnter(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.regionalAnalysis || "") ||
    marketText(
      language,
      "the highest-demand region identified in Regional Analysis",
      "Bölgesel Analiz'de belirlenen en yüksek talep bölgesi",
      "die in der Regionalanalyse identifizierte Region mit der höchsten Nachfrage",
      "la région à plus forte demande identifiée dans l'analyse régionale",
      "la región de mayor demanda identificada en el análisis regional"
    )
  );
}

function howToEnter(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.strategicRecommendations || "") ||
    marketText(
      language,
      "the entry approach detailed in Strategic Recommendations",
      "Stratejik Öneriler'de detaylandırılan giriş yaklaşımı",
      "der in den strategischen Empfehlungen beschriebene Markteintrittsansatz",
      "l'approche d'entrée détaillée dans les recommandations stratégiques",
      "el enfoque de entrada detallado en las recomendaciones estratégicas"
    )
  );
}

function topSubstantiveLines(content: string, max: number) {
  const lines = (content || "")
    .split("\n")
    .map((item) => item.replace(/^[-*•]\s*/, "").replace(/^#{1,6}\s*/, "").trim())
    .filter((item) => item.length > 24 && !/^[A-Z0-9 /&-]{2,40}:?$/.test(item))
    .map((item) => item.replace(/\*\*/g, "").trim());

  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase().slice(0, 48);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(line);
    }
  }

  return deduped.slice(0, max);
}

function keyFindings(sections: MarketSections) {
  const candidates = [
    firstSubstantiveLine(sections.marketSize || ""),
    firstSubstantiveLine(sections.competitiveLandscape || ""),
    firstSubstantiveLine(sections.marketDrivers || ""),
    firstSubstantiveLine(sections.opportunities || ""),
    firstSubstantiveLine(sections.threats || ""),
  ].filter(Boolean);
  const seen = new Set<string>();
  const deduped: string[] = [];

  for (const candidate of candidates) {
    const key = candidate.toLowerCase().slice(0, 48);
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(candidate);
    }
  }

  return deduped.slice(0, 5);
}

// Market Intelligence's dedicated executive summary generator. Discusses
// only market attractiveness, demand, competition, pricing, customer
// segments, regional opportunity, and market risk -- per report-engine
// isolation policy, it must never mention a founder, a validation gate, a
// funding decision, or any startup-readiness concept.
export function buildMarketExecutiveSummary(
  sections: MarketSections,
  language: ResponseLanguage,
  coverage: MarketResearchCoverage
) {
  const { confidence, decision } = assessMarketEntryConfidence(coverage);
  const localizedDecision = localizeMarketEntryDecision(decision, language);
  const opportunity = biggestOpportunity(sections, language);
  const risk = biggestRisk(sections, language);
  const findings = keyFindings(sections);

  const bottomLine = marketText(
    language,
    `Bottom Line: ${localizedDecision}. Market confidence sits at ${confidence}/100, based on evidence coverage across market size, competition, and product demand. This is a directional market read, not a company-specific investment decision.`,
    `Sonuç: ${localizedDecision}. Pazar güveni, pazar büyüklüğü, rekabet ve ürün talebindeki kanıt kapsamına dayanarak 100 üzerinden ${confidence} seviyesindedir. Bu, şirkete özgü bir yatırım kararı değil, yönlü bir pazar değerlendirmesidir.`,
    `Kernaussage: ${localizedDecision}. Die Marktkonfidenz liegt bei ${confidence}/100, basierend auf der Evidenzabdeckung zu Marktgröße, Wettbewerb und Produktnachfrage. Dies ist eine richtungsweisende Markteinschätzung, keine unternehmensspezifische Investitionsentscheidung.`,
    `Conclusion : ${localizedDecision}. La confiance de marché est de ${confidence}/100, sur la base de la couverture des preuves relatives à la taille du marché, à la concurrence et à la demande produit. Il s'agit d'une lecture directionnelle du marché, non d'une décision d'investissement propre à une entreprise.`,
    `Conclusión: ${localizedDecision}. La confianza de mercado es de ${confidence}/100, basada en la cobertura de evidencia sobre el tamaño de mercado, la competencia y la demanda de producto. Esta es una lectura direccional del mercado, no una decisión de inversión específica de una empresa.`
  );

  return [
    bottomLine,
    "",
    marketText(
      language,
      "Key Findings:",
      "Temel Bulgular:",
      "Wichtigste Erkenntnisse:",
      "Principales constats :",
      "Principales hallazgos:"
    ),
    ...(findings.length
      ? findings.map((finding) => `- ${finding}`)
      : [
          marketText(
            language,
            "- See detailed section analysis.",
            "- Ayrıntılı bölüm analizine bakın.",
            "- Siehe detaillierte Abschnittsanalyse.",
            "- Voir l'analyse détaillée de la section.",
            "- Consulte el análisis detallado de la sección."
          ),
        ]),
    "",
    marketText(
      language,
      `Biggest Opportunity: ${opportunity}`,
      `En Büyük Fırsat: ${opportunity}`,
      `Größte Chance: ${opportunity}`,
      `Principale opportunité : ${opportunity}`,
      `Mayor oportunidad: ${opportunity}`
    ),
    "",
    marketText(
      language,
      `Biggest Risk: ${risk}`,
      `En Büyük Risk: ${risk}`,
      `Größtes Risiko: ${risk}`,
      `Principal risque : ${risk}`,
      `Mayor riesgo: ${risk}`
    ),
    "",
    marketText(
      language,
      "Recommended Market Entry Strategy:",
      "Önerilen Pazara Giriş Stratejisi:",
      "Empfohlene Markteintrittsstrategie:",
      "Stratégie d'entrée sur le marché recommandée :",
      "Estrategia de entrada al mercado recomendada:"
    ),
    marketText(
      language,
      `- ${localizedDecision} this market, prioritizing ${topMarketDriver(sections, language)}.`,
      `- Bu pazara ${localizedDecision.toLowerCase()} kararı verin; öncelik ${topMarketDriver(sections, language)} olsun.`,
      `- ${localizedDecision} in diesen Markt, mit Priorität auf ${topMarketDriver(sections, language)}.`,
      `- ${localizedDecision} sur ce marché, en priorisant ${topMarketDriver(sections, language)}.`,
      `- ${localizedDecision} en este mercado, priorizando ${topMarketDriver(sections, language)}.`
    ),
  ].join("\n").replace(/\n{3,}/g, "\n\n");
}

// Market Intelligence's dedicated entry-recommendation generator. Answers
// exactly: should this market be entered, why, where, when, and how -- it
// must never evaluate a founder, team, or execution capability.
export function buildMarketEntryRecommendation(
  sections: MarketSections,
  language: ResponseLanguage,
  coverage: MarketResearchCoverage
) {
  const { confidence, decision } = assessMarketEntryConfidence(coverage);
  const localizedDecision = localizeMarketEntryDecision(decision, language);
  const why = topMarketDriver(sections, language);
  const where = whereToEnter(sections, language);
  const how = howToEnter(sections, language);
  const when = marketText(
    language,
    confidence >= 65
      ? "immediately, while the current demand and competitive window holds"
      : confidence >= 40
        ? "after closing the highest-impact evidence gap identified above"
        : "only after verified market-size and competitive evidence improve",
    confidence >= 65
      ? "mevcut talep ve rekabet penceresi sürerken hemen"
      : confidence >= 40
        ? "yukarıda belirlenen en etkili kanıt boşluğu kapatıldıktan sonra"
        : "yalnızca doğrulanmış pazar büyüklüğü ve rekabet kanıtları iyileştikten sonra",
    confidence >= 65
      ? "sofort, solange das aktuelle Nachfrage- und Wettbewerbsfenster bestehen bleibt"
      : confidence >= 40
        ? "nachdem die oben genannte wirkungsvollste Evidenzlücke geschlossen wurde"
        : "erst nachdem sich verifizierte Marktgrößen- und Wettbewerbsdaten verbessert haben",
    confidence >= 65
      ? "immédiatement, tant que la fenêtre actuelle de demande et de concurrence est ouverte"
      : confidence >= 40
        ? "après avoir comblé la lacune de preuve la plus impactante identifiée ci-dessus"
        : "seulement après l'amélioration des preuves vérifiées de taille de marché et de concurrence",
    confidence >= 65
      ? "de inmediato, mientras se mantenga la ventana actual de demanda y competencia"
      : confidence >= 40
        ? "después de cerrar la brecha de evidencia de mayor impacto identificada anteriormente"
        : "solo después de que mejoren las evidencias verificadas de tamaño de mercado y competencia"
  );

  return [
    marketText(
      language,
      "Market Entry Recommendation",
      "Pazara Giriş Tavsiyesi",
      "Markteintrittsempfehlung",
      "Recommandation d'entrée sur le marché",
      "Recomendación de entrada al mercado"
    ),
    marketText(
      language,
      `- Should this market be entered: ${localizedDecision} (confidence ${confidence}/100).`,
      `- Bu pazara girilmeli mi: ${localizedDecision} (güven ${confidence}/100).`,
      `- Sollte in diesen Markt eingetreten werden: ${localizedDecision} (Konfidenz ${confidence}/100).`,
      `- Faut-il entrer sur ce marché : ${localizedDecision} (confiance ${confidence}/100).`,
      `- ¿Debe entrarse en este mercado?: ${localizedDecision} (confianza ${confidence}/100).`
    ),
    marketText(
      language,
      `- Why: ${why}.`,
      `- Neden: ${why}.`,
      `- Warum: ${why}.`,
      `- Pourquoi : ${why}.`,
      `- Por qué: ${why}.`
    ),
    marketText(
      language,
      `- Where: ${where}.`,
      `- Nerede: ${where}.`,
      `- Wo: ${where}.`,
      `- Où : ${where}.`,
      `- Dónde: ${where}.`
    ),
    marketText(
      language,
      `- When: ${when}.`,
      `- Ne zaman: ${when}.`,
      `- Wann: ${when}.`,
      `- Quand : ${when}.`,
      `- Cuándo: ${when}.`
    ),
    marketText(
      language,
      `- How: ${how}.`,
      `- Nasıl: ${how}.`,
      `- Wie: ${how}.`,
      `- Comment : ${how}.`,
      `- Cómo: ${how}.`
    ),
  ].join("\n");
}

// Maps ENTER/MONITOR/AVOID onto the shared, report-type-agnostic Executive
// Recommendation vocabulary for the mandatory opening block. MarketEntryDecision
// stays the authoritative decision everywhere else in this module (the
// scorecard-style helpers above) -- this is a pure presentation mapping for
// the opening block only.
export function buildMarketExecutiveDecisionBrief(
  sections: MarketSections,
  language: ResponseLanguage,
  coverage: MarketResearchCoverage
): ExecutiveDecisionBrief {
  const { confidence, decision } = assessMarketEntryConfidence(coverage);
  const code: ExecutiveDecisionCode =
    decision === "ENTER" ? "GO" : decision === "MONITOR" ? "WAIT" : "NO_GO";
  const localizedDecision = localizeMarketEntryDecision(decision, language);

  const shortAnswer = marketText(
    language,
    `${localizedDecision} this market, prioritizing ${topMarketDriver(sections, language)}.`,
    `Bu pazara ${localizedDecision.toLowerCase()} kararı verin; öncelik ${topMarketDriver(sections, language)} olsun.`,
    `${localizedDecision} in diesen Markt, mit Priorität auf ${topMarketDriver(sections, language)}.`,
    `${localizedDecision} sur ce marché, en priorisant ${topMarketDriver(sections, language)}.`,
    `${localizedDecision} en este mercado, priorizando ${topMarketDriver(sections, language)}.`
  );

  const fallbackReason = biggestOpportunity(sections, language);
  const fallbackRisk = biggestRisk(sections, language);
  const topReasons = topSubstantiveLines(sections.opportunities || "", 3);
  const topRisks = topSubstantiveLines(sections.threats || "", 3);

  return {
    shortAnswer,
    decision: code,
    confidence,
    topReasons: topReasons.length ? topReasons : [fallbackReason],
    topRisks: topRisks.length ? topRisks : [fallbackRisk],
  };
}
