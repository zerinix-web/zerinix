import type { ResponseLanguage } from "@/app/lib/report-engine/schema";
import type { MarketResearchCoverage } from "@/app/lib/ai/market-research-coverage";
import type { MarketReportField } from "@/app/lib/report-engine/prompts/market";
import {
  localizeExecutiveDecision,
  type ExecutiveDecisionBrief,
  type ExecutiveDecisionCode,
} from "./executive-decision-brief.ts";

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

// Injected into the generation prompt BEFORE the model writes a single
// word of the report -- research/coverage is already complete by then, so
// the deterministic ENTER/MONITOR/AVOID verdict is fully known in advance.
// Without this, the model has no way to know what verdict its own
// Strategic Recommendations/Opportunities/Market Drivers will be judged
// against, and routinely writes full-speed growth advice (scale,
// franchise, expand locations) even when the evidence-based verdict is
// AVOID -- the exact contradiction assertNoDecisionContradiction exists
// to catch after the fact. Telling the model the real verdict up front
// lets it self-condition every section instead of relying purely on a
// post-hoc gate.
// Named per-dimension breakdown of the blended verdict confidence above --
// injected into the same prompt context so a section discussing a
// specific topic (competitive intensity, market sizing, product fit) has
// its own real number to cite instead of only ever having access to the
// one blended figure. Confirmed live: without this, sections independently
// discussing different topics (market attractiveness, competitive
// intensity, product-market fit) all echoed the SAME confidence number --
// not because the underlying dimensions collapsed (evaluateMarketResearchCoverage
// computes each from genuinely distinct evidence and a distinct formula),
// but because the blended figure was the only number ever given to the
// model, so every section that wanted to cite "confidence" for its own
// topic had nothing else to reuse.
function buildDimensionBreakdownContext(
  dimensions: { marketConfidence: number; competitiveEvidence: number; financialEvidence: number; productEvidence: number },
  language: ResponseLanguage
): string {
  return marketText(
    language,
    ` These are four distinct evidence dimensions, each with its own score -- market evidence coverage ${dimensions.marketConfidence}/100, competitive evidence ${dimensions.competitiveEvidence}/100, financial/market-sizing evidence ${dimensions.financialEvidence}/100, product/market-fit evidence ${dimensions.productEvidence}/100. When a section discusses one of these specific topics, cite that topic's own number, never the blended verdict confidence above relabeled as if it were the dimension-specific score.`,
    ` Bunlar birbirinden farklı dört kanıt boyutudur, her birinin kendi puanı vardır -- pazar kanıt kapsamı ${dimensions.marketConfidence}/100, rekabet kanıtı ${dimensions.competitiveEvidence}/100, finansal/pazar büyüklüğü kanıtı ${dimensions.financialEvidence}/100, ürün/pazar uyumu kanıtı ${dimensions.productEvidence}/100. Bir bölüm bu konulardan birini ele alırken, o konunun kendi sayısını kullan; yukarıdaki karma karar güvenini boyuta özel bir puanmış gibi yeniden etiketleme.`,
    ` Dies sind vier unterschiedliche Evidenzdimensionen mit jeweils eigenem Wert -- Marktevidenzabdeckung ${dimensions.marketConfidence}/100, Wettbewerbsevidenz ${dimensions.competitiveEvidence}/100, Finanz-/Marktgrößenevidenz ${dimensions.financialEvidence}/100, Produkt-/Markttauglichkeitsevidenz ${dimensions.productEvidence}/100. Wenn ein Abschnitt eines dieser Themen behandelt, verwenden Sie dessen eigenen Wert -- nicht die obige gemischte Urteilskonfidenz, als wäre sie ein dimensionsspezifischer Wert.`,
    ` Ce sont quatre dimensions de preuves distinctes, chacune avec son propre score -- couverture des preuves de marché ${dimensions.marketConfidence}/100, preuves concurrentielles ${dimensions.competitiveEvidence}/100, preuves financières/de taille de marché ${dimensions.financialEvidence}/100, preuves d'adéquation produit-marché ${dimensions.productEvidence}/100. Lorsqu'une section traite l'un de ces sujets spécifiques, citez le score propre à ce sujet, jamais la confiance du verdict global ci-dessus reformulée comme si elle était ce score spécifique.`,
    ` Estas son cuatro dimensiones de evidencia distintas, cada una con su propia puntuación -- cobertura de evidencia de mercado ${dimensions.marketConfidence}/100, evidencia competitiva ${dimensions.competitiveEvidence}/100, evidencia financiera/de tamaño de mercado ${dimensions.financialEvidence}/100, evidencia de ajuste producto-mercado ${dimensions.productEvidence}/100. Cuando una sección trate uno de estos temas específicos, cite la puntuación propia de ese tema, nunca la confianza del veredicto global anterior reetiquetada como si fuera ese puntaje específico.`
  );
}

export function buildPreGenerationVerdictContext(
  assessment: { confidence: number; decision: MarketEntryDecision },
  language: ResponseLanguage,
  dimensions?: { marketConfidence: number; competitiveEvidence: number; financialEvidence: number; productEvidence: number }
): string {
  const localizedDecision = localizeMarketEntryDecision(assessment.decision, language);
  const dimensionSuffix = dimensions
    ? buildDimensionBreakdownContext(dimensions, language)
    : "";

  if (assessment.decision === "AVOID") {
    return marketText(
      language,
      `Based on the evidence coverage above, the deterministic verdict for this market will be ${localizedDecision} (confidence ${assessment.confidence}/100). Every section -- especially Strategic Recommendations, Opportunities, and Market Drivers -- must be fully consistent with an AVOID verdict: do not write unconditional growth, scaling, franchising, location-expansion, or execution advice as if entry is already the plan. Frame any such content explicitly as contingent on first closing the evidence gaps identified elsewhere in this report, never as an immediate directive.`,
      `Yukarıdaki kanıt kapsamına göre, bu pazar için belirlenecek kararın ${localizedDecision} (güven: ${assessment.confidence}/100) olacağı öngörülmektedir. Her bölüm -- özellikle Stratejik Öneriler, Fırsatlar ve Pazar İtici Güçleri -- bu HAYIR kararıyla tam olarak uyumlu olmalıdır: giriş kararı çoktan alınmış gibi koşulsuz büyüme, ölçeklendirme, franchise veya lokasyon genişletme tavsiyeleri yazma. Bu tür içerikleri, ancak raporun başka bir yerinde belirtilen kanıt boşlukları kapatıldıktan sonra geçerli olacak koşullu öneriler olarak çerçevele; asla anlık bir talimat gibi sunma.`,
      `Basierend auf der obigen Evidenzabdeckung wird das deterministische Urteil für diesen Markt ${localizedDecision} (Konfidenz ${assessment.confidence}/100) lauten. Jeder Abschnitt -- insbesondere Strategische Empfehlungen, Chancen und Markttreiber -- muss vollständig mit einem AVOID-Urteil übereinstimmen: Schreiben Sie keine bedingungslosen Wachstums-, Skalierungs-, Franchise- oder Standorterweiterungsempfehlungen, als wäre der Markteintritt bereits der Plan. Formulieren Sie solche Inhalte ausdrücklich als abhängig von der vorherigen Schließung der an anderer Stelle im Bericht genannten Evidenzlücken, niemals als unmittelbare Anweisung.`,
      `Sur la base de la couverture de preuves ci-dessus, le verdict déterministe pour ce marché sera ${localizedDecision} (confiance ${assessment.confidence}/100). Chaque section -- en particulier Recommandations stratégiques, Opportunités et Moteurs du marché -- doit être entièrement cohérente avec un verdict AVOID : ne rédigez pas de conseils de croissance, de mise à l'échelle, de franchise ou d'expansion géographique inconditionnels, comme si l'entrée était déjà décidée. Présentez ce type de contenu explicitement comme conditionné par la résolution préalable des lacunes de preuves mentionnées ailleurs dans le rapport, jamais comme une directive immédiate.`,
      `Según la cobertura de evidencia anterior, el veredicto determinista para este mercado será ${localizedDecision} (confianza ${assessment.confidence}/100). Cada sección -- especialmente Recomendaciones Estratégicas, Oportunidades e Impulsores del Mercado -- debe ser totalmente coherente con un veredicto AVOID: no escriba consejos incondicionales de crecimiento, escalamiento, franquicia o expansión de ubicaciones como si la entrada ya estuviera decidida. Presente dicho contenido explícitamente como condicionado a cerrar primero las brechas de evidencia señaladas en otras partes del informe, nunca como una directiva inmediata.`
    ) + dimensionSuffix;
  }

  if (assessment.decision === "MONITOR") {
    return marketText(
      language,
      `Based on the evidence coverage above, the deterministic verdict for this market will be ${localizedDecision} (confidence ${assessment.confidence}/100) -- a conditional stance, not a full green light. Every section must reflect that: frame growth/scale/expansion content as appropriate only for a bounded pilot gated on specific evidence improving, never as an unconditional immediate rollout.`,
      `Yukarıdaki kanıt kapsamına göre, bu pazar için belirlenecek kararın ${localizedDecision} (güven: ${assessment.confidence}/100) olacağı öngörülmektedir -- bu tam bir onay değil, koşullu bir duruştur. Her bölüm bunu yansıtmalıdır: büyüme/ölçeklendirme/genişleme içeriğini yalnızca belirli kanıtlar iyileştiğinde geçerli olacak sınırlı bir pilot için uygun olarak çerçevele, asla koşulsuz ve anlık bir uygulama olarak sunma.`,
      `Basierend auf der obigen Evidenzabdeckung wird das deterministische Urteil für diesen Markt ${localizedDecision} (Konfidenz ${assessment.confidence}/100) lauten -- eine bedingte Haltung, kein vollständiges grünes Licht. Jeder Abschnitt muss dies widerspiegeln: Formulieren Sie Wachstums-/Skalierungs-/Expansionsinhalte nur als geeignet für einen begrenzten, an bestimmte Evidenzverbesserungen gebundenen Piloten, niemals als bedingungslosen sofortigen Rollout.`,
      `Sur la base de la couverture de preuves ci-dessus, le verdict déterministe pour ce marché sera ${localizedDecision} (confiance ${assessment.confidence}/100) -- une position conditionnelle, pas un feu vert complet. Chaque section doit refléter cela : présentez le contenu de croissance/mise à l'échelle/expansion comme approprié uniquement pour un pilote encadré, conditionné à l'amélioration de preuves spécifiques, jamais comme un déploiement immédiat et inconditionnel.`,
      `Según la cobertura de evidencia anterior, el veredicto determinista para este mercado será ${localizedDecision} (confianza ${assessment.confidence}/100) -- una postura condicional, no una luz verde completa. Cada sección debe reflejar esto: presente el contenido de crecimiento/escalamiento/expansión como apropiado solo para un piloto acotado, condicionado a que mejore evidencia específica, nunca como un despliegue inmediato e incondicional.`
    ) + dimensionSuffix;
  }

  return marketText(
    language,
    `Based on the evidence coverage above, the deterministic verdict for this market will be ${localizedDecision} (confidence ${assessment.confidence}/100). Sections may write with confidence, but every claim must still stay traceable to the evidence registry -- confidence in the verdict is not license to overstate certainty on individual figures.`,
    `Yukarıdaki kanıt kapsamına göre, bu pazar için belirlenecek kararın ${localizedDecision} (güven: ${assessment.confidence}/100) olacağı öngörülmektedir. Bölümler güvenle yazılabilir, ancak her iddia yine de kanıt kayıt defterine dayandırılabilir olmalıdır -- kararın güveni, tekil rakamlarda kesinliği abartma lisansı değildir.`,
    `Basierend auf der obigen Evidenzabdeckung wird das deterministische Urteil für diesen Markt ${localizedDecision} (Konfidenz ${assessment.confidence}/100) lauten. Abschnitte können mit Zuversicht geschrieben werden, aber jede Behauptung muss weiterhin auf das Evidenzregister zurückführbar sein -- die Zuversicht im Urteil ist keine Lizenz, die Sicherheit einzelner Zahlen zu übertreiben.`,
    `Sur la base de la couverture de preuves ci-dessus, le verdict déterministe pour ce marché sera ${localizedDecision} (confiance ${assessment.confidence}/100). Les sections peuvent être rédigées avec assurance, mais chaque affirmation doit rester traçable au registre de preuves -- la confiance dans le verdict n'autorise pas à exagérer la certitude de chiffres individuels.`,
    `Según la cobertura de evidencia anterior, el veredicto determinista para este mercado será ${localizedDecision} (confianza ${assessment.confidence}/100). Las secciones pueden escribirse con confianza, pero cada afirmación debe seguir siendo trazable al registro de evidencia -- la confianza en el veredicto no es licencia para exagerar la certeza de cifras individuales.`
  ) + dimensionSuffix;
}

// Splits report prose into single-sentence candidates for extraction.
// AI-generated sections sometimes write every point as its own line/bullet,
// but just as often cram a whole ranked list into one dense paragraph like
// "Temel tehditler: (1) foo. (2) bar. (3) baz." -- naively taking that
// entire paragraph as "the one risk" produces an unreadable, multi-point
// quote everywhere it's reused (Biggest Risk, First 90 Days, the closing
// verdict). Splitting on the inline "(N)" markers and trimming each
// fragment to its first sentence keeps every extraction a single,
// quotable point regardless of which style the model used.
// CRITICAL FIX -- confirmed live: numbered-list markers only had to
// match the exact "(N)" shape to be treated as a split boundary --
// confirmed live artifact "Why: The opportunity -- "1) ..." shows the
// model also writes bare "1)"/"1." markers, sometimes immediately after
// an opening quote (a quoted inline enumeration embedded mid-sentence,
// e.g. `The opportunity -- "1) X; 2) Y"`). None of those matched the
// old parens-only pattern, so the marker (and its leading quote/dash)
// stayed glued to the fragment instead of being split away, and that raw
// fragment -- ending mid-list, still carrying its dangling quote --
// could be selected as "the" point. Every enumeration-marker shape is
// now a split boundary, and a stray leading/trailing quote character
// left over at a boundary is stripped from the resulting fragment.
// CRITICAL FIX -- confirmed live: the terminal-punctuation match below
// has no abbreviation awareness, so a mid-sentence abbreviation like
// "U.S." was misread as a sentence end -- "Construction firms in the
// U.S. are actively seeking..." was cut down to "Construction firms in
// the U." Mirrors report-presentation.ts's own splitSentences fix for
// the identical bug class: protect a known abbreviation's periods with a
// sentinel before matching, then restore them.
const SENTENCE_BOUNDARY_ABBREVIATIONS = [
  "U.S.", "U.K.", "U.N.", "E.U.", "U.A.E.",
  "e.g.", "i.e.", "etc.", "vs.", "cf.",
  "Inc.", "Corp.", "Ltd.", "Co.", "LLC.",
  "Dr.", "Mr.", "Mrs.", "Ms.", "Jr.", "Sr.", "St.", "Prof.", "Ph.D.",
  "a.m.", "p.m.", "No.", "approx.",
];

function protectSentenceBoundaryAbbreviations(value: string): string {
  return SENTENCE_BOUNDARY_ABBREVIATIONS.reduce((acc, abbreviation) => {
    const escaped = abbreviation.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return acc.replace(new RegExp(escaped, "g"), abbreviation.replace(/\./g, "\u0000"));
  }, value);
}

function restoreSentenceBoundaryAbbreviations(value: string): string {
  return value.replace(/\u0000/g, ".");
}

function splitIntoCandidateSentences(content: string): string[] {
  return (content || "")
    .split("\n")
    .flatMap((line) =>
      line
        .replace(/^[-*•]\s*/, "")
        .replace(/^#{1,6}\s*/, "")
        .split(/\s*["'“”‘’(]?\d{1,2}[).]\s*/)
    )
    .map((item) => item.trim().replace(/^["'“”‘’]+|["'“”‘’]+$/g, "").trim())
    .filter(Boolean)
    .map((item) => {
      // Drop a short "Label:" lead-in (e.g. "Temel tehditler:") that
      // precedes the first numbered point in the same paragraph.
      const withoutLeadIn = item.replace(/^[^:]{0,40}:\s*/, "").trim() || item;
      const protectedText = protectSentenceBoundaryAbbreviations(withoutLeadIn);
      const sentenceMatch = protectedText.match(/^[^.!?]*[.!?]/);
      const matched = sentenceMatch ? sentenceMatch[0] : protectedText;
      return restoreSentenceBoundaryAbbreviations(matched).trim();
    });
}

// Three heading/lead-in/dangling-fragment shapes that are never a genuine
// point worth quoting as "the" risk/opportunity/driver -- the real
// substance is in whatever follows them, not in the line itself:
// 1) A numbered sub-heading with no content of its own, e.g. "1) Yüksek
//    rekabet ve düşük giriş bariyerleri" -- real sentences in this
//    codebase's report prose always end in terminal punctuation, so a
//    numbered-marker line that doesn't is reliably a heading.
// 2) A lead-in sentence introducing a list, e.g. "...en çok katkıda
//    bulunan riskler ve tehditler şunlardır:" -- a trailing colon always
//    introduces what follows; it is never itself a complete point,
//    regardless of length or numbering.
// 3) CRITICAL FIX -- confirmed live: a lead-in fragment left dangling by
//    an enumeration-marker split (e.g. "The opportunity --" once its own
//    "1) ..." marker and quote are correctly split away above) ends in a
//    dash/colon/quote with nothing after it -- never a complete,
//    quotable point on its own, regardless of length.
function isHeadingOnlyLine(item: string): boolean {
  if (/:$/.test(item)) return true;
  if (/[-–—"'“”‘’]\s*$/.test(item)) return true;
  return /^\(?\d{1,2}[).]\s+\S/.test(item) && !/[.!?…]$/.test(item);
}

function isSubstantive(item: string): boolean {
  return item.length > 24 && !/^[A-Z0-9 /&-]{2,40}:?$/.test(item) && !isHeadingOnlyLine(item);
}

function firstSubstantiveLine(content: string) {
  const line = splitIntoCandidateSentences(content).find(isSubstantive);

  return line?.replace(/\*\*/g, "").trim() || "";
}

type MarketSections = Partial<Record<MarketReportField, string>>;

function biggestOpportunity(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.opportunities || "") ||
    marketText(
      language,
      "A defensible entry window exists but has not yet been fully validated.",
      "Savunulabilir bir giriş penceresi mevcut, ancak henüz tam olarak doğrulanmadı.",
      "Ein verteidigbares Zeitfenster für den Markteintritt besteht, ist jedoch noch nicht vollständig bestätigt.",
      "Une fenêtre d'entrée défendable existe, mais n'a pas encore été pleinement confirmée.",
      "Existe una ventana de entrada defendible que aún no se ha confirmado por completo."
    )
  );
}

// CRITICAL FIX -- remove internal system language from user-facing
// Market Intelligence output. "Verified market-size..." read as an
// internal audit-tool qualifier rather than something an executive
// report would say about its own data. Reworded around "data
// availability" -- the natural executive framing of the same fact
// (some inputs are not yet confirmed) -- without changing which
// condition triggers this fallback or what it is a fallback for.
function biggestRisk(sections: MarketSections, language: ResponseLanguage) {
  return (
    firstSubstantiveLine(sections.threats || "") ||
    marketText(
      language,
      "Data availability for market size and competitive positioning remains incomplete.",
      "Pazar büyüklüğü ve rekabet konumlandırmasına ilişkin veri erişilebilirliği henüz tam değil.",
      "Bestätigte Marktgrößen- und Wettbewerbsdaten sind weiterhin unvollständig.",
      "Les paramètres confirmés de taille de marché et de concurrence restent incomplets.",
      "Los parámetros confirmados de tamaño de mercado y competencia siguen siendo incompletos."
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
  const lines = splitIntoCandidateSentences(content)
    .filter(isSubstantive)
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
    `Bottom Line: ${localizedDecision}. Market confidence sits at ${confidence}/100, based on data coverage across market size, competition, and product demand. This is a directional market read, not a company-specific investment decision.`,
    `Sonuç: ${localizedDecision}. Pazar güveni, pazar büyüklüğü, rekabet ve ürün talebindeki veri kapsamına dayanarak 100 üzerinden ${confidence} seviyesindedir. Bu, şirkete özgü bir yatırım kararı değil, yönlü bir pazar değerlendirmesidir.`,
    `Kernaussage: ${localizedDecision}. Die Marktkonfidenz liegt bei ${confidence}/100, basierend auf der Datenabdeckung zu Marktgröße, Wettbewerb und Produktnachfrage. Dies ist eine richtungsweisende Markteinschätzung, keine unternehmensspezifische Investitionsentscheidung.`,
    `Conclusion : ${localizedDecision}. La confiance de marché est de ${confidence}/100, sur la base de la couverture des données relatives à la taille du marché, à la concurrence et à la demande produit. Il s'agit d'une lecture directionnelle du marché, non d'une décision d'investissement propre à une entreprise.`,
    `Conclusión: ${localizedDecision}. La confianza de mercado es de ${confidence}/100, basada en la cobertura de datos sobre el tamaño de mercado, la competencia y la demanda de producto. Esta es una lectura direccional del mercado, no una decisión de inversión específica de una empresa.`
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

  // AVOID must never be presented through an entry-oriented Why/Where/
  // When/How frame -- that structure itself implies entry is the plan.
  // Instead it answers: why not, what would have to change, and when to
  // reassess -- never suggesting a pilot, entry, or scale-up.
  if (decision === "AVOID") {
    const risk = biggestRisk(sections, language).replace(/[.!?]+$/, "");
    return [
      marketText(
        language,
        "Why Entry Is Not Recommended Now",
        "Şu An Girişin Önerilmediği Nedenler",
        "Warum ein Markteintritt derzeit nicht empfohlen wird",
        "Pourquoi l'entrée n'est pas recommandée actuellement",
        "Por qué no se recomienda la entrada ahora"
      ),
      marketText(
        language,
        `- Why not: ${risk}.`,
        `- Neden değil: ${risk}.`,
        `- Warum nicht: ${risk}.`,
        `- Pourquoi pas : ${risk}.`,
        `- Por qué no: ${risk}.`
      ),
      marketText(
        language,
        `- What would change this: confirmed, independent data that closes the "${risk}" gap.`,
        `- Bunu değiştirecek şey: "${risk}" boşluğunu kapatan onaylanmış, bağımsız veri.`,
        `- Was dies ändern würde: bestätigte, unabhängige Daten, die die Lücke „${risk}" schließen.`,
        `- Ce qui changerait cela : des données indépendantes confirmées comblant la lacune « ${risk} ».`,
        `- Qué cambiaría esto: datos independientes y confirmados que cierren la brecha "${risk}".`
      ),
      marketText(
        language,
        "- Reassess when: new confirmed data becomes available, not on a fixed calendar date.",
        "- Yeniden değerlendirme zamanı: sabit bir takvim tarihinde değil, yeni onaylanmış veri elde edildiğinde.",
        "- Neu bewerten, wenn: neue bestätigte Daten verfügbar werden, nicht zu einem festen Kalenderdatum.",
        "- Réévaluer lorsque : de nouvelles données confirmées deviennent disponibles, pas à une date calendaire fixe.",
        "- Reevaluar cuando: haya nuevos datos confirmados disponibles, no en una fecha fija del calendario."
      ),
    ].join("\n");
  }

  // Stripped of any trailing period here (once), since every template
  // below appends its own literal "." -- otherwise an already-complete
  // extracted sentence renders as "...sentence..".
  const why = topMarketDriver(sections, language).replace(/[.!?]+$/, "");
  const where = whereToEnter(sections, language).replace(/[.!?]+$/, "");
  const how = howToEnter(sections, language).replace(/[.!?]+$/, "");
  const when = marketText(
    language,
    confidence >= 65
      ? "immediately, while the current demand and competitive window holds"
      : confidence >= 40
        ? "after closing the highest-impact validation gap identified above"
        : "only after confirmed market-size and competitive data improve",
    confidence >= 65
      ? "mevcut talep ve rekabet penceresi sürerken hemen"
      : confidence >= 40
        ? "yukarıda belirlenen en etkili doğrulama boşluğu kapatıldıktan sonra"
        : "yalnızca onaylanmış pazar büyüklüğü ve rekabet verileri iyileştikten sonra",
    confidence >= 65
      ? "sofort, solange das aktuelle Nachfrage- und Wettbewerbsfenster bestehen bleibt"
      : confidence >= 40
        ? "nachdem die oben genannte wirkungsvollste Validierungslücke geschlossen wurde"
        : "erst nachdem sich bestätigte Marktgrößen- und Wettbewerbsdaten verbessert haben",
    confidence >= 65
      ? "immédiatement, tant que la fenêtre actuelle de demande et de concurrence est ouverte"
      : confidence >= 40
        ? "après avoir comblé la lacune de validation la plus impactante identifiée ci-dessus"
        : "seulement après l'amélioration des données confirmées de taille de marché et de concurrence",
    confidence >= 65
      ? "de inmediato, mientras se mantenga la ventana actual de demanda y competencia"
      : confidence >= 40
        ? "después de cerrar la brecha de validación de mayor impacto identificada anteriormente"
        : "solo después de que mejoren los datos confirmados de tamaño de mercado y competencia"
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

// Decision-code-conditioned single Immediate Next Action. GO gets
// execution language; CONDITIONAL_GO gets a bounded pilot; NO_GO must
// never contain entry/pilot/scale/execution language -- only evidence-
// gathering and a concrete re-entry trigger. Kept as one templated
// sentence per code (not a re-embedding of extracted market prose) so it
// can never become grammatically broken the way substituting a full
// AI-written sentence into a noun-phrase slot previously did.
function buildImmediateNextAction(code: ExecutiveDecisionCode, language: ResponseLanguage): string {
  if (code === "GO") {
    return marketText(
      language,
      "Begin execution immediately, following the Strategic Recommendations below -- the current demand and competitive window will not stay open indefinitely.",
      "Aşağıdaki Stratejik Öneriler doğrultusunda uygulamaya hemen başlayın -- mevcut talep ve rekabet penceresi süresiz açık kalmayacaktır.",
      "Beginnen Sie sofort mit der Umsetzung gemäß den untenstehenden strategischen Empfehlungen -- das aktuelle Nachfrage- und Wettbewerbsfenster bleibt nicht unbegrenzt offen.",
      "Commencez l'exécution immédiatement, en suivant les recommandations stratégiques ci-dessous -- la fenêtre actuelle de demande et de concurrence ne restera pas ouverte indéfiniment.",
      "Comience la ejecución de inmediato, siguiendo las recomendaciones estratégicas a continuación -- la ventana actual de demanda y competencia no permanecerá abierta indefinidamente."
    );
  }

  if (code === "CONDITIONAL_GO") {
    return marketText(
      language,
      "Launch only the bounded pilot described in the Strategic Recommendations below before making any wider commitment.",
      "Daha geniş bir taahhütte bulunmadan önce, aşağıdaki Stratejik Öneriler'de tanımlanan sınırlı pilotu başlatın.",
      "Starten Sie zunächst nur den in den strategischen Empfehlungen unten beschriebenen begrenzten Piloten, bevor Sie sich weiter verpflichten.",
      "Ne lancez que le pilote encadré décrit dans les recommandations stratégiques ci-dessous avant tout engagement plus large.",
      "Inicie únicamente el piloto acotado descrito en las recomendaciones estratégicas a continuación antes de asumir un compromiso más amplio."
    );
  }

  return marketText(
    language,
    "Do not commit budget to this market; instead, gather the missing information above and revisit the decision once it is resolved.",
    "Bu pazara bütçe ayırmayın; bunun yerine yukarıdaki gereken bilgileri toplayın ve bu bilgiler netleştiğinde kararı yeniden değerlendirin.",
    "Verpflichten Sie kein Budget für diesen Markt; sammeln Sie stattdessen die oben genannten fehlenden Informationen und überprüfen Sie die Entscheidung erneut, sobald diese vorliegen.",
    "N'engagez pas de budget sur ce marché ; recueillez plutôt les informations manquantes ci-dessus et réexaminez la décision une fois celles-ci obtenues.",
    "No comprometa presupuesto en este mercado; en su lugar, reúna la información faltante mencionada anteriormente y reconsidere la decisión una vez que esté disponible."
  );
}

// One sentence: the specific, falsifiable evidence that would flip this
// decision to a different code -- distinct from missingEvidence (which
// lists what's missing) by naming what change in that evidence would do.
function buildWhatWouldChangeThisDecision(
  code: ExecutiveDecisionCode,
  primaryRisk: string,
  language: ResponseLanguage
): string {
  const risk = primaryRisk.trim().replace(/[.!?]+$/, "");

  // CRITICAL FIX -- remove internal system language from user-facing
  // Market Intelligence output. A leading "Verified, independent
  // evidence..." reads as an internal audit-tool qualifier; reworded
  // around "validation status" -- the same underlying requirement
  // (independently confirmed, not self-reported) in natural executive
  // language. Only English and Turkish (this app's paired primary
  // languages) are reworded; German/French/Spanish keep their existing
  // wording unchanged.
  if (code === "GO") {
    return marketText(
      language,
      `A material worsening of "${risk}", or a newly confirmed competitive threat from an independent source, would be reason to revisit this decision toward a conditional stance.`,
      `"${risk}" durumunun önemli ölçüde kötüleşmesi veya bağımsız bir kaynaktan doğrulanan yeni bir rekabet tehdidi, bu kararın koşullu bir duruşa çekilmesini gerektirir.`,
      `Eine wesentliche Verschlechterung von „${risk}" oder eine neue, unabhängig bestätigte Wettbewerbsbedrohung wäre Grund, diese Entscheidung in Richtung einer bedingten Haltung zu überdenken.`,
      `Une aggravation significative de « ${risk} », ou une nouvelle menace concurrentielle confirmée de manière indépendante, justifierait de revoir cette décision vers une position conditionnelle.`,
      `Un deterioro importante de "${risk}", o una nueva amenaza competitiva confirmada de forma independiente, justificaría revisar esta decisión hacia una postura condicional.`
    );
  }

  if (code === "CONDITIONAL_GO") {
    return marketText(
      language,
      `A change in validation status for "${risk}" -- independent data that resolves it -- would move this to a full Go; further deterioration of the same data would move it to No-Go.`,
      `"${risk}" için doğrulama durumundaki bir değişiklik -- yani sorunu çözen bağımsız veriler -- bu kararı tam bir EVET'e taşır; aynı verinin daha da kötüleşmesi ise kararı HAYIR'a taşır.`,
      `Bestätigte, unabhängige Daten, die „${risk}" auflösen, würden dies zu einem vollständigen Go machen; eine weitere Verschlechterung derselben Daten würde es zu einem No-Go machen.`,
      `Des données indépendantes confirmées résolvant « ${risk} » feraient passer cette décision à un Go complet ; une nouvelle détérioration de ces mêmes données la ferait passer à No-Go.`,
      `Datos independientes y confirmados que resuelvan "${risk}" convertirían esto en un Go completo; un mayor deterioro de esos mismos datos lo convertiría en No-Go.`
    );
  }

  return marketText(
    language,
    `A change in validation status for "${risk}" -- such as a credible market-size source or independently confirmed competitor data -- would change this decision.`,
    `"${risk}" için doğrulama durumundaki bir değişiklik -- örneğin güvenilir bir pazar büyüklüğü kaynağı veya bağımsız olarak onaylanmış rakip verisi -- bu kararı değiştirir.`,
    `Bestätigte, unabhängige Daten, die „${risk}" auflösen -- etwa eine glaubwürdige Marktgrößenquelle oder unabhängig bestätigte Wettbewerberdaten -- würden diese Entscheidung ändern.`,
    `Des données indépendantes confirmées résolvant « ${risk} » -- telles qu'une source fiable de taille de marché ou des données concurrentielles confirmées de manière indépendante -- changeraient cette décision.`,
    `Datos independientes y confirmados que resuelvan "${risk}" -- como una fuente creíble de tamaño de mercado o datos de competidores confirmados de forma independiente -- cambiaría esta decisión.`
  );
}

// One-sentence synthesis of the decision's rationale -- the "Why" line
// directly under Confidence, distinct from the Top 3 Reasons bullets below
// it (which support this same synthesis with additional evidence).
function buildWhySynthesis(
  code: ExecutiveDecisionCode,
  primaryOpportunity: string,
  primaryRisk: string,
  language: ResponseLanguage
): string {
  const opportunity = primaryOpportunity.trim().replace(/[.!?]+$/, "");
  const risk = primaryRisk.trim().replace(/[.!?]+$/, "");

  if (code === "GO") {
    return marketText(
      language,
      `"${opportunity}" is well-supported by the available data and outweighs the identified risks at the current confidence level.`,
      `"${opportunity}" mevcut verilerle iyi desteklenmektedir ve şu anki güven seviyesinde belirlenen risklerden daha ağır basmaktadır.`,
      `„${opportunity}" wird durch die verfügbaren Daten gut gestützt und überwiegt die identifizierten Risiken beim aktuellen Konfidenzniveau.`,
      `« ${opportunity} » est bien étayé par les données disponibles et l'emporte sur les risques identifiés au niveau de confiance actuel.`,
      `"${opportunity}" está bien respaldado por los datos disponibles y supera a los riesgos identificados en el nivel de confianza actual.`
    );
  }

  if (code === "CONDITIONAL_GO") {
    return marketText(
      language,
      `The opportunity -- "${opportunity}" -- is plausible, but "${risk}" remains unresolved, so entry should be conditional on closing that gap rather than unconditional.`,
      `Fırsat -- "${opportunity}" -- makul görünüyor, ancak "${risk}" henüz çözülmemiştir; bu nedenle giriş koşulsuz değil, bu boşluğun kapatılmasına bağlı olmalıdır.`,
      `Die Chance -- „${opportunity}" -- ist plausibel, aber „${risk}" ist noch ungelöst, daher sollte der Eintritt an die Schließung dieser Lücke gebunden sein, nicht bedingungslos.`,
      `L'opportunité -- « ${opportunity} » -- est plausible, mais « ${risk} » reste non résolu, donc l'entrée doit être conditionnée à la résolution de cet écart plutôt qu'inconditionnelle.`,
      `La oportunidad -- "${opportunity}" -- es plausible, pero "${risk}" sigue sin resolverse, por lo que la entrada debe ser condicional al cierre de esa brecha y no incondicional.`
    );
  }

  return marketText(
    language,
    `"${risk}" outweighs the identified opportunity given the data currently available.`,
    `Şu anda mevcut olan veriler göz önüne alındığında, "${risk}" belirlenen fırsattan daha ağır basmaktadır.`,
    `„${risk}" überwiegt die identifizierte Chance angesichts der derzeit verfügbaren Daten.`,
    `« ${risk} » l'emporte sur l'opportunité identifiée compte tenu des données actuellement disponibles.`,
    `"${risk}" supera a la oportunidad identificada dados los datos actualmente disponibles.`
  );
}

// Confidence must always be traceable: short, concrete fragments (never a
// bare number, never generic hedging) explaining why the score is what it
// is, in whichever direction the evidence actually points.
function buildConfidenceExplanation(
  coverage: MarketResearchCoverage,
  confidence: number,
  language: ResponseLanguage
): { direction: "reduced" | "supported"; factors: string[] } {
  const { marketConfidence, competitiveEvidence, productEvidence } = coverage.dimensions;

  if (confidence >= 65) {
    const factors: string[] = [];
    if (coverage.verifiedMarketSizeAvailable) {
      factors.push(
        marketText(
          language,
          "confirmed market-size data available",
          "onaylanmış pazar büyüklüğü verisi mevcut",
          "bestätigte Marktgrößendaten vorhanden",
          "données de taille de marché confirmées disponibles",
          "datos de tamaño de mercado confirmados disponibles"
        )
      );
    }
    if (competitiveEvidence >= 65) {
      factors.push(
        marketText(
          language,
          "strong, independently confirmed competitive data",
          "güçlü, bağımsız olarak onaylanmış rekabet verisi",
          "starke, unabhängig bestätigte Wettbewerbsdaten",
          "données concurrentielles solides et confirmées de manière indépendante",
          "datos competitivos sólidos y confirmados de forma independiente"
        )
      );
    }
    if (productEvidence >= 65) {
      factors.push(
        marketText(
          language,
          "solid, independently confirmed product-market-fit data",
          "sağlam, bağımsız olarak onaylanmış ürün-pazar uyumu verisi",
          "solide, unabhängig bestätigte Product-Market-Fit-Daten",
          "données solides et confirmées de manière indépendante d'adéquation produit-marché",
          "datos sólidos y confirmados de forma independiente de ajuste producto-mercado"
        )
      );
    }
    if (marketConfidence >= 65) {
      factors.push(
        marketText(
          language,
          "broad overall market data coverage",
          "geniş kapsamlı genel pazar verisi",
          "breite Gesamtmarkt-Datenabdeckung",
          "large couverture globale des données de marché",
          "amplia cobertura general de datos de mercado"
        )
      );
    }
    return { direction: "supported", factors: factors.slice(0, 3) };
  }

  const factors: string[] = [];
  if (!coverage.verifiedMarketSizeAvailable) {
    factors.push(
      marketText(
        language,
        "confirmed market size unavailable",
        "onaylanmış pazar büyüklüğü mevcut değil",
        "bestätigte Marktgröße nicht verfügbar",
        "taille de marché confirmée indisponible",
        "tamaño de mercado confirmado no disponible"
      )
    );
  }
  if (competitiveEvidence < 50) {
    factors.push(
      marketText(
        language,
        "competitive landscape data incomplete",
        "rekabet ortamı verisi eksik",
        "Wettbewerbsumfeld-Daten unvollständig",
        "données du paysage concurrentiel incomplètes",
        "datos del panorama competitivo incompletos"
      )
    );
  }
  if (productEvidence < 50) {
    factors.push(
      marketText(
        language,
        "market fit data limited",
        "pazar uyumu verisi sınırlı",
        "Marktanpassungs-Daten begrenzt",
        "données d'adéquation au marché limitées",
        "datos de ajuste al mercado limitados"
      )
    );
  }
  if (marketConfidence < 50) {
    factors.push(
      marketText(
        language,
        "overall market data coverage below threshold",
        "genel pazar veri kapsamı eşiğin altında",
        "Gesamtmarkt-Datenabdeckung unter dem Schwellenwert",
        "couverture globale des données de marché sous le seuil",
        "cobertura general de datos de mercado por debajo del umbral"
      )
    );
  }
  return { direction: "reduced", factors: factors.slice(0, 3) };
}

// Named, concrete data gaps that could change the decision itself -- never
// a generic "more research is needed" caveat. Ranked weakest dimension
// first so the single most decision-relevant gap leads.
function identifyMarketInformationGaps(
  coverage: MarketResearchCoverage,
  language: ResponseLanguage,
  decisionCode: ExecutiveDecisionCode
): string[] {
  const gaps: Array<{ weight: number; text: string }> = [];

  if (!coverage.verifiedMarketSizeAvailable) {
    gaps.push({
      weight: 0,
      text: marketText(
        language,
        "An independently-sourced market-size figure (TAM/SAM/SOM or CAGR) was not confirmed -- the sizing in this report is a modeled estimate, not a confirmed fact.",
        "Onaylanmış, bağımsız kaynaklı bir pazar büyüklüğü verisi (TAM/SAM/SOM veya CAGR) bulunamadı; bu rapordaki büyüklük tahmini modellenmiş bir tahmindir, onaylanmış bir gerçek değildir.",
        "Es wurde keine bestätigte, unabhängige Marktgrößenangabe (TAM/SAM/SOM oder CAGR) gefunden -- die Größenangabe in diesem Bericht ist eine modellierte Schätzung, keine bestätigte Tatsache.",
        "Aucun chiffre de taille de marché confirmé et issu de sources indépendantes (TAM/SAM/SOM ou TCAC) n'a été trouvé -- l'estimation de ce rapport est modélisée, non confirmée.",
        "No se encontró una cifra de tamaño de mercado confirmada y de fuentes independientes (TAM/SAM/SOM o CAGR); la estimación de este informe es modelada, no un hecho confirmado."
      ),
    });
  }

  if (coverage.dimensions.competitiveEvidence < 50) {
    gaps.push({
      weight: coverage.dimensions.competitiveEvidence,
      text: marketText(
        language,
        "Independent, competitor-level data (market share, pricing, or unit economics) is limited -- competitive intensity here is inferred, not directly measured.",
        "Bağımsız, rakip düzeyinde veri (pazar payı, fiyatlandırma veya birim ekonomisi) sınırlıdır; buradaki rekabet yoğunluğu doğrudan ölçülmemiş, çıkarım yoluyla belirlenmiştir.",
        "Unabhängige, wettbewerberbezogene Daten (Marktanteil, Preisgestaltung oder Unit Economics) sind begrenzt -- die Wettbewerbsintensität ist hier abgeleitet, nicht direkt gemessen.",
        "Les données indépendantes au niveau des concurrents (part de marché, tarification ou économie unitaire) sont limitées -- l'intensité concurrentielle est ici déduite, non mesurée directement.",
        "Los datos independientes a nivel de competidores (cuota de mercado, precios o economía unitaria) son limitados; la intensidad competitiva aquí se infiere, no se mide directamente."
      ),
    });
  }

  if (coverage.dimensions.productEvidence < 50) {
    gaps.push({
      weight: coverage.dimensions.productEvidence,
      text: marketText(
        language,
        "Independent validation of real market fit (customer usage, retention, or third-party reviews) is limited.",
        "Gerçek pazar uyumuna ilişkin bağımsız doğrulama (müşteri kullanımı, elde tutma oranı veya üçüncü taraf incelemeleri) sınırlıdır.",
        "Unabhängige Validierung einer tatsächlichen Marktanpassung (Kundennutzung, Kundenbindung oder Bewertungen Dritter) ist begrenzt.",
        "La validation indépendante d'une réelle adéquation au marché (utilisation client, rétention ou avis de tiers) est limitée.",
        "La validación independiente de un ajuste real al mercado (uso del cliente, retención o reseñas de terceros) es limitada."
      ),
    });
  }

  if (coverage.dimensions.marketConfidence < 50) {
    gaps.push({
      weight: coverage.dimensions.marketConfidence,
      text: marketText(
        language,
        "Overall market validation coverage sits below the threshold for a high-confidence read -- targeted primary research (e.g. paid industry reports or direct customer interviews) would materially change this decision's confidence.",
        "Toplam pazar doğrulama kapsamı, yüksek güvenli bir değerlendirme için gereken eşiğin altındadır; hedefe yönelik birincil araştırma (örn. ücretli sektör raporları veya doğrudan müşteri görüşmeleri) bu kararın güven düzeyini önemli ölçüde değiştirebilir.",
        "Die gesamte Marktvalidierungsabdeckung liegt unter dem Schwellenwert für eine belastbare Einschätzung -- gezielte Primärforschung (z. B. kostenpflichtige Branchenberichte oder direkte Kundeninterviews) würde die Konfidenz dieser Entscheidung wesentlich verändern.",
        "La couverture globale de validation de marché est inférieure au seuil requis pour une lecture fiable -- une recherche primaire ciblée (rapports sectoriels payants ou entretiens clients directs) modifierait sensiblement la confiance de cette décision.",
        "La cobertura general de validación de mercado está por debajo del umbral necesario para una lectura de alta confianza; una investigación primaria específica (informes sectoriales de pago o entrevistas directas con clientes) cambiaría sustancialmente la confianza de esta decisión."
      ),
    });
  }

  // Every per-dimension check above is a ">= 50 passes" gate, but the
  // blended confidence that actually drives the decision can still land
  // below the full-GO threshold even when no single dimension is
  // individually weak (e.g. four dimensions each at 55-60 blend to a
  // MONITOR-band confidence with zero named gaps). Without this, a
  // non-GO report could render "no material data gaps were identified"
  // -- actively misleading for a decision that is explicitly not a clean
  // Enter. Only fires when the per-dimension checks above found nothing
  // AND the decision isn't a clean GO, so a genuine high-confidence GO
  // still correctly reports zero gaps.
  // CRITICAL FIX -- remove internal system language from user-facing
  // Market Intelligence output. "Blended confidence score falls
  // short..." read as a raw internal scoring readout rather than an
  // executive explanation; reworded around "planning confidence" --
  // the same underlying fact (the read is provisional pending more
  // evidence) in natural business language. Only English and Turkish
  // are reworded; German/French/Spanish keep their existing wording.
  if (gaps.length === 0 && decisionCode !== "GO") {
    gaps.push({
      weight: 0,
      text: marketText(
        language,
        "No single validation dimension is critically weak, but planning confidence for this market falls short of a full Enter decision -- the shortfall is in overall validation strength rather than one specific missing input. Treat this as an early-stage read pending stronger validation across the board.",
        "Tek başına kritik derecede zayıf bir doğrulama boyutu yok, ancak bu pazar için planlama güveni tam bir Gir kararı için yeterli değil; eksiklik tek bir belirli girdide değil, genel doğrulama gücündedir. Bunu, genel olarak daha güçlü doğrulama beklenen erken aşama bir değerlendirme olarak ele alın.",
        "Keine einzelne Validierungsdimension ist kritisch schwach, aber der gemischte Konfidenzwert reicht nicht für eine vollständige Enter-Entscheidung aus -- das Defizit liegt in der Gesamtvalidierungsstärke, nicht in einem einzelnen fehlenden Input. Betrachten Sie dies als Einschätzung auf Beobachtungsstufe, bis insgesamt stärkere Validierung vorliegt.",
        "Aucune dimension de validation n'est individuellement critique, mais le score de confiance combiné n'atteint pas le seuil d'une décision Enter complète -- le déficit porte sur la solidité globale de la validation, pas sur un input manquant précis. Considérez ceci comme une lecture de stade de surveillance en attendant une validation globalement plus solide.",
        "Ninguna dimensión de validación es críticamente débil por sí sola, pero la puntuación de confianza combinada no alcanza el umbral de una decisión Enter completa; el déficit está en la solidez general de la validación, no en un dato faltante específico. Trate esto como una lectura en etapa de monitoreo hasta contar con validación global más sólida."
      ),
    });
  }

  return gaps
    .sort((a, b) => a.weight - b.weight)
    .map((gap) => gap.text)
    .slice(0, 3);
}

// Maps ENTER/MONITOR/AVOID onto the shared, report-type-agnostic Executive
// Decision vocabulary for the mandatory, SINGLE opening block.
// MarketEntryDecision stays the authoritative decision everywhere else in
// this module -- this is a pure presentation mapping for the opening
// block only.
export function buildMarketExecutiveDecisionBrief(
  sections: MarketSections,
  language: ResponseLanguage,
  coverage: MarketResearchCoverage
): ExecutiveDecisionBrief {
  const { confidence, decision } = assessMarketEntryConfidence(coverage);
  const code: ExecutiveDecisionCode =
    decision === "ENTER" ? "GO" : decision === "MONITOR" ? "CONDITIONAL_GO" : "NO_GO";

  const primaryOpportunity = biggestOpportunity(sections, language);
  const primaryRisk = biggestRisk(sections, language);
  const additionalReasons = topSubstantiveLines(sections.opportunities || "", 3).filter(
    (line) => line !== primaryOpportunity
  );
  const additionalRisks = topSubstantiveLines(sections.threats || "", 3).filter(
    (line) => line !== primaryRisk
  );
  // The single best opportunity leads Top 3 Reasons; additional distinct
  // sentences fill the remaining slots so the list never repeats itself.
  const topReasons = [primaryOpportunity, ...additionalReasons]
    .filter(Boolean)
    .slice(0, 3);
  const topRisks = [primaryRisk, ...additionalRisks].filter(Boolean).slice(0, 3);
  const confidenceExplanation = buildConfidenceExplanation(coverage, confidence, language);

  return {
    decision: code,
    confidence,
    confidenceDirection: confidenceExplanation.direction,
    confidenceFactors: confidenceExplanation.factors,
    why: buildWhySynthesis(code, primaryOpportunity, primaryRisk, language),
    topReasons: topReasons.length ? topReasons : [topMarketDriver(sections, language)],
    topRisks,
    missingEvidence: identifyMarketInformationGaps(coverage, language, code),
    whatWouldChangeThisDecision: buildWhatWouldChangeThisDecision(code, primaryRisk, language),
    immediateNextAction: buildImmediateNextAction(code, language),
  };
}

// Deterministic closing verdict paragraph -- built from the exact same
// decision brief as the opening Executive Decision block, so it is
// structurally impossible for the two to contradict each other. Intended
// to be appended to whichever field renders on the report's final page
// (Sources, per ReportPdfButton.tsx's mergePdfSourceSections, which always
// forces Sources to the last position regardless of schema order).
export function buildMarketFinalVerdictParagraph(
  brief: ExecutiveDecisionBrief,
  language: ResponseLanguage
): string {
  const localizedDecision = localizeExecutiveDecision(brief.decision, language, "market");
  const heading = marketText(
    language,
    "Final Investment Decision",
    "Nihai Yatırım Kararı",
    "Endgültige Investitionsentscheidung",
    "Décision d'investissement finale",
    "Decisión de inversión final"
  );

  // topReasons[0]/topRisks[0] can be a full sentence from the report's
  // own prose -- quoted as a clause here (never used as a bare
  // grammatical subject), so the paragraph stays valid regardless of the
  // extracted sentence's own internal punctuation.
  const opportunityClause = (brief.topReasons[0] || "").trim().replace(/[.!?]+$/, "");
  const primaryRiskClause = (brief.topRisks[0] || "").trim().replace(/[.!?]+$/, "");

  const paragraph =
    brief.decision === "GO"
      ? marketText(
          language,
          `The verdict is ${localizedDecision} at ${brief.confidence}% confidence. The deciding factor -- "${opportunityClause}" -- outweighs the identified risks, and the Strategic Recommendations above are the fastest safe path to capturing it, so entry should proceed on that basis.`,
          `Karar %${brief.confidence} güvenle ${localizedDecision}: belirleyici unsur -- "${opportunityClause}" -- belirlenen risklerden daha ağır basmaktadır ve yukarıdaki Stratejik Öneriler bunu yakalamak için en hızlı güvenli yoldur; bu nedenle girişin bu temelde ilerlemesi gerekir.`,
          `Das Urteil lautet mit ${brief.confidence}% Konfidenz ${localizedDecision}. Der entscheidende Faktor -- „${opportunityClause}" -- überwiegt die identifizierten Risiken, und die obigen strategischen Empfehlungen sind der schnellste sichere Weg, sie zu nutzen, daher sollte der Markteintritt auf dieser Grundlage erfolgen.`,
          `Le verdict est ${localizedDecision} avec ${brief.confidence}% de confiance. Le facteur déterminant -- « ${opportunityClause} » -- l'emporte sur les risques identifiés, et les recommandations stratégiques ci-dessus sont la voie sûre la plus rapide pour la saisir, donc l'entrée doit se poursuivre sur cette base.`,
          `El veredicto es ${localizedDecision} con un ${brief.confidence}% de confianza. El factor decisivo -- "${opportunityClause}" -- supera a los riesgos identificados, y las recomendaciones estratégicas anteriores son la vía segura más rápida para capturarla, por lo que la entrada debe proceder sobre esta base.`
        )
      : brief.decision === "CONDITIONAL_GO"
        ? marketText(
            language,
            `The verdict is ${localizedDecision} at ${brief.confidence}% confidence. The opportunity is real, but the gap -- "${primaryRiskClause}" -- is not yet resolved, so entry should be limited to the bounded pilot above; full commitment is warranted only once that checkpoint is passed.`,
            `Karar %${brief.confidence} güvenle ${localizedDecision}: fırsat gerçek, ancak boşluk -- "${primaryRiskClause}" -- henüz çözülmemiştir; bu nedenle giriş yukarıdaki sınırlı pilotla sınırlı olmalıdır -- tam taahhüt yalnızca bu kontrol noktası geçildiğinde haklı olur.`,
            `Das Urteil lautet mit ${brief.confidence}% Konfidenz ${localizedDecision}. Die Chance ist real, aber die Lücke -- „${primaryRiskClause}" -- ist noch nicht geschlossen, daher sollte der Eintritt auf den oben genannten begrenzten Piloten beschränkt werden; eine vollständige Verpflichtung ist erst gerechtfertigt, wenn dieser Kontrollpunkt erreicht ist.`,
            `Le verdict est ${localizedDecision} avec ${brief.confidence}% de confiance. L'opportunité est réelle, mais la lacune -- « ${primaryRiskClause} » -- n'est pas encore comblée, donc l'entrée doit se limiter au pilote encadré ci-dessus ; un engagement complet n'est justifié qu'une fois ce point de contrôle franchi.`,
            `El veredicto es ${localizedDecision} con un ${brief.confidence}% de confianza. La oportunidad es real, pero la brecha -- "${primaryRiskClause}" -- aún no se ha cerrado, por lo que la entrada debe limitarse al piloto acotado anterior; el compromiso total solo se justifica una vez superado ese punto de control.`
          )
        : marketText(
            language,
            `The verdict is ${localizedDecision} at ${brief.confidence}% confidence. The deciding factor -- "${primaryRiskClause}" -- outweighs the identified opportunity today, so no entry, pilot, or expansion budget should be committed to this market until that specific gap is resolved with new, confirmed data.`,
            `Karar %${brief.confidence} güvenle ${localizedDecision}: belirleyici unsur -- "${primaryRiskClause}" -- bugün belirlenen fırsattan daha ağır basmaktadır; bu nedenle bu belirli boşluk yeni ve onaylanmış verilerle çözülene kadar bu pazara giriş, pilot veya genişleme bütçesi ayrılmamalıdır.`,
            `Das Urteil lautet mit ${brief.confidence}% Konfidenz ${localizedDecision}. Der entscheidende Faktor -- „${primaryRiskClause}" -- überwiegt die identifizierte Chance derzeit, daher sollte kein Budget für Markteintritt, Pilotprojekt oder Expansion in diesem Markt gebunden werden, bis diese spezifische Lücke durch neue, bestätigte Daten geschlossen ist.`,
            `Le verdict est ${localizedDecision} avec ${brief.confidence}% de confiance. Le facteur déterminant -- « ${primaryRiskClause} » -- l'emporte aujourd'hui sur l'opportunité identifiée, donc aucun budget d'entrée, de pilote ou d'expansion ne doit être engagé sur ce marché jusqu'à ce que cette lacune précise soit résolue par de nouvelles données confirmées.`,
            `El veredicto es ${localizedDecision} con un ${brief.confidence}% de confianza. El factor decisivo -- "${primaryRiskClause}" -- supera hoy a la oportunidad identificada, por lo que no debe comprometerse presupuesto de entrada, piloto o expansión en este mercado hasta que esa brecha específica se resuelva con datos nuevos y confirmados.`
          );

  return [heading, "", paragraph].join("\n");
}
