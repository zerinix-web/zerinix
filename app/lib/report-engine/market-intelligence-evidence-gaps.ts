// TASK #35 -- Make Market Intelligence evidence gaps explicitly
// decision-changing and actionable.
//
// PROBLEM (confirmed via audit of every unresolved-evidence label in this
// report kind): "Validation Needed"/"Validation Required"/"Key Assumption"
// labels correctly flag that evidence is missing or weak, but never state
// WHAT is missing, WHY it matters, WHAT would resolve it, or HOW it
// connects to the canonical ENTER/MONITOR/AVOID decision. A reader sees
// "Validation Required" next to SOM three separate times (cover, TAM/SAM/
// SOM section, Executive Summary) with no structured explanation tying
// those three labels together or to the decision itself.
//
// FIX: this module derives a small set of STRUCTURED evidence gaps
// directly from the SAME 3-pillar DecisionCriticalEvidenceState (and, for
// the non-gating growth-rate case, the SAME canonicalState.cagr array)
// every other Market Intelligence surface already reads as authoritative
// -- zero new interpretation logic, zero re-parsing of prose, zero new
// classification taxonomy. `decisionCriticalEvidence`'s own 3 booleans
// (marketSizingResolved/competitiveEvidenceResolved/obtainableShareResolved)
// ARE the canonical decision factors (see resolveDecisionCriticalEvidenceState,
// app/api/market-analysis/route.ts, and assessMarketEntryConfidence's own
// gating logic, market-intelligence-presentation.ts): a "strong" ENTER or
// AVOID is only ever returned when all three are resolved, otherwise the
// decision is forced to MONITOR. This module never invents a fourth
// pillar or a new gating rule -- it only explains, in structured form,
// exactly what those three pillars (plus CAGR, called out explicitly in
// this task's own audit list) already mean.
//
// Every gap's `evidenceRequired`/`validationMethod`/`whyItMatters` text is
// a static, per-language template describing the SAME evidence class the
// pillar itself already checks for (e.g. "a named, evidenced competitor"
// mirrors competitiveEvidenceResolved's own literal check:
// `vendors.length > 0 || adjacentPlayers.length > 0`) -- never a
// fabricated number or a generic "conduct more research" instruction.
// `successThreshold` is left null for every gap UNLESS the report's own
// generation-time decision brief (whatWouldChangeThisDecision) explicitly
// names one (e.g. "A validated SOM above 5% would upgrade this to
// ENTER.") -- extracted verbatim from that report's own real text, never
// invented by this module, satisfying "do not invent thresholds when the
// evidence does not justify them."

import type { ResponseLanguage } from "@/app/lib/report-language";
import { type EvidenceLevel, sourceTypeToEvidenceLevel } from "@/app/lib/report-evidence";
import {
  localizeExecutiveDecision,
  type ExecutiveDecisionCode,
} from "@/app/lib/report-engine/executive-decision-brief";
import {
  categorizeConfidenceScore,
  type DecisionCriticalEvidenceState,
  type MarketConfidenceFactorLevel,
} from "@/app/lib/report-engine/market-intelligence-presentation";
import {
  classifyStrategicRecommendationAction,
  resolveMarketIntelligenceExecutiveDecisionWithCanonicalState,
  type MarketIntelligenceCanonicalState,
  type MarketIntelligenceCanonicalMarketSizing,
  type StrategicRecommendationClassification,
} from "@/app/lib/report-engine/market-intelligence-canonical-state";
import {
  mapExecutiveDecisionCodeToCanonicalDecision,
  type MarketIntelligenceExecutiveDecision,
} from "@/app/lib/report-engine/executive-decision-vocabulary";

export type MarketIntelligenceDecisionFactor =
  | "marketSizingResolved"
  | "competitiveEvidenceResolved"
  | "obtainableShareResolved";

export type MarketIntelligenceEvidenceGapId =
  | "market-sizing"
  | "competitive-evidence"
  | "obtainable-share"
  | "growth-rate";

// A single, structured, decision-changing evidence gap -- every field
// named in this task's own requirement #2.
export type MarketIntelligenceEvidenceGap = {
  id: MarketIntelligenceEvidenceGapId;
  label: string;
  // null for a gap that does not independently gate the canonical
  // ENTER/MONITOR/AVOID decision (only "growth-rate" today) -- never a
  // fabricated 4th pillar; see this file's own top-of-file comment.
  decisionFactor: MarketIntelligenceDecisionFactor | null;
  // Whether the CURRENT (unresolved) state is a disclosed planning
  // assumption (e.g. SAM's default 25% serviceable-share ratio) as
  // opposed to a genuine total absence of evidence -- mirrors this
  // codebase's existing planning-assumption vocabulary
  // (STRATEGIC_RECOMMENDATION_PLANNING_ASSUMPTION_MARKER_PATTERN,
  // resolveMarketIntelligenceCagrEvidenceLevel's zero-item case) rather
  // than inventing a new one.
  isPlanningAssumption: boolean;
  whyItMatters: string;
  currentStatus: string;
  evidenceRequired: string;
  validationMethod: string;
  // Only ever a substring lifted verbatim from this report's OWN
  // generation-time whatWouldChangeThisDecision text -- never a value
  // this module invents. null when that text names no explicit
  // threshold.
  successThreshold: string | null;
  decisionImpact: string;
};

type LocalizedGapCopy = {
  label: string;
  whyItMatters: string;
  evidenceRequired: string;
  validationMethod: string;
};

const MARKET_SIZING_GAP_COPY: Record<ResponseLanguage, LocalizedGapCopy> = {
  English: {
    label: "Market Size",
    whyItMatters:
      "Without a credible total market size, no obtainable-share or return-on-entry estimate elsewhere in this report can be trusted.",
    evidenceRequired:
      "An independently verified total market size figure, or sufficient buyer-population and pricing evidence to build a defensible bottom-up estimate.",
    validationMethod:
      "Source a paid or published market-sizing report from a recognized research firm, or commission bottom-up buyer-population and pricing research.",
  },
  Turkish: {
    label: "Pazar Büyüklüğü",
    whyItMatters:
      "Güvenilir bir toplam pazar büyüklüğü olmadan, bu raporun başka hiçbir yerindeki ulaşılabilir pay veya giriş getirisi tahmini güvenilir olamaz.",
    evidenceRequired:
      "Bağımsız olarak doğrulanmış bir toplam pazar büyüklüğü rakamı, ya da savunulabilir bir aşağıdan-yukarı tahmin oluşturacak yeterli alıcı nüfusu ve fiyatlandırma kanıtı.",
    validationMethod:
      "Tanınmış bir araştırma firmasından ücretli veya yayımlanmış bir pazar büyüklüğü raporu tedarik edin, ya da aşağıdan-yukarı alıcı nüfusu ve fiyatlandırma araştırması yaptırın.",
  },
  German: {
    label: "Marktgröße",
    whyItMatters:
      "Ohne eine glaubwürdige Gesamtmarktgröße kann keine andere Schätzung des erzielbaren Anteils oder der Eintrittsrendite in diesem Bericht vertrauenswürdig sein.",
    evidenceRequired:
      "Eine unabhängig verifizierte Gesamtmarktgröße oder ausreichende Käuferpopulations- und Preisnachweise für eine belastbare Bottom-up-Schätzung.",
    validationMethod:
      "Beschaffen Sie einen kostenpflichtigen oder veröffentlichten Marktgrößenbericht eines anerkannten Forschungsunternehmens, oder beauftragen Sie eine Bottom-up-Käuferpopulations- und Preisrecherche.",
  },
  French: {
    label: "Taille du marché",
    whyItMatters:
      "Sans une taille de marché totale crédible, aucune estimation de part accessible ou de retour sur entrée ailleurs dans ce rapport ne peut être fiable.",
    evidenceRequired:
      "Un chiffre de taille de marché total vérifié de manière indépendante, ou des preuves suffisantes de population d'acheteurs et de tarification pour construire une estimation ascendante défendable.",
    validationMethod:
      "Obtenez un rapport de dimensionnement de marché payant ou publié par un cabinet de recherche reconnu, ou commandez une recherche ascendante sur la population d'acheteurs et la tarification.",
  },
  Spanish: {
    label: "Tamaño del mercado",
    whyItMatters:
      "Sin un tamaño de mercado total creíble, ninguna otra estimación de cuota alcanzable o retorno de entrada en este informe puede ser confiable.",
    evidenceRequired:
      "Una cifra de tamaño de mercado total verificada de forma independiente, o evidencia suficiente de población de compradores y precios para construir una estimación ascendente defendible.",
    validationMethod:
      "Obtenga un informe de dimensionamiento de mercado pagado o publicado por una firma de investigación reconocida, o encargue una investigación ascendente de población de compradores y precios.",
  },
};

const COMPETITIVE_EVIDENCE_GAP_COPY: Record<ResponseLanguage, LocalizedGapCopy> = {
  English: {
    label: "Competitive Landscape",
    whyItMatters:
      "Without named competitors or adjacent players, the competitive landscape and pricing benchmarks elsewhere in this report are unverified.",
    evidenceRequired:
      "At least one named, evidenced competitor or adjacent player actually operating in this market.",
    validationMethod:
      "Run structured competitor discovery (industry directories, review platforms, analyst coverage, funding databases) to identify and verify named participants.",
  },
  Turkish: {
    label: "Rekabet Ortamı",
    whyItMatters:
      "Adı belirtilen rakipler veya yakın oyuncular olmadan, bu raporun başka yerlerindeki rekabet ortamı ve fiyatlandırma karşılaştırmaları doğrulanmamış kalır.",
    evidenceRequired:
      "Bu pazarda gerçekten faaliyet gösteren, adı belirtilmiş ve kanıtlanmış en az bir rakip veya yakın oyuncu.",
    validationMethod:
      "Adlandırılmış katılımcıları tespit edip doğrulamak için yapılandırılmış rakip keşfi yapın (sektör dizinleri, inceleme platformları, analist raporları, finansman veritabanları).",
  },
  German: {
    label: "Wettbewerbslandschaft",
    whyItMatters:
      "Ohne benannte Wettbewerber oder angrenzende Akteure sind die Wettbewerbslandschaft und die Preis-Benchmarks an anderer Stelle in diesem Bericht nicht verifiziert.",
    evidenceRequired:
      "Mindestens ein benannter, belegter Wettbewerber oder angrenzender Akteur, der tatsächlich in diesem Markt tätig ist.",
    validationMethod:
      "Führen Sie eine strukturierte Wettbewerberrecherche durch (Branchenverzeichnisse, Bewertungsplattformen, Analystenberichte, Finanzierungsdatenbanken), um benannte Teilnehmer zu identifizieren und zu verifizieren.",
  },
  French: {
    label: "Paysage concurrentiel",
    whyItMatters:
      "Sans concurrents nommés ou acteurs adjacents, le paysage concurrentiel et les repères tarifaires ailleurs dans ce rapport ne sont pas vérifiés.",
    evidenceRequired:
      "Au moins un concurrent nommé et étayé, ou un acteur adjacent, opérant réellement sur ce marché.",
    validationMethod:
      "Menez une découverte structurée des concurrents (annuaires sectoriels, plateformes d'avis, couverture d'analystes, bases de données de financement) pour identifier et vérifier des participants nommés.",
  },
  Spanish: {
    label: "Panorama competitivo",
    whyItMatters:
      "Sin competidores nombrados o actores adyacentes, el panorama competitivo y los puntos de referencia de precios en otras partes de este informe no están verificados.",
    evidenceRequired:
      "Al menos un competidor nombrado y respaldado por evidencia, o un actor adyacente, que realmente opere en este mercado.",
    validationMethod:
      "Realice un descubrimiento estructurado de competidores (directorios del sector, plataformas de reseñas, cobertura de analistas, bases de datos de financiación) para identificar y verificar participantes nombrados.",
  },
};

const OBTAINABLE_SHARE_GAP_COPY: Record<ResponseLanguage, LocalizedGapCopy> = {
  English: {
    label: "Obtainable Share (SAM/SOM)",
    whyItMatters:
      "Obtainable share determines whether this specific business can realistically capture enough of the market to justify entry -- a large total market does not by itself guarantee a viable share of it.",
    evidenceRequired:
      "Verified conversion, win-rate, or pilot evidence showing how much of the serviceable market this business can realistically capture.",
    validationMethod:
      "Run a paid pilot, letter-of-intent campaign, or comparable-company benchmarking effort to establish a defensible obtainable-share percentage.",
  },
  Turkish: {
    label: "Ulaşılabilir Pay (SAM/SOM)",
    whyItMatters:
      "Ulaşılabilir pay, bu işletmenin pazara girişi haklı çıkaracak kadar pazar payı elde edip edemeyeceğini belirler -- büyük bir toplam pazar tek başına uygulanabilir bir pay garanti etmez.",
    evidenceRequired:
      "Bu işletmenin hizmet verilebilir pazarın ne kadarını gerçekçi biçimde ele geçirebileceğini gösteren doğrulanmış dönüşüm, kazanma oranı veya pilot kanıtı.",
    validationMethod:
      "Savunulabilir bir ulaşılabilir pay yüzdesi belirlemek için ücretli bir pilot, niyet mektubu kampanyası veya karşılaştırılabilir şirket kıyaslaması yürütün.",
  },
  German: {
    label: "Erzielbarer Anteil (SAM/SOM)",
    whyItMatters:
      "Der erzielbare Anteil bestimmt, ob dieses konkrete Unternehmen realistisch genug Marktanteil erobern kann, um den Eintritt zu rechtfertigen -- ein großer Gesamtmarkt garantiert für sich genommen keinen tragfähigen Anteil daran.",
    evidenceRequired:
      "Verifizierte Konversions-, Gewinnraten- oder Pilotnachweise, die zeigen, wie viel vom bedienbaren Markt dieses Unternehmen realistisch erobern kann.",
    validationMethod:
      "Führen Sie einen kostenpflichtigen Pilotversuch, eine Absichtserklärungs-Kampagne oder einen Vergleichsunternehmens-Benchmark durch, um einen belastbaren erzielbaren Anteilsprozentsatz zu ermitteln.",
  },
  French: {
    label: "Part accessible (SAM/SOM)",
    whyItMatters:
      "La part accessible détermine si cette entreprise spécifique peut réalistement capter suffisamment de marché pour justifier son entrée -- un vaste marché total ne garantit pas à lui seul une part viable.",
    evidenceRequired:
      "Des preuves vérifiées de conversion, de taux de réussite ou de pilote montrant quelle part du marché desservable cette entreprise peut réalistement capter.",
    validationMethod:
      "Menez un pilote payant, une campagne de lettres d'intention, ou un exercice de comparaison avec des entreprises similaires pour établir un pourcentage de part accessible défendable.",
  },
  Spanish: {
    label: "Cuota alcanzable (SAM/SOM)",
    whyItMatters:
      "La cuota alcanzable determina si esta empresa específica puede capturar realistamente suficiente mercado para justificar la entrada -- un gran mercado total no garantiza por sí solo una cuota viable.",
    evidenceRequired:
      "Evidencia verificada de conversión, tasa de éxito o piloto que muestre cuánto del mercado servible puede capturar realistamente esta empresa.",
    validationMethod:
      "Realice un piloto pagado, una campaña de cartas de intención, o un ejercicio de comparación con empresas similares para establecer un porcentaje de cuota alcanzable defendible.",
  },
};

const GROWTH_RATE_GAP_COPY: Record<ResponseLanguage, LocalizedGapCopy> = {
  English: {
    label: "Market Growth Rate (CAGR)",
    whyItMatters:
      "Growth rate shapes whether this market is worth entering now versus later, and whether revenue projections built on top of it are directional or provisional.",
    evidenceRequired:
      "A verified or credibly estimated compound annual growth rate from named market research.",
    validationMethod:
      "Source published market-growth research, or triangulate a growth rate from multiple verified market-size figures over time.",
  },
  Turkish: {
    label: "Pazar Büyüme Oranı (CAGR)",
    whyItMatters:
      "Büyüme oranı, bu pazara şimdi mi yoksa daha sonra mı girilmesi gerektiğini ve bunun üzerine kurulan gelir projeksiyonlarının yönlü mü yoksa geçici mi olduğunu belirler.",
    evidenceRequired:
      "Adlandırılmış pazar araştırmasından doğrulanmış veya güvenilir biçimde tahmin edilmiş bir yıllık bileşik büyüme oranı.",
    validationMethod:
      "Yayımlanmış pazar büyüme araştırması edinin veya zaman içindeki birden fazla doğrulanmış pazar büyüklüğü rakamından bir büyüme oranı türetin.",
  },
  German: {
    label: "Marktwachstumsrate (CAGR)",
    whyItMatters:
      "Die Wachstumsrate bestimmt, ob sich ein Eintritt in diesen Markt jetzt oder später lohnt, und ob darauf aufbauende Umsatzprognosen richtungsweisend oder vorläufig sind.",
    evidenceRequired:
      "Eine verifizierte oder glaubwürdig geschätzte jährliche Wachstumsrate aus benannter Marktforschung.",
    validationMethod:
      "Beschaffen Sie veröffentlichte Marktwachstumsforschung, oder leiten Sie eine Wachstumsrate aus mehreren verifizierten Marktgrößenzahlen im Zeitverlauf ab.",
  },
  French: {
    label: "Taux de croissance du marché (TCAC)",
    whyItMatters:
      "Le taux de croissance détermine s'il vaut la peine d'entrer sur ce marché maintenant ou plus tard, et si les projections de revenus qui en découlent sont directionnelles ou provisoires.",
    evidenceRequired:
      "Un taux de croissance annuel composé vérifié ou estimé de manière crédible, issu d'une recherche de marché nommée.",
    validationMethod:
      "Obtenez une recherche publiée sur la croissance du marché, ou triangulez un taux de croissance à partir de plusieurs chiffres de taille de marché vérifiés dans le temps.",
  },
  Spanish: {
    label: "Tasa de crecimiento del mercado (CAGR)",
    whyItMatters:
      "La tasa de crecimiento determina si vale la pena entrar en este mercado ahora o más adelante, y si las proyecciones de ingresos construidas sobre ella son direccionales o provisionales.",
    evidenceRequired:
      "Una tasa de crecimiento anual compuesta verificada o estimada de forma creíble a partir de investigación de mercado nombrada.",
    validationMethod:
      "Obtenga investigación publicada sobre el crecimiento del mercado, o triangule una tasa de crecimiento a partir de varias cifras de tamaño de mercado verificadas a lo largo del tiempo.",
  },
};

const MARKET_SIZING_UNRESOLVED_STATUS: Record<ResponseLanguage, string> = {
  English: "No verified market-size figure and no defensible planning estimate exists for this market yet.",
  Turkish: "Bu pazar için henüz doğrulanmış bir pazar büyüklüğü rakamı veya savunulabilir bir planlama tahmini bulunmuyor.",
  German: "Für diesen Markt existiert noch keine verifizierte Marktgrößenzahl und keine belastbare Planungsschätzung.",
  French: "Aucun chiffre de taille de marché vérifié ni estimation de planification défendable n'existe encore pour ce marché.",
  Spanish: "Aún no existe una cifra de tamaño de mercado verificada ni una estimación de planificación defendible para este mercado.",
};

const COMPETITIVE_EVIDENCE_UNRESOLVED_STATUS: Record<ResponseLanguage, string> = {
  English: "No named vendors or adjacent competitors were identified with supporting evidence.",
  Turkish: "Destekleyici kanıtlarla adlandırılmış hiçbir tedarikçi veya yakın rakip tespit edilmedi.",
  German: "Es wurden keine benannten Anbieter oder angrenzenden Wettbewerber mit unterstützenden Nachweisen identifiziert.",
  French: "Aucun fournisseur nommé ni concurrent adjacent n'a été identifié avec des preuves à l'appui.",
  Spanish: "No se identificaron proveedores nombrados ni competidores adyacentes con evidencia de respaldo.",
};

const SAM_DEFAULT_ASSUMPTION_STATUS: Record<ResponseLanguage, string> = {
  English:
    "The serviceable addressable market (SAM) currently uses a disclosed default share assumption rather than market-specific evidence, so the obtainable share built on top of it remains unresolved.",
  Turkish:
    "Hizmet verilebilir adreslenebilir pazar (SAM) şu anda pazara özgü kanıtlar yerine açıkça belirtilmiş bir varsayılan pay varsayımı kullanıyor, bu nedenle üzerine kurulan ulaşılabilir pay çözümlenmemiş durumda.",
  German:
    "Der bedienbare adressierbare Markt (SAM) verwendet derzeit eine offengelegte Standard-Anteilsannahme anstelle marktspezifischer Nachweise, sodass der darauf aufbauende erzielbare Anteil ungeklärt bleibt.",
  French:
    "Le marché adressable desservable (SAM) utilise actuellement une hypothèse de part par défaut divulguée plutôt que des preuves spécifiques au marché, de sorte que la part accessible qui en découle reste non résolue.",
  Spanish:
    "El mercado direccionable servible (SAM) utiliza actualmente un supuesto de cuota predeterminado divulgado en lugar de evidencia específica del mercado, por lo que la cuota alcanzable construida sobre él permanece sin resolver.",
};

const OBTAINABLE_SHARE_GENERIC_UNRESOLVED_STATUS: Record<ResponseLanguage, string> = {
  English: "Obtainable share (SOM) has not cleared this report's evidence bar for a calculated figure.",
  Turkish: "Ulaşılabilir pay (SOM), bu raporun hesaplanmış bir rakam için gereken kanıt eşiğini geçmedi.",
  German: "Der erzielbare Anteil (SOM) hat die Nachweisschwelle dieses Berichts für eine berechnete Zahl nicht erreicht.",
  French: "La part accessible (SOM) n'a pas franchi le seuil de preuve de ce rapport pour un chiffre calculé.",
  Spanish: "La cuota alcanzable (SOM) no ha superado el umbral de evidencia de este informe para una cifra calculada.",
};

const GROWTH_RATE_UNRESOLVED_STATUS: Record<ResponseLanguage, string> = {
  English: "No qualifying growth-rate evidence was found for this market.",
  Turkish: "Bu pazar için nitelikli bir büyüme oranı kanıtı bulunamadı.",
  German: "Für diesen Markt wurden keine qualifizierenden Wachstumsraten-Nachweise gefunden.",
  French: "Aucune preuve de taux de croissance qualifiante n'a été trouvée pour ce marché.",
  Spanish: "No se encontró evidencia de tasa de crecimiento calificada para este mercado.",
};

// Fixed, decision-type-keyed question -- never generated prose. Mirrors
// this task's own wording exactly, using the SAME localized ENTER/
// MONITOR/AVOID vocabulary (localizeExecutiveDecision, "market") every
// other Market Intelligence surface already displays, so the question
// never names a decision token the rest of the report doesn't also use.
export function resolveMarketIntelligenceDecisionChangeQuestion(
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage = "English"
): string {
  const enter = localizeExecutiveDecision("GO", language, "market");
  const templates: Record<ExecutiveDecisionCode, Record<ResponseLanguage, string>> = {
    GO: {
      English: `What unresolved evidence could invalidate or downgrade ${enter}?`,
      Turkish: `Hangi çözümlenmemiş kanıtlar ${enter} kararını geçersiz kılabilir veya düşürebilir?`,
      German: `Welche ungeklärten Belege könnten ${enter} entkräften oder herabstufen?`,
      French: `Quelles preuves non résolues pourraient invalider ou déclasser ${enter} ?`,
      Spanish: `¿Qué evidencia no resuelta podría invalidar o degradar ${enter}?`,
    },
    CONDITIONAL_GO: {
      English: `What specifically prevents ${enter}?`,
      Turkish: `${enter} kararına özellikle ne engel oluyor?`,
      German: `Was genau verhindert ${enter}?`,
      French: `Qu'est-ce qui empêche précisément ${enter} ?`,
      Spanish: `¿Qué impide específicamente ${enter}?`,
    },
    NO_GO: {
      English: "What evidence, if any, could justify reconsideration?",
      Turkish: "Varsa, hangi kanıtlar bu kararın yeniden değerlendirilmesini haklı çıkarabilir?",
      German: "Welche Belege könnten, falls vorhanden, eine erneute Prüfung rechtfertigen?",
      French: "Quelles preuves, le cas échéant, pourraient justifier un réexamen ?",
      Spanish: "¿Qué evidencia, si la hay, podría justificar una reconsideración?",
    },
  };
  return templates[decision][language];
}

function countUnresolvedPillars(evidence: DecisionCriticalEvidenceState): number {
  return [evidence.marketSizingResolved, evidence.competitiveEvidenceResolved, evidence.obtainableShareResolved].filter(
    (resolved) => !resolved
  ).length;
}

// Connects a single gap to the canonical decision, WITHOUT re-deriving or
// second-guessing that decision -- it only describes, honestly, what
// resolving (or continuing to leave unresolved) this specific gap means
// for the decision canonical state already holds. Never claims resolving
// one gap alone flips the decision when others remain unresolved too.
function buildDecisionImpactSentence(
  decision: ExecutiveDecisionCode,
  unresolvedCount: number,
  language: ResponseLanguage
): string {
  const monitor = localizeExecutiveDecision("CONDITIONAL_GO", language, "market");
  const enter = localizeExecutiveDecision("GO", language, "market");
  const isOnlyGap = unresolvedCount <= 1;

  if (decision === "CONDITIONAL_GO") {
    const templates: Record<ResponseLanguage, [string, string]> = {
      English: [
        `This is the only unresolved decision-critical factor currently keeping the decision at ${monitor} instead of ${enter}.`,
        `This is one of ${unresolvedCount} unresolved decision-critical factors currently keeping the decision at ${monitor} instead of ${enter}.`,
      ],
      Turkish: [
        `Bu, kararın ${enter} yerine ${monitor} olarak kalmasına neden olan tek çözümlenmemiş karar-kritik faktördür.`,
        `Bu, kararın ${enter} yerine ${monitor} olarak kalmasına neden olan ${unresolvedCount} çözümlenmemiş karar-kritik faktörden biridir.`,
      ],
      German: [
        `Dies ist der einzige ungeklärte entscheidungskritische Faktor, der die Entscheidung derzeit bei ${monitor} statt bei ${enter} hält.`,
        `Dies ist einer von ${unresolvedCount} ungeklärten entscheidungskritischen Faktoren, die die Entscheidung derzeit bei ${monitor} statt bei ${enter} halten.`,
      ],
      French: [
        `C'est le seul facteur déterminant non résolu qui maintient actuellement la décision à ${monitor} au lieu de ${enter}.`,
        `C'est l'un des ${unresolvedCount} facteurs déterminants non résolus qui maintiennent actuellement la décision à ${monitor} au lieu de ${enter}.`,
      ],
      Spanish: [
        `Este es el único factor crítico para la decisión sin resolver que mantiene actualmente la decisión en ${monitor} en lugar de ${enter}.`,
        `Este es uno de los ${unresolvedCount} factores críticos para la decisión sin resolver que mantienen actualmente la decisión en ${monitor} en lugar de ${enter}.`,
      ],
    };
    return templates[language][isOnlyGap ? 0 : 1];
  }

  if (decision === "NO_GO") {
    const templates: Record<ResponseLanguage, string> = {
      English:
        "Resolving this would be a prerequisite for reconsidering this decision -- it does not by itself guarantee a different outcome.",
      Turkish: "Bunun çözülmesi, bu kararın yeniden değerlendirilmesi için bir ön koşul olur -- tek başına farklı bir sonucu garanti etmez.",
      German:
        "Die Klärung wäre eine Voraussetzung für eine erneute Prüfung dieser Entscheidung -- sie garantiert für sich genommen kein anderes Ergebnis.",
      French:
        "Résoudre ce point serait un préalable à un réexamen de cette décision -- cela ne garantit pas en soi un résultat différent.",
      Spanish:
        "Resolver esto sería un requisito previo para reconsiderar esta decisión -- por sí solo no garantiza un resultado diferente.",
    };
    return templates[language];
  }

  // decision === "GO"
  const templates: Record<ResponseLanguage, string> = {
    English: `Although the current decision is ${enter}, this factor remains unresolved and its continued absence could justify downgrading or revisiting that decision.`,
    Turkish: `Mevcut karar ${enter} olsa da, bu faktör çözümlenmemiş durumda ve devam eden yokluğu bu kararın düşürülmesini veya yeniden gözden geçirilmesini haklı çıkarabilir.`,
    German: `Obwohl die aktuelle Entscheidung ${enter} lautet, bleibt dieser Faktor ungeklärt, und sein fortbestehendes Fehlen könnte eine Herabstufung oder erneute Prüfung dieser Entscheidung rechtfertigen.`,
    French: `Bien que la décision actuelle soit ${enter}, ce facteur reste non résolu et son absence persistante pourrait justifier un déclassement ou un réexamen de cette décision.`,
    Spanish: `Aunque la decisión actual es ${enter}, este factor permanece sin resolver y su ausencia continua podría justificar la degradación o revisión de esa decisión.`,
  };
  return templates[language];
}

const GROWTH_RATE_DECISION_IMPACT: Record<ResponseLanguage, string> = {
  English:
    "This does not independently determine the ENTER/MONITOR/AVOID decision, but weak growth evidence reduces confidence in the market's future trajectory.",
  Turkish:
    "Bu, GİR/İZLE/KAÇIN kararını tek başına belirlemez, ancak zayıf büyüme kanıtı pazarın gelecekteki seyrine olan güveni azaltır.",
  German:
    "Dies bestimmt nicht eigenständig die Entscheidung EINTRETEN/BEOBACHTEN/VERMEIDEN, aber schwache Wachstumsnachweise verringern das Vertrauen in die zukünftige Entwicklung des Marktes.",
  French:
    "Cela ne détermine pas indépendamment la décision ENTRER/SURVEILLER/ÉVITER, mais des preuves de croissance faibles réduisent la confiance dans la trajectoire future du marché.",
  Spanish:
    "Esto no determina de forma independiente la decisión ENTRAR/MONITOREAR/EVITAR, pero la evidencia de crecimiento débil reduce la confianza en la trayectoria futura del mercado.",
};

// Only ever extracts a threshold the report's OWN generation-time
// decision brief already states verbatim (e.g. "A validated SOM above 5%
// would upgrade this to ENTER.") -- never a value this module invents.
// Percentage-scoped: obtainable share (SAM/SOM) is inherently a
// share-of-market concept, so this is the only figure SHAPE that gap's
// own threshold is ever expressed in.
const NAMED_SUCCESS_THRESHOLD_PATTERN =
  /\b(?:above|over|exceeding|beyond|at least)\s+[\d.,]+\s?%|\b[\d.,]+\s?%\s+(?:or\s+(?:higher|more|above))/i;

function extractNamedSuccessThreshold(whatWouldChangeThisDecision: string): string | null {
  const match = whatWouldChangeThisDecision.match(NAMED_SUCCESS_THRESHOLD_PATTERN);
  return match ? match[0].trim() : null;
}

// TASK #48 -- the market-sizing counterpart to
// extractNamedSuccessThreshold, DELIBERATELY scoped to DOLLAR figures
// only (market size is inherently a currency-amount concept, never a
// percentage) -- a SEPARATE pattern rather than one shared "any numeric
// bar" scan, specifically so a single whatWouldChangeThisDecision
// sentence that names BOTH a market-size bar ("a verified TAM above $2
// billion") AND an obtainable-share bar ("obtainable share above 10%")
// can never have BOTH gaps accidentally resolve to the SAME (first-
// matched) figure -- each gap only ever looks for the figure SHAPE its
// own underlying metric is actually expressed in, never a keyword/gap-
// name search over the surrounding words.
const NAMED_DOLLAR_THRESHOLD_PATTERN =
  /\b(?:above|over|exceeding|beyond|at least)\s+[$€₺]\s?[\d.,]+\s?(?:thousand|million|billion|trillion|[kKmMbB])?\b/i;

function extractNamedMarketSizeThreshold(whatWouldChangeThisDecision: string): string | null {
  const match = whatWouldChangeThisDecision.match(NAMED_DOLLAR_THRESHOLD_PATTERN);
  return match ? match[0].trim() : null;
}

function buildObtainableShareCurrentStatus(
  marketSizing: MarketIntelligenceCanonicalMarketSizing | null,
  language: ResponseLanguage
): string {
  if (!marketSizing) return OBTAINABLE_SHARE_GENERIC_UNRESOLVED_STATUS[language];
  // The model's own "pending" SOM explanation is already a real,
  // non-fabricated sentence generated specifically for this report (see
  // MarketPlanningEstimate.somStatus's own comment) -- reusing it verbatim
  // is more informative and more defensible than a generic template, and
  // never contradicts what the report itself already says elsewhere.
  if (marketSizing.somStatus === "pending" && marketSizing.som.trim()) {
    return marketSizing.som.trim();
  }
  if (marketSizing.samMethod !== "evidenceDerived") {
    return SAM_DEFAULT_ASSUMPTION_STATUS[language];
  }
  return OBTAINABLE_SHARE_GENERIC_UNRESOLVED_STATUS[language];
}

// The single, canonical-state-only entry point every render surface
// (page.tsx, Planner.tsx web + PDF, ReportPdfButton.tsx) must call for
// structured evidence-gap data -- never independently reconstructed from
// prose. Returns gaps ONLY for evidence that is actually unresolved
// (decisionCriticalEvidence's own booleans, plus an empty cagr array) --
// an empty return means every pillar this report gates on is genuinely
// resolved, never an omission.
export function resolveMarketIntelligenceEvidenceGaps(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceEvidenceGap[] {
  if (!canonicalState) return [];

  const { decision, decisionCriticalEvidence, marketSizing, cagr, whatWouldChangeThisDecision } = canonicalState;
  const unresolvedCount = countUnresolvedPillars(decisionCriticalEvidence);
  const gaps: MarketIntelligenceEvidenceGap[] = [];

  if (!decisionCriticalEvidence.marketSizingResolved) {
    const copy = MARKET_SIZING_GAP_COPY[language];
    gaps.push({
      id: "market-sizing",
      label: copy.label,
      decisionFactor: "marketSizingResolved",
      isPlanningAssumption: false,
      whyItMatters: copy.whyItMatters,
      currentStatus: MARKET_SIZING_UNRESOLVED_STATUS[language],
      evidenceRequired: copy.evidenceRequired,
      validationMethod: copy.validationMethod,
      // TASK #48 -- previously always null; now sourced verbatim from
      // the report's own text via the dollar-scoped extractor above,
      // exactly when it actually names a directional market-size bar --
      // never invented, still null for the overwhelming majority of
      // reports that name no explicit market-size bar for themselves.
      successThreshold: extractNamedMarketSizeThreshold(whatWouldChangeThisDecision),
      decisionImpact: buildDecisionImpactSentence(decision, unresolvedCount, language),
    });
  }

  if (!decisionCriticalEvidence.competitiveEvidenceResolved) {
    const copy = COMPETITIVE_EVIDENCE_GAP_COPY[language];
    gaps.push({
      id: "competitive-evidence",
      label: copy.label,
      decisionFactor: "competitiveEvidenceResolved",
      isPlanningAssumption: false,
      whyItMatters: copy.whyItMatters,
      currentStatus: COMPETITIVE_EVIDENCE_UNRESOLVED_STATUS[language],
      evidenceRequired: copy.evidenceRequired,
      validationMethod: copy.validationMethod,
      successThreshold: null,
      decisionImpact: buildDecisionImpactSentence(decision, unresolvedCount, language),
    });
  }

  if (!decisionCriticalEvidence.obtainableShareResolved) {
    const copy = OBTAINABLE_SHARE_GAP_COPY[language];
    gaps.push({
      id: "obtainable-share",
      label: copy.label,
      decisionFactor: "obtainableShareResolved",
      isPlanningAssumption: Boolean(marketSizing && marketSizing.samMethod !== "evidenceDerived"),
      whyItMatters: copy.whyItMatters,
      currentStatus: buildObtainableShareCurrentStatus(marketSizing, language),
      evidenceRequired: copy.evidenceRequired,
      validationMethod: copy.validationMethod,
      successThreshold: extractNamedSuccessThreshold(whatWouldChangeThisDecision),
      decisionImpact: buildDecisionImpactSentence(decision, unresolvedCount, language),
    });
  }

  if (cagr.length === 0) {
    const copy = GROWTH_RATE_GAP_COPY[language];
    gaps.push({
      id: "growth-rate",
      label: copy.label,
      decisionFactor: null,
      isPlanningAssumption: true,
      whyItMatters: copy.whyItMatters,
      currentStatus: GROWTH_RATE_UNRESOLVED_STATUS[language],
      evidenceRequired: copy.evidenceRequired,
      validationMethod: copy.validationMethod,
      successThreshold: null,
      decisionImpact: GROWTH_RATE_DECISION_IMPACT[language],
    });
  }

  return gaps;
}

// The single bundle Executive Summary (and its PDF counterpart) render
// from -- the fixed decision-type question plus the SAME gaps every other
// consumer reads, pre-split into material (decision-gating) vs supporting
// (non-gating) so a caller can surface "the most important unresolved
// evidence" without re-deriving materiality itself.
export type MarketIntelligenceDecisionChangeState = {
  decision: ExecutiveDecisionCode;
  question: string;
  materialGaps: MarketIntelligenceEvidenceGap[];
  supportingGaps: MarketIntelligenceEvidenceGap[];
};

export function resolveMarketIntelligenceDecisionChangeState(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceDecisionChangeState | null {
  if (!canonicalState) return null;
  const gaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language);
  return {
    decision: canonicalState.decision,
    question: resolveMarketIntelligenceDecisionChangeQuestion(canonicalState.decision, language),
    materialGaps: gaps.filter((gap) => gap.decisionFactor !== null),
    supportingGaps: gaps.filter((gap) => gap.decisionFactor === null),
  };
}

// Executive Summary integration (requirement #4): "surface only the
// highest-impact decision-changing gaps... avoid clutter." Material
// (decision-gating) gaps always outrank supporting ones; only when NO
// material gap exists (a genuinely resolved decision) does a supporting
// gap like growth-rate surface instead, so a fully-resolved ENTER/AVOID
// report is never shown a misleadingly labeled "top gap".
export function selectTopMarketIntelligenceEvidenceGaps(
  gaps: readonly MarketIntelligenceEvidenceGap[],
  maxCount = 2
): MarketIntelligenceEvidenceGap[] {
  const material = gaps.filter((gap) => gap.decisionFactor !== null);
  if (material.length > 0) return material.slice(0, maxCount);
  return gaps.slice(0, maxCount);
}

// Strategic Recommendations integration (requirement #6): a bounded,
// fully structured action derived ONLY from the gap object every other
// surface already reads -- gap -> validation action -> measurable result
// -> decision consequence. Never re-parses or matches against the
// separately AI-generated recommendation cards (extractRecommendationItems,
// report-presentation.ts): those remain untouched, this is purely
// additive canonical-state-driven content. Only material (decision-
// gating) gaps produce an action here -- a non-gating gap like growth-rate
// does not warrant a "close this to change the decision" action, since it
// structurally cannot change the decision on its own.
// TASK #36 -- Make Market Intelligence decision thresholds explicit and
// structurally tied to evidence gaps.
//
// PROBLEM: Task #35 explains WHAT is missing and WHY it matters, but not
// WHAT MEASURABLE RESULT from closing that gap would actually move the
// canonical decision -- a reader knows Obtainable Share is unresolved and
// that it is "the only unresolved decision-critical factor keeping the
// decision at MONITOR instead of ENTER," but not what a validation effort
// would need to show to earn ENTER, what result leaves it at MONITOR, or
// what result would support AVOID.
//
// FIX: a per-gap "decision threshold" -- three conditions (ENTER/MONITOR/
// AVOID), each either a real number the report's OWN generation-time
// decision brief (whatWouldChangeThisDecision) already states, or an
// honest "Threshold requires validation" placeholder. This NEVER invents
// a universal numeric bar: the only source of a quantified condition is
// text this exact report already generated for itself, confirmed to
// actually reference that specific decision token (see
// extractDecisionLinkedThresholdPhrase below) so a coincidental nearby
// number is never misattributed to the wrong direction. MONITOR's
// condition never needs a number at all -- "the status quo persists
// while this gap stays unresolved" is always true and requires no
// fabrication.
//
// This is NOT a second decision engine: it reads the SAME
// decisionCriticalEvidence pillars, the SAME canonicalState.decision, and
// the SAME per-gap data resolveMarketIntelligenceEvidenceGaps already
// computes -- it only explains, per gap, what result would move each of
// those existing pillars. No new persisted field and no canonical-state
// version bump are needed: every input (decision, decisionCriticalEvidence,
// marketSizing, cagr, whatWouldChangeThisDecision) is already part of
// MarketIntelligenceCanonicalState, so this is a pure, deterministic
// function of already-canonical, already-persisted data -- correct
// immediately for every existing persisted report, not just newly
// generated ones.

// TASK #37 -- named per decision type ("ENTER threshold requires
// validation." rather than a generic "Threshold requires validation.")
// so a reader (and a test) can tell at a glance WHICH direction's
// condition is unsupported, per this task's own explicit example
// wording. Uses the SAME localized ENTER/MONITOR/AVOID token
// (localizeExecutiveDecision, "market") every other Market Intelligence
// surface already displays.
function buildThresholdRequiresValidationText(
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage
): string {
  const token = localizeExecutiveDecision(decision, language, "market");
  const templates: Record<ResponseLanguage, string> = {
    English: `${token} threshold requires validation.`,
    Turkish: `${token} eşiği doğrulama gerektiriyor.`,
    German: `${token}-Schwellenwert erfordert Validierung.`,
    French: `Le seuil ${token} nécessite une validation.`,
    Spanish: `El umbral de ${token} requiere validación.`,
  };
  return templates[language];
}

// Only ever captures a DIRECTIONAL phrase (e.g. "above 5%", "below 10%")
// that already exists verbatim in the report's own text -- never a bare
// number torn from its context, and never invented independently of that
// text.
const DIRECTIONAL_THRESHOLD_PATTERN =
  /\b(?:above|over|exceeding|beyond|at least|below|under|less than)\s+[\d.,]+\s?%|\b[\d.,]+\s?%\s+(?:or\s+(?:higher|more|above|lower|less))/i;

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Confirms a quantified phrase is actually LINKED to the given decision --
// i.e. it appears in the same sentence as that decision's own localized
// token (ENTER/MONITOR/AVOID in English, GİR/İZLE/KAÇIN in Turkish, ...) --
// so a number that happens to sit elsewhere in the same paragraph, about a
// different outcome, is never misattributed. Returns null (never a guess)
// whenever no sentence names both the decision and a directional figure.
function extractDecisionLinkedThresholdPhrase(
  text: string,
  decision: ExecutiveDecisionCode,
  language: ResponseLanguage
): string | null {
  if (!text) return null;
  const token = localizeExecutiveDecision(decision, language, "market");
  const tokenPattern = new RegExp(`\\b${escapeRegExpLiteral(token)}\\b`, "i");
  const sentences = text.split(/(?<=[.!?])\s+/);
  for (const sentence of sentences) {
    if (tokenPattern.test(sentence)) {
      const match = sentence.match(DIRECTIONAL_THRESHOLD_PATTERN);
      if (match) return match[0].trim();
    }
  }
  return null;
}

// TASK #51 -- Make Market Intelligence decision thresholds evidence-
// qualified, not merely recommendation-derived.
//
// AUDIT FINDING: buildRecommendationEnterCriterion (Task #38) already
// appends its provenance label directly onto its own description text
// (e.g. "...ACV >= USD 25k (Validation Target)."), but this report-
// stated-threshold description -- and buildRecommendationAvoidCriterion's
// own "Validation fails to meet..." sentence just below -- never did,
// even though BOTH already carry the correct provenance on their own
// structured MarketIntelligenceThresholdCriterion.provenance field
// (isPlanningAssumption was already tracked; it just never reached the
// VISIBLE text a reader actually sees in ENTER IF/AVOID IF/Closure Plan
// Success/Failure Criterion). A reader could see a report-stated
// planning-assumption figure with no visible qualifier at all, right
// next to a recommendation-derived figure that DOES show one --
// inconsistent, and exactly the "presented as if verified" risk this
// task closes. isPlanningAssumption now selects the SAME two-value
// provenance/label vocabulary (validationTarget/planningAssumption,
// via localizeRecommendationProvenance) every recommendation-derived
// criterion already uses -- never a new, separately-worded label.
function buildQuantifiedThresholdDescription(
  gapLabel: string,
  directionalPhrase: string,
  isPlanningAssumption: boolean,
  language: ResponseLanguage
): string {
  const provenanceLabel = localizeRecommendationProvenance(
    isPlanningAssumption ? "planningAssumption" : "validationTarget",
    language
  );
  const templates: Record<ResponseLanguage, string> = {
    English: `${gapLabel} ${directionalPhrase} (stated in this report's own decision brief; ${provenanceLabel}).`,
    Turkish: `${gapLabel} ${directionalPhrase} (bu raporun kendi karar özetinde belirtilmiştir; ${provenanceLabel}).`,
    German: `${gapLabel} ${directionalPhrase} (in der eigenen Entscheidungszusammenfassung dieses Berichts angegeben; ${provenanceLabel}).`,
    French: `${gapLabel} ${directionalPhrase} (indiqué dans la note de décision de ce rapport ; ${provenanceLabel}).`,
    Spanish: `${gapLabel} ${directionalPhrase} (indicado en el resumen de decisión de este informe; ${provenanceLabel}).`,
  };
  return templates[language];
}

function buildMonitorStatusQuoDescription(gapLabel: string, language: ResponseLanguage): string {
  const templates: Record<ResponseLanguage, string> = {
    English: `Remains unchanged while ${gapLabel} stays unresolved.`,
    Turkish: `${gapLabel} çözümlenmeden kaldığı sürece değişmeden kalır.`,
    German: `Bleibt unverändert, solange ${gapLabel} ungeklärt bleibt.`,
    French: `Reste inchangé tant que ${gapLabel} n'est pas résolu.`,
    Spanish: `Permanece sin cambios mientras ${gapLabel} siga sin resolver.`,
  };
  return templates[language];
}

export type MarketIntelligenceDecisionThresholdConditionStatus = "defined" | "requiresValidation";

export type MarketIntelligenceDecisionThresholdCondition = {
  status: MarketIntelligenceDecisionThresholdConditionStatus;
  description: string;
  // Inherited directly from the gap's own isPlanningAssumption (never a
  // separate assessment) -- if the current unresolved state rests on a
  // disclosed planning assumption (e.g. SAM's default share ratio), any
  // threshold built around it rests on that same assumption until it is
  // replaced with real evidence.
  isPlanningAssumption: boolean;
};

// One gap's decision threshold -- answers this task's own 6 questions:
// (1)/(2) evidenceRequired/measurementMethod (reused verbatim from the
// gap, never re-derived); (3)/(4)/(5) enter/monitor/avoidCondition; (6)
// affectedFactor (the real gating pillar this threshold, if satisfied,
// would change).
export type MarketIntelligenceDecisionThreshold = {
  gapId: MarketIntelligenceEvidenceGapId;
  gapLabel: string;
  affectedFactor: MarketIntelligenceDecisionFactor;
  // Always "unresolved" today, since a threshold is only ever built for a
  // gap that resolveMarketIntelligenceEvidenceGaps already found
  // unresolved -- kept as an explicit field (rather than implied) so a
  // future partially-resolved state has somewhere to be represented
  // without a breaking type change.
  currentStatus: "unresolved";
  enterCondition: MarketIntelligenceDecisionThresholdCondition;
  monitorCondition: MarketIntelligenceDecisionThresholdCondition;
  avoidCondition: MarketIntelligenceDecisionThresholdCondition;
  measurementMethod: string;
  evidenceRequired: string;
};

function buildDecisionThresholdForGap(
  gap: MarketIntelligenceEvidenceGap,
  canonicalState: MarketIntelligenceCanonicalState,
  language: ResponseLanguage
): MarketIntelligenceDecisionThreshold {
  const whatWouldChange = canonicalState.whatWouldChangeThisDecision;
  const enterPhrase = extractDecisionLinkedThresholdPhrase(whatWouldChange, "GO", language);
  const monitorPhrase = extractDecisionLinkedThresholdPhrase(whatWouldChange, "CONDITIONAL_GO", language);
  const avoidPhrase = extractDecisionLinkedThresholdPhrase(whatWouldChange, "NO_GO", language);

  return {
    gapId: gap.id,
    gapLabel: gap.label,
    affectedFactor: gap.decisionFactor as MarketIntelligenceDecisionFactor,
    currentStatus: "unresolved",
    enterCondition: enterPhrase
      ? {
          status: "defined",
          description: buildQuantifiedThresholdDescription(gap.label, enterPhrase, gap.isPlanningAssumption, language),
          isPlanningAssumption: gap.isPlanningAssumption,
        }
      : {
          status: "requiresValidation",
          description: buildThresholdRequiresValidationText("GO", language),
          isPlanningAssumption: gap.isPlanningAssumption,
        },
    // MONITOR's condition never requires a fabricated number -- "the
    // status quo persists while this gap is unresolved" is always
    // defensible on its own. Still checked against the report's own text
    // first (a report can, in principle, explicitly state what keeps it
    // at MONITOR with a real figure), falling back to that structural
    // statement in the overwhelming majority of real reports.
    monitorCondition: monitorPhrase
      ? {
          status: "defined",
          description: buildQuantifiedThresholdDescription(gap.label, monitorPhrase, gap.isPlanningAssumption, language),
          isPlanningAssumption: gap.isPlanningAssumption,
        }
      : {
          status: "defined",
          description: buildMonitorStatusQuoDescription(gap.label, language),
          isPlanningAssumption: gap.isPlanningAssumption,
        },
    avoidCondition: avoidPhrase
      ? {
          status: "defined",
          description: buildQuantifiedThresholdDescription(gap.label, avoidPhrase, gap.isPlanningAssumption, language),
          isPlanningAssumption: gap.isPlanningAssumption,
        }
      : {
          status: "requiresValidation",
          description: buildThresholdRequiresValidationText("NO_GO", language),
          isPlanningAssumption: gap.isPlanningAssumption,
        },
    // Reused verbatim from the gap -- "reuse structured assumptions
    // rather than creating unrelated new numbers": validationMethod
    // already names the concrete real-world validation approach (a paid
    // pilot, an LOI campaign, comparable-company benchmarking, ...) this
    // report's own architecture already assigns to this evidence class,
    // never a second, independently invented method.
    measurementMethod: gap.validationMethod,
    evidenceRequired: gap.evidenceRequired,
  };
}

// The single, canonical-state-only entry point every render surface must
// call for decision-threshold data -- never independently reconstructed
// from prose. Only material (decision-gating) gaps get a threshold: a
// non-gating gap (growth-rate) cannot move the canonical decision on its
// own, so attaching ENTER/MONITOR/AVOID conditions to it would falsely
// imply it could.
export function resolveMarketIntelligenceDecisionThresholds(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceDecisionThreshold[] {
  if (!canonicalState) return [];
  return resolveMarketIntelligenceEvidenceGaps(canonicalState, language)
    .filter((gap) => gap.decisionFactor !== null)
    .map((gap) => buildDecisionThresholdForGap(gap, canonicalState, language));
}

export type MarketIntelligenceGapDrivenAction = {
  gapId: MarketIntelligenceEvidenceGapId;
  gapLabel: string;
  action: string;
  measurableResult: string;
  decisionConsequence: string;
  // TASK #36 -- the SAME per-gap decision threshold
  // resolveMarketIntelligenceDecisionThresholds computes, attached
  // directly here so every render site gets action + threshold as one
  // paired unit instead of computing and matching two separate arrays
  // (a second, avoidable per-surface reconciliation step).
  threshold: MarketIntelligenceDecisionThreshold;
};

export function buildMarketIntelligenceGapDrivenActions(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceGapDrivenAction[] {
  if (!canonicalState) return [];
  return resolveMarketIntelligenceEvidenceGaps(canonicalState, language)
    .filter((gap) => gap.decisionFactor !== null)
    .map((gap) => ({
      gapId: gap.id,
      gapLabel: gap.label,
      action: gap.validationMethod,
      measurableResult: gap.successThreshold || gap.evidenceRequired,
      decisionConsequence: gap.decisionImpact,
      threshold: buildDecisionThresholdForGap(gap, canonicalState, language),
    }));
}

// TASK #37 -- Make Market Intelligence ENTER / MONITOR / AVOID decision
// thresholds structurally authoritative.
//
// PROBLEM: Task #36 already makes each individual gap's threshold
// structured (never fabricated), but there was no SINGLE canonical
// object a caller could read to get "every ENTER condition across the
// whole report," "every unresolved decision-critical condition," or "the
// one condition currently controlling MONITOR" -- callers had to loop
// over resolveMarketIntelligenceDecisionThresholds themselves and
// reconstruct that view ad hoc, risking a second, slightly different
// aggregation per render site.
//
// FIX: one aggregate, resolveMarketIntelligenceDecisionThresholdState,
// built ONLY by re-shaping resolveMarketIntelligenceDecisionThresholds'
// and resolveMarketIntelligenceEvidenceGaps' own already-computed,
// already-tested output -- zero new interpretation logic, zero new
// numeric extraction. This is a pure reshape/aggregation layer, not a
// second decision engine: it never reads decisionCriticalEvidence,
// marketSizing, or whatWouldChangeThisDecision directly, only the
// threshold/gap objects those functions already derived from them.
export type MarketIntelligenceDecisionCondition = {
  // null only in principle (every condition this module actually
  // produces comes from a real gap, which always has a factor or is
  // explicitly non-gating) -- kept nullable so a future non-pillar-based
  // condition has somewhere to represent "does not gate the decision"
  // without a breaking type change.
  factor: MarketIntelligenceDecisionFactor | null;
  label: string;
  requiredEvidence: string;
  currentStatus: string;
  isDecisionCritical: boolean;
  // True only when a real, report-specific number was found (never a
  // universal constant) -- mirrors the underlying condition's own
  // "defined" vs "requiresValidation" status.
  isThresholdSupported: boolean;
  description: string;
  isPlanningAssumption: boolean;
};

function toDecisionCondition(
  threshold: MarketIntelligenceDecisionThreshold,
  condition: MarketIntelligenceDecisionThresholdCondition
): MarketIntelligenceDecisionCondition {
  return {
    factor: threshold.affectedFactor,
    label: threshold.gapLabel,
    requiredEvidence: threshold.evidenceRequired,
    currentStatus: threshold.currentStatus,
    isDecisionCritical: true,
    isThresholdSupported: condition.status === "defined",
    description: condition.description,
    isPlanningAssumption: condition.isPlanningAssumption,
  };
}

// The single, canonical, structured model every render surface must
// read for ENTER / MONITOR / AVOID threshold information (requirement
// #2). `decision` is copied straight from canonicalState -- included so
// a caller never needs a second lookup to confirm which decision these
// conditions are explaining, and so a regression test can assert this
// state can never disagree with the canonical decision it was built
// from.
export type MarketIntelligenceCanonicalThresholdState = {
  decision: ExecutiveDecisionCode;
  // One entry per material (decision-gating) gap's ENTER condition --
  // requirement #3: ENTER is only ever "isThresholdSupported: true" when
  // this report's own decision brief names a real, ENTER-linked figure;
  // otherwise "AVOID"/"ENTER threshold requires validation." is the
  // honest default, never a fabricated number and never a planning
  // assumption borrowed from Strategic Recommendations (those signals
  // are never read here at all -- see buildDecisionThresholdForGap's own
  // comment).
  enterConditions: MarketIntelligenceDecisionCondition[];
  // Requirement #4: MONITOR's own conditions -- always
  // "isThresholdSupported: true" via the structural status-quo
  // statement when the report names no explicit figure, since "stays at
  // MONITOR while X remains unresolved" never needs fabrication.
  monitorConditions: MarketIntelligenceDecisionCondition[];
  // Requirement #5: almost always "isThresholdSupported: false" in real
  // reports (this report style essentially never states a downside
  // figure) -- the model still supports a future report naming one
  // (extractDecisionLinkedThresholdPhrase runs the identical check for
  // "NO_GO" as it does for "GO") with ZERO renderer changes required.
  avoidConditions: MarketIntelligenceDecisionCondition[];
  // The decision-critical gaps themselves, restated as conditions --
  // "which decision-critical condition(s) are preventing ENTER"
  // (requirement #4). Identical in count/order to enterConditions (both
  // are built from the SAME material-gap list) but framed around the
  // CURRENT unresolved state rather than a hypothetical future one.
  unresolvedConditions: MarketIntelligenceDecisionCondition[];
  // Broader than unresolvedConditions: every gap this report has,
  // material AND non-gating/supporting (e.g. growth-rate/CAGR) --
  // "what evidence would still be worth gathering," not only what
  // gates the canonical decision.
  evidenceRequirements: MarketIntelligenceDecisionCondition[];
  // "The controlling unresolved condition" (requirement #4's own
  // phrase) -- set ONLY when exactly one decision-critical pillar is
  // unresolved, since "the" controlling factor is a well-defined
  // singular concept only in that case; null when zero (nothing is
  // controlling) or multiple (no single factor is "the" controller) --
  // never a guess at which of several unresolved pillars matters most.
  controllingUnresolvedCondition: MarketIntelligenceDecisionCondition | null;
};

export function resolveMarketIntelligenceDecisionThresholdState(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceCanonicalThresholdState | null {
  if (!canonicalState) return null;

  const thresholds = resolveMarketIntelligenceDecisionThresholds(canonicalState, language);
  const allGaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language);

  const enterConditions = thresholds.map((threshold) => toDecisionCondition(threshold, threshold.enterCondition));
  const monitorConditions = thresholds.map((threshold) => toDecisionCondition(threshold, threshold.monitorCondition));
  const avoidConditions = thresholds.map((threshold) => toDecisionCondition(threshold, threshold.avoidCondition));

  const unresolvedConditions = thresholds.map((threshold) => ({
    factor: threshold.affectedFactor,
    label: threshold.gapLabel,
    requiredEvidence: threshold.evidenceRequired,
    currentStatus: threshold.currentStatus,
    isDecisionCritical: true,
    isThresholdSupported: false,
    description: threshold.currentStatus,
    isPlanningAssumption: threshold.enterCondition.isPlanningAssumption,
  }));

  const evidenceRequirements = allGaps.map((gap) => ({
    factor: gap.decisionFactor,
    label: gap.label,
    requiredEvidence: gap.evidenceRequired,
    currentStatus: gap.currentStatus,
    isDecisionCritical: gap.decisionFactor !== null,
    isThresholdSupported: Boolean(gap.successThreshold),
    description: gap.validationMethod,
    isPlanningAssumption: gap.isPlanningAssumption,
  }));

  return {
    decision: canonicalState.decision,
    enterConditions,
    monitorConditions,
    avoidConditions,
    unresolvedConditions,
    evidenceRequirements,
    controllingUnresolvedCondition: unresolvedConditions.length === 1 ? unresolvedConditions[0] : null,
  };
}

// TASK #38 -- Structurally connect Strategic Recommendation metrics to
// Evidence Gaps and decision thresholds.
//
// PROBLEM (confirmed via audit): every Strategic Recommendation card's
// own KPI/budget/timeline (e.g. "≥40% review-time reduction," "8-week
// pilot," a budget ceiling) is extracted from the model's own free-text
// prose (extractRecommendationSignals, report-presentation.ts) and, until
// now, classified only as "evidence" vs "planning_assumption" numeric
// basis (Task #31) -- with NO structural connection to which canonical
// evidence gap (if any) that action is meant to close, and no distinction
// between "an unevidenced number presented as fact" (a stale planning
// assumption) and "the explicit target a validation/pilot action is
// DESIGNED to test" (a validation target -- a legitimate, different
// concept this task's own requirement #2 calls out by name).
//
// FIX: classifyStrategicRecommendationValidation wraps (never replaces)
// classifyStrategicRecommendationAction's existing classification with:
// (a) a finer 4-way provenance (verifiedEvidence / benchmarkDerived /
// planningAssumption / validationTarget) derived from the SAME
// numericBasis Task #31 already computes, refined by actionType and, for
// genuinely evidence-tied cards, the REAL cited source's own
// sourceTypeToEvidenceLevel classification (report-evidence.ts) -- never
// a new, independently invented evidence taxonomy; (b) a link to a
// canonical evidence gap using a STABLE STRUCTURED IDENTIFIER
// (MarketIntelligenceEvidenceGapId), never fragile prose/keyword
// matching against the card's own free text -- see
// resolveLinkedEvidenceGapId's own comment for exactly how narrow and
// safe that link is; (c) the SAME MarketIntelligenceDecisionThreshold
// object (Task #36/#37) for the linked gap, when one exists, so a reader
// can see not just "this closes gap X" but "here is what ENTER/MONITOR/
// AVOID actually require for X."

export type MarketIntelligenceRecommendationProvenance =
  | "verifiedEvidence"
  | "benchmarkDerived"
  | "planningAssumption"
  | "validationTarget";

const RECOMMENDATION_PROVENANCE_LABELS: Record<
  MarketIntelligenceRecommendationProvenance,
  Record<ResponseLanguage, string>
> = {
  verifiedEvidence: {
    English: "Verified Evidence",
    Turkish: "Doğrulanmış Kanıt",
    German: "Verifizierter Nachweis",
    French: "Preuve vérifiée",
    Spanish: "Evidencia verificada",
  },
  benchmarkDerived: {
    English: "Benchmark-Derived",
    Turkish: "Kıyaslamadan Türetilmiş",
    German: "Benchmark-abgeleitet",
    French: "Dérivé d'un référentiel",
    Spanish: "Derivado de referencia",
  },
  planningAssumption: {
    English: "Planning Assumption",
    Turkish: "Planlama Varsayımı",
    German: "Planungsannahme",
    French: "Hypothèse de planification",
    Spanish: "Supuesto de planificación",
  },
  validationTarget: {
    English: "Validation Target",
    Turkish: "Doğrulama Hedefi",
    German: "Validierungsziel",
    French: "Cible de validation",
    Spanish: "Objetivo de validación",
  },
};

export function localizeRecommendationProvenance(
  provenance: MarketIntelligenceRecommendationProvenance,
  language: ResponseLanguage = "English"
): string {
  return RECOMMENDATION_PROVENANCE_LABELS[provenance][language];
}

// Mirrors STRATEGIC_RECOMMENDATION_CITATION_MARKER_PATTERN
// (market-intelligence-canonical-state.ts, not exported) -- the same
// literal [R#] shape, reused here only to look up which REAL citation
// (if any) an evidenceTie names, never to re-decide whether it resolves
// (isKnownCitationId-equivalent logic is already baked into
// classifyStrategicRecommendationAction's own numericBasis).
const RECOMMENDATION_CITATION_MARKER_PATTERN = /\[R(\d+)\]/g;

function resolveEvidenceTieCitationLevel(
  evidenceTie: string,
  canonicalState: MarketIntelligenceCanonicalState
): EvidenceLevel | null {
  if (!evidenceTie) return null;
  const matches = [...evidenceTie.matchAll(RECOMMENDATION_CITATION_MARKER_PATTERN)];
  for (const match of matches) {
    const source = canonicalState.citationSources.find((entry) => entry.evidenceId === `R${match[1]}`);
    if (source) return sourceTypeToEvidenceLevel(source.sourceType, Boolean(source.url));
  }
  return null;
}

// Requirement #2: "≥40% review-time reduction"-class numbers must remain
// a validation target or planning assumption unless real evidence
// verifies them -- never silently promoted to fact. numericBasis "none"
// (no numeric content at all) classifies as null: there is nothing to
// label. numericBasis "evidence" (the card's evidenceTie already
// resolves to a real citation, per Task #31/#33) reads as
// "verifiedEvidence", downgraded to "benchmarkDerived" only when that
// SAME cited source's own sourceType classifies that way -- never a
// separate, weaker check. numericBasis "planning_assumption" splits on
// actionType: a validation/pilot action's own number is what that
// action is explicitly DESIGNED to measure ("validationTarget"), never
// presented as an existing fact; any other action type's unevidenced
// number remains a plain "planningAssumption", exactly Task #31's
// original, unchanged meaning.
function resolveRecommendationProvenance(
  classification: StrategicRecommendationClassification,
  evidenceTie: string,
  canonicalState: MarketIntelligenceCanonicalState | null
): MarketIntelligenceRecommendationProvenance | null {
  if (classification.numericBasis === "none") return null;

  if (classification.numericBasis === "evidence") {
    const citationLevel = canonicalState ? resolveEvidenceTieCitationLevel(evidenceTie, canonicalState) : null;
    return citationLevel === "benchmarkDerived" ? "benchmarkDerived" : "verifiedEvidence";
  }

  return classification.actionType === "validation" || classification.actionType === "pilot"
    ? "validationTarget"
    : "planningAssumption";
}

// Requirement #3: connect to canonical Evidence Gaps by a STABLE
// STRUCTURED IDENTIFIER, never fragile prose/keyword matching against a
// card's own free text (e.g. never scanning the action sentence for
// "SOM"/"obtainable share"/"pilot" and guessing it means THIS gap). The
// only structurally safe moment to draw that link without guessing is
// when there is EXACTLY ONE decision-critical (material) evidence gap in
// the whole report -- the real, common "single controlling factor" case
// this report style actually produces (e.g. Obtainable Share alone
// keeping a report at MONITOR, Task #37's own controllingUnresolvedCondition).
// In that state there is no second candidate a validation/pilot action
// could possibly be advancing instead, so the link is a structural fact,
// not an inference. Only "validation"/"pilot" actionTypes ever link:
// those are the only two action types whose entire purpose is gathering
// NEW decision-critical evidence (a "scale"/"conditional_execution"/
// "research" action's relationship to a specific gap is not
// structurally guaranteed the same way).
//
// TASK #48 -- Make Market Intelligence multi-gap evidence closure
// structurally authoritative.
//
// PROBLEM: whenever 2+ material gaps existed, this always returned null
// -- correct discipline (never guess which of several gaps a card
// relates to) but too conservative for the real, common shape this
// report's own generation prompt produces under any non-ENTER decision:
// "First 90 Days" REQUIRES exactly three bounded, measurable actions,
// so a real multi-gap MONITOR report can easily have one action that
// structurally, unambiguously targets ONE specific gap and a second
// action targeting a DIFFERENT one.
//
// FIX: when 2+ material gaps exist, this action is now linked to a
// SPECIFIC gap ONLY when its own successCriterion names the SAME
// percentage figure that gap's OWN report-stated successThreshold
// already names (Task #35's extractNamedSuccessThreshold, reused
// verbatim) -- a NUMERIC EQUALITY check between two already-extracted
// figures, never a word/gap-name/keyword comparison, and the SAME
// technique Task #47C already uses to disambiguate between several
// recommendations for ONE gap, generalized here to disambiguate WHICH
// gap a recommendation targets. Requires the match to be unique across
// ALL material gaps -- 0 or 2+ gaps sharing that figure (or the action
// naming no figure at all, or the gap naming no figure at all) still
// returns null, never a guess. This is a pure widening: the single-gap
// path above is completely untouched, so every existing single-gap
// behavior (Tasks #38/#46/#47-#47C) is unaffected.
// TASK #50 -- Fix the semantic mismatch between an evidence gap and its
// Closure Plan / Decision Threshold.
//
// PROBLEM (confirmed live on a real regenerated report): with exactly
// ONE material gap (Obtainable Share (SAM/SOM)), the single-gap fast
// path below linked EVERY validation/pilot-classified recommendation to
// it unconditionally -- including a "Vertical Technical Pilot" whose own
// success metric was "85% extraction accuracy" on compliance clauses, a
// PRODUCT/TECHNICAL performance figure that measures nothing about how
// much of the market this business can capture. That 85% then flowed,
// completely unchallenged, into the ENTER threshold and Closure Plan
// (Owner/Timeline/Budget) for a gap it has no evidentiary relationship
// to at all. The single-gap fast path (and, symmetrically, the multi-gap
// numeric-match path just below it) both only ever asked "is this
// action a validation/pilot action, and is there only one place it
// could possibly be about" -- neither ever asked "does this action's
// OWN evidence actually measure what this specific gap needs."
//
// FIX: a candidate's OWN successCriterion is checked against a small,
// curated, gap-scoped vocabulary of what KIND of KPI that gap's
// underlying concept is ever measured by (GAP_REQUIRED_EVIDENCE_CATEGORY
// below) -- e.g. Obtainable Share is inherently a capture-rate concept
// (conversion/win-rate/paid-pilot/LOI/reachable-account/penetration),
// never a product/technical performance concept (extraction accuracy/
// latency/model accuracy/integration completion). This is intentionally
// NOT a general prose-similarity search: it only ever inspects the
// recommendation's own already-extracted, already-structured
// successCriterion field (Task #31), against a small, explicit,
// bidirectional vocabulary -- never the free-form action/activity text,
// never a gap-name/keyword scan of the whole item. A candidate is
// rejected ONLY when its metric AFFIRMATIVELY classifies into a
// DIFFERENT known category than the gap requires (e.g. a technical-
// performance metric proposed for a capture-rate gap); a candidate with
// NO distinct metric at all, or a metric this vocabulary does not
// recognize either way, remains exactly as eligible as before Task #50
// (never a new reason to reject the "Procurement reference test"/
// "Pilot Recruitment" shapes Tasks #47B/#48A already made resolvable) --
// this is a strict narrowing (blocks a confirmed wrong answer), never a
// broadening of what can link. Gap types with no defined requirement
// (competitive-evidence today) are completely unaffected.
type MarketIntelligenceEvidenceCategory = "captureRate" | "marketSize" | "technicalPerformance";

// Deliberately narrow, curated patterns -- each names a closed set of
// real-world KPI vocabulary this report style's own generation prompt
// actually produces for that concept, never a broad word.
const CAPTURE_RATE_EVIDENCE_PATTERN =
  /\b(?:conversion(?:\s+rate)?|win[- ]rate|paid[- ]pilot|pilot\s+conversion|LOIs?|letters?\s+of\s+intent|reachable[- ]account|obtainable[- ]share|(?:market\s+)?penetration)\b/i;
const MARKET_SIZE_EVIDENCE_PATTERN =
  /\b(?:TAM|total\s+addressable\s+market|market\s+size|addressable\s+market|buyer\s+population)\b/i;
const TECHNICAL_PERFORMANCE_EVIDENCE_PATTERN =
  /\b(?:extraction\s+accuracy|latency|model\s+accuracy|integration\s+completion|uptime|throughput|processing\s+accuracy|precision|recall|F1[- ]score)\b/i;

function resolveRecommendationEvidenceCategories(successCriterion: string): Set<MarketIntelligenceEvidenceCategory> {
  const categories = new Set<MarketIntelligenceEvidenceCategory>();
  if (!successCriterion.trim()) return categories;
  if (CAPTURE_RATE_EVIDENCE_PATTERN.test(successCriterion)) categories.add("captureRate");
  if (MARKET_SIZE_EVIDENCE_PATTERN.test(successCriterion)) categories.add("marketSize");
  if (TECHNICAL_PERFORMANCE_EVIDENCE_PATTERN.test(successCriterion)) categories.add("technicalPerformance");
  return categories;
}

// Only gaps with a defined requirement are semantically gated at all --
// this is an explicit allow-list, never a default-deny, so a future or
// unlisted gap type (competitive-evidence today) keeps its existing,
// unchanged linkage behavior exactly as before.
const GAP_REQUIRED_EVIDENCE_CATEGORY: Partial<Record<MarketIntelligenceEvidenceGapId, MarketIntelligenceEvidenceCategory>> = {
  "obtainable-share": "captureRate",
  "market-sizing": "marketSize",
};

function isRecommendationSemanticallyCompatibleWithGap(
  gapId: MarketIntelligenceEvidenceGapId,
  successCriterion: string
): boolean {
  const requiredCategory = GAP_REQUIRED_EVIDENCE_CATEGORY[gapId];
  if (!requiredCategory) return true;
  const categories = resolveRecommendationEvidenceCategories(successCriterion);
  // No distinct/classifiable metric at all -- neutral, never a reason to
  // reject a link Tasks #47B/#48A already made resolvable this way.
  if (categories.size === 0) return true;
  return categories.has(requiredCategory);
}

function resolveLinkedEvidenceGap(
  actionType: StrategicRecommendationClassification["actionType"],
  successCriterion: string,
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage
): MarketIntelligenceEvidenceGap | null {
  if (!canonicalState) return null;
  if (actionType !== "validation" && actionType !== "pilot") return null;

  const materialGaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).filter(
    (gap) => gap.decisionFactor !== null
  );
  if (materialGaps.length === 1) {
    const gap = materialGaps[0];
    return isRecommendationSemanticallyCompatibleWithGap(gap.id, successCriterion) ? gap : null;
  }
  if (materialGaps.length === 0) return null;

  const actionFigure = extractComparableThresholdFigure(successCriterion);
  if (!actionFigure) return null;
  const numericMatches = materialGaps.filter((gap) =>
    comparableThresholdFiguresMatch(actionFigure, gap.successThreshold ? extractComparableThresholdFigure(gap.successThreshold) : null)
  );
  const semanticMatches = numericMatches.filter((gap) =>
    isRecommendationSemanticallyCompatibleWithGap(gap.id, successCriterion)
  );
  return semanticMatches.length === 1 ? semanticMatches[0] : null;
}

// TASK #48 -- a type-aware companion to Task #47C's own
// extractPercentageFigure (kept completely unchanged, still
// percentage-only, since it is scoped to the single-gap recommendation-
// tiebreaker that only ever compares against obtainable-share's own
// percentage bar). Now that a SECOND gap type (market-sizing) can also
// carry a report-stated threshold, and that threshold may be a DOLLAR
// figure rather than a percentage, a bare string-equality check on the
// wrong two kinds of figure could accidentally treat "$50,000" and "50%"
// as unrelated-but-similar-looking numbers, or two DIFFERENT dollar
// amounts that merely share digits. This extracts a figure's KIND
// (percentage vs dollar) alongside its normalized value, and
// comparableThresholdFiguresMatch requires BOTH the kind and the value
// to agree -- never a same-number-different-unit false positive.
type MarketIntelligenceComparableThresholdFigure = { kind: "percentage" | "dollar"; value: string };

const PERCENTAGE_FIGURE_PATTERN = /\d+(?:\.\d+)?\s?%/;
const DOLLAR_FIGURE_PATTERN = /[$€₺]\s?\d[\d,.]*\s?(?:thousand|million|billion|trillion|[kKmMbB])?/i;

function extractComparableThresholdFigure(text: string): MarketIntelligenceComparableThresholdFigure | null {
  const percentageMatch = text.match(PERCENTAGE_FIGURE_PATTERN);
  if (percentageMatch) return { kind: "percentage", value: percentageMatch[0].replace(/\s/g, "") };
  const dollarMatch = text.match(DOLLAR_FIGURE_PATTERN);
  if (dollarMatch) return { kind: "dollar", value: dollarMatch[0].replace(/\s/g, "").toUpperCase() };
  return null;
}

function comparableThresholdFiguresMatch(
  a: MarketIntelligenceComparableThresholdFigure | null,
  b: MarketIntelligenceComparableThresholdFigure | null
): boolean {
  return Boolean(a && b && a.kind === b.kind && a.value === b.value);
}

// The single, structured record every render surface must read for a
// recommendation card's decision-relevant fields (requirement #1) --
// a pure superset of StrategicRecommendationClassification (Task #31),
// so every existing caller's `.actionType`/`.actionTypeLabel`/
// `.numericBasis`/`.downgradeReason`/`.wasDowngraded`/`.evidenceBasis`
// usage continues to work completely unchanged.
export type MarketIntelligenceRecommendationValidation = StrategicRecommendationClassification & {
  owner: string;
  activity: string;
  timeline: string;
  budget: string;
  // KPI and success criterion are deliberately the SAME underlying value
  // (extractRecommendationSignals' own `metric` field) -- this report
  // style's generation prompt never produces two independently-labeled
  // numbers for "what is measured" vs. "what counts as success"; exposing
  // both names (rather than inventing an artificial second figure) keeps
  // the type honest about what the data actually contains.
  kpi: string;
  successCriterion: string;
  evidenceTie: string;
  provenance: MarketIntelligenceRecommendationProvenance | null;
  relatedEvidenceGapId: MarketIntelligenceEvidenceGapId | null;
  // Requirement #4: represents "what would need to be true for this
  // action's result to move MONITOR -> ENTER (or -> AVOID)" using the
  // SAME threshold object every other surface already reads -- never a
  // fabricated threshold, and never populated unless relatedEvidenceGapId
  // itself resolved (which already requires the gap to be genuinely
  // decision-critical/material).
  relatedDecisionThreshold: MarketIntelligenceDecisionThreshold | null;
};

export function classifyStrategicRecommendationValidation(input: {
  item: string;
  signals: {
    budget: string;
    metric: string;
    timeframe: string;
    owner: string;
    gate: string;
    activity: string;
    evidenceTie: string;
  };
  canonicalState: MarketIntelligenceCanonicalState | null;
  language?: ResponseLanguage;
}): MarketIntelligenceRecommendationValidation {
  const { item, signals, canonicalState, language = "English" } = input;
  const classification = classifyStrategicRecommendationAction({ item, signals, canonicalState, language });
  const provenance = resolveRecommendationProvenance(classification, signals.evidenceTie, canonicalState);
  const linkedGap = resolveLinkedEvidenceGap(classification.actionType, signals.metric, canonicalState, language);
  const relatedDecisionThreshold =
    linkedGap && canonicalState
      ? resolveMarketIntelligenceDecisionThresholds(canonicalState, language).find((t) => t.gapId === linkedGap.id) ?? null
      : null;

  return {
    ...classification,
    owner: signals.owner,
    activity: signals.activity,
    timeline: signals.timeframe,
    budget: signals.budget,
    kpi: signals.metric,
    successCriterion: signals.metric,
    evidenceTie: signals.evidenceTie,
    provenance,
    relatedEvidenceGapId: linkedGap?.id ?? null,
    relatedDecisionThreshold,
  };
}

// TASK #39 -- Make Market Intelligence ENTER / MONITOR / AVOID decision
// thresholds structurally measurable and authoritative.
//
// PROBLEM: Task #36/#37's per-gap threshold collapses each direction into
// exactly ONE sentence, which reads as a bare "ENTER threshold requires
// validation." placeholder whenever the decision brief names no number --
// too vague for an executive decision system, and it never draws on
// Strategic Recommendations' own structured validation targets (Task #38)
// even when one exists for the SAME controlling gap.
//
// FIX: resolveMarketIntelligenceControllingDecisionThreshold builds a
// richer, multi-CRITERION model for the single controlling evidence gap
// (the real, common case this report style produces -- e.g. Obtainable
// Share alone keeping a report at MONITOR). Each direction
// (enter/monitor/avoid) is an ARRAY of named criteria, not one flat
// sentence, and every criterion explicitly carries whichever of the 4
// provenance categories applies (verifiedEvidence/benchmarkDerived/
// validationTarget/planningAssumption) or null when the criterion is
// purely qualitative/structural and makes no numeric claim at all.
//
// This intentionally does NOT invent separate line items for every
// dimension this task's own ticket lists as an example (pilot
// conversion, win rate, reachable-account capacity, pricing, unit
// economics) -- Market Intelligence's own architecture never persists
// structured data for any of those (they are Business Plan's financial-
// model concepts, deliberately isolated from Market Intelligence
// elsewhere in this codebase); fabricating a named line item for a
// dimension this report never actually measures would be exactly the
// "invent unsupported market numbers" this task forbids. Only 3
// dimensions are ever populated, each backed by real, already-computed
// structured data:
//   - controllingEvidenceGap: the gap itself (always present, purely
//     qualitative -- "this evidence must resolve," no number).
//   - reportStatedThreshold: a real number this SPECIFIC report's own
//     decision brief already states (Task #36/#37's existing, unchanged
//     extraction) -- preferred when present, since it is the report's
//     own considered figure.
//   - recommendationValidationTarget: the linked Strategic
//     Recommendation's own structured kpi/successCriterion (Task #38) --
//     used only when no report-stated figure exists, and ONLY the
//     already-classified object is read (never re-parsed prose).
// The type itself supports more dimensions (see
// MarketIntelligenceThresholdCriterionDimension) so a FUTURE evidence
// source (e.g. if Market Intelligence ever persists structured pricing
// or win-rate evidence) can populate them without any renderer change --
// mirroring this codebase's established "design for future evidence,
// never fabricate today" pattern (Task #37's own avoidCondition).

export type MarketIntelligenceThresholdCriterionDimension =
  | "controllingEvidenceGap"
  | "reportStatedThreshold"
  | "recommendationValidationTarget"
  // Reserved for a future evidence source this report kind does not yet
  // structurally persist -- never populated today (see this section's
  // own top-of-file comment for why).
  | "pilotConversion"
  | "winRate"
  | "reachableAccountCapacity"
  | "pricingValidation"
  | "unitEconomics";

export type MarketIntelligenceThresholdCriterion = {
  dimension: MarketIntelligenceThresholdCriterionDimension;
  label: string;
  description: string;
  // null ONLY for a purely qualitative/structural criterion that makes
  // no numeric claim at all (e.g. "this evidence gap must resolve") --
  // every criterion that DOES carry a number or named target is always
  // explicitly classified into one of the 4 real categories, never left
  // ambiguous.
  provenance: MarketIntelligenceRecommendationProvenance | null;
  // The real, verbatim figure/target text this criterion is grounded in
  // (e.g. "above 5%" or "20% pilot conversion rate") -- null when the
  // criterion is qualitative only.
  value: string | null;
  // TASK #52 -- the per-component provenance breakdown `.description`
  // is rendered from, when this criterion carries a compound claim.
  // Undefined for a criterion with no numeric claim at all
  // (provenance === null, e.g. buildControllingGapCriterion); a
  // length-1 array for every existing single-figure criterion
  // (byte-identical to Task #51's behavior); length 2+ only when a
  // genuinely separate pricing/unit-economics figure was found inside
  // the SAME successCriterion string.
  components?: MarketIntelligenceThresholdComponent[];
};

const RECOMMENDATION_VALIDATION_TARGET_LABELS: Record<ResponseLanguage, string> = {
  English: "Recommended Validation Target",
  Turkish: "Önerilen Doğrulama Hedefi",
  German: "Empfohlenes Validierungsziel",
  French: "Cible de validation recommandée",
  Spanish: "Objetivo de validación recomendado",
};

// TASK #52 -- Make compound Market Intelligence decision thresholds
// structurally provenance-safe.
//
// PROBLEM: a recommendation's own successCriterion is ONE string with
// ONE card-level provenance (Task #38's classifyStrategicRecommendationValidation),
// even when that string names TWO structurally different sub-claims --
// e.g. "at least 4 paid contracts within 9 months at average ACV above
// USD 25,000" bundles a raw COUNT the pilot itself directly produces
// (paid contracts) with a PRICING/unit-economics figure (ACV) that is a
// modeled assumption layered ON TOP of that count, not something the
// pilot's own completion count measures. Task #51 correctly labels the
// WHOLE string with ONE provenance qualifier -- but a genuinely mixed
// claim then gets flattened to whichever single label the whole card
// happens to carry, exactly the "10 paying customers + USD 25k ACV =
// entirely Validation Target" flattening this task closes.
//
// FIX: MarketIntelligenceThresholdCriterion gains an ADDITIVE, optional
// `components` breakdown (never removing or changing `.description`/
// `.provenance`/`.value` -- every existing single-component consumer,
// including Closure Plan's own aliasing of enterSummary/avoidSummary,
// is completely unaffected). splitThresholdIntoComponents only ever
// splits out a SEPARATE clause when the string ALSO names a distinct
// pricing/unit-economics figure (ACV/deal size/contract value/price) --
// a criterion with no such second figure returns a single, unsplit
// component, byte-identical to Task #51's own output. Each component's
// OWN provenance is derived from THIS SAME card's already-classified
// provenance (never a new, independently-invented classification, and
// never stronger than what the card itself already earned) -- a
// pricing/unit-economics component is only ever narrowed FROM
// "validationTarget" DOWN to "planningAssumption" (never the reverse,
// and never touched at all when the card is "verifiedEvidence"/
// "benchmarkDerived", since a real citation or benchmark backing the
// WHOLE compound claim legitimately covers every clause of it). This
// satisfies "never inherit provenance from one component to another":
// the count component keeps exactly what the card already earned; the
// pricing component is narrowed based on ITS OWN structural nature, not
// borrowed from its sibling.
const PRICING_COMPONENT_KEYWORD_PATTERN =
  /\b(?:ACV|annual\s+contract\s+value|deal\s+size|contract\s+value|price(?:\s+point)?|revenue\s+per\s+(?:customer|deal|account))\b/i;

// TASK #52 -- DOLLAR_FIGURE_PATTERN only recognizes a literal currency
// SYMBOL ($/€/₺); this report style's own generation prompt (mirroring
// report-presentation.ts's own budget-extraction convention) at least as
// often names a figure by currency CODE instead ("USD 25,000", "EUR
// 40k") -- confirmed live against this exact ticket's own real example
// ("average ACV above USD 25,000"), which the symbol-only pattern never
// matched. Scoped to this module's own pricing-clause detection only
// (never widening the SHARED DOLLAR_FIGURE_PATTERN other, unrelated gap-
// threshold numeric-matching already depends on).
const CURRENCY_FIGURE_PATTERN = new RegExp(
  `(?:${DOLLAR_FIGURE_PATTERN.source}|\\b(?:USD|EUR|GBP|TRY)\\s?\\d[\\d,.]*\\s?(?:thousand|million|billion|trillion|[kKmMbB])?\\b)`,
  "i"
);

const PRICING_CLAUSE_PATTERN = new RegExp(
  `\\b(?:at|with)\\s+(?:an?\\s+)?(?:average\\s+)?(?:ACV|annual\\s+contract\\s+value|deal\\s+size|contract\\s+value|price(?:\\s+point)?|revenue\\s+per\\s+(?:customer|deal|account))\\b[^.;,]*?${CURRENCY_FIGURE_PATTERN.source}[^.;,]*`,
  "i"
);

// Only ever splits out a SEPARATE clause when a distinct pricing figure
// is present -- a criterion naming just one claim (the overwhelming
// majority) returns a single-element array, matching Task #51's
// unsplit behavior exactly.
function splitThresholdIntoComponents(successCriterion: string): string[] {
  const match = successCriterion.match(PRICING_CLAUSE_PATTERN);
  if (!match || match.index === undefined) return [successCriterion.trim()];

  const pricingClause = match[0].trim();
  const primaryClause = (successCriterion.slice(0, match.index) + successCriterion.slice(match.index + match[0].length))
    .replace(/\s+(?:at|with)\s*$/i, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  return primaryClause ? [primaryClause, pricingClause] : [successCriterion.trim()];
}

function classifyThresholdComponentProvenance(
  componentText: string,
  cardProvenance: MarketIntelligenceRecommendationProvenance
): MarketIntelligenceRecommendationProvenance {
  if (cardProvenance !== "validationTarget") return cardProvenance;
  const isPricingComponent =
    CURRENCY_FIGURE_PATTERN.test(componentText) && PRICING_COMPONENT_KEYWORD_PATTERN.test(componentText);
  return isPricingComponent ? "planningAssumption" : cardProvenance;
}

// The single, canonical per-component breakdown every criterion builder
// below must use -- never a second, independently-derived split.
export type MarketIntelligenceThresholdComponent = {
  text: string;
  provenance: MarketIntelligenceRecommendationProvenance;
};

function resolveThresholdComponents(
  validation: MarketIntelligenceRecommendationValidation
): MarketIntelligenceThresholdComponent[] {
  if (!validation.successCriterion.trim() || !validation.provenance) return [];
  return splitThresholdIntoComponents(validation.successCriterion).map((text) => ({
    text,
    provenance: classifyThresholdComponentProvenance(text, validation.provenance as MarketIntelligenceRecommendationProvenance),
  }));
}

function buildQualifiedCompoundText(
  components: readonly MarketIntelligenceThresholdComponent[],
  language: ResponseLanguage
): string {
  return components
    .map((component) => `${component.text} (${localizeRecommendationProvenance(component.provenance, language)})`)
    .join(" ");
}

function buildControllingGapCriterion(
  gap: MarketIntelligenceEvidenceGap,
  description: string
): MarketIntelligenceThresholdCriterion {
  return {
    dimension: "controllingEvidenceGap",
    label: gap.label,
    description,
    provenance: null,
    value: null,
  };
}

function buildReportStatedCriterion(
  gap: MarketIntelligenceEvidenceGap,
  condition: MarketIntelligenceDecisionThresholdCondition,
  rawPhrase: string
): MarketIntelligenceThresholdCriterion {
  return {
    dimension: "reportStatedThreshold",
    label: gap.label,
    description: condition.description,
    // A number the report's OWN decision brief states for itself is not
    // independently citation-verified -- it is, at best, the report's
    // own considered validation bar (never presented as externally
    // "verifiedEvidence"), or explicitly a planning assumption when the
    // underlying evidence state (e.g. SAM's default share ratio) is
    // itself unevidenced.
    provenance: condition.isPlanningAssumption ? "planningAssumption" : "validationTarget",
    value: rawPhrase,
  };
}

// TASK #39A -- defense-in-depth: returns null (never a criterion with a
// dangling/empty target) whenever the validation's own successCriterion
// is empty, even though the caller's own linkedValidation selection
// already filters this out -- a builder that can silently render a blank
// target is exactly the shape of bug this task fixes, so it must be
// impossible to construct one here regardless of how it is called.
// TASK #52 -- description is now built from the per-component
// breakdown (resolveThresholdComponents/buildQualifiedCompoundText),
// never a single blanket qualifier over the whole compound string. For
// a criterion with only ONE component (the overwhelming majority), this
// produces byte-identical output to Task #51's own single-qualifier
// text.
function buildRecommendationEnterCriterion(
  validation: MarketIntelligenceRecommendationValidation,
  language: ResponseLanguage
): MarketIntelligenceThresholdCriterion | null {
  const components = resolveThresholdComponents(validation);
  if (components.length === 0) return null;
  return {
    dimension: "recommendationValidationTarget",
    label: RECOMMENDATION_VALIDATION_TARGET_LABELS[language],
    description: `${buildQualifiedCompoundText(components, language)}.`,
    provenance: validation.provenance,
    value: validation.successCriterion,
    components,
  };
}

const RECOMMENDATION_VALIDATION_NOT_MET_TEMPLATES: Record<ResponseLanguage, (qualifiedTarget: string) => string> = {
  English: (qualifiedTarget) => `Validation fails to meet the recommended target: ${qualifiedTarget}.`,
  Turkish: (qualifiedTarget) => `Doğrulama, önerilen hedefi karşılamaz: ${qualifiedTarget}.`,
  German: (qualifiedTarget) => `Die Validierung erreicht das empfohlene Ziel nicht: ${qualifiedTarget}.`,
  French: (qualifiedTarget) => `La validation n'atteint pas la cible recommandée : ${qualifiedTarget}.`,
  Spanish: (qualifiedTarget) => `La validación no alcanza el objetivo recomendado: ${qualifiedTarget}.`,
};

// TASK #39A -- same defense-in-depth as buildRecommendationEnterCriterion
// above: null (never "...recommended target: .") whenever there is no
// real, non-empty target to name.
// TASK #51 -- now also embeds the SAME provenance qualifier
// buildRecommendationEnterCriterion already shows, so an AVOID-side
// recommendation-derived figure is never displayed as if it carried more
// certainty than its ENTER-side counterpart.
// TASK #52 -- description is now built from the SAME per-component
// breakdown ENTER uses -- a compound claim's two clauses are never
// flattened into one qualifier here either.
function buildRecommendationAvoidCriterion(
  validation: MarketIntelligenceRecommendationValidation,
  language: ResponseLanguage
): MarketIntelligenceThresholdCriterion | null {
  const components = resolveThresholdComponents(validation);
  if (components.length === 0) return null;
  return {
    dimension: "recommendationValidationTarget",
    label: RECOMMENDATION_VALIDATION_TARGET_LABELS[language],
    description: RECOMMENDATION_VALIDATION_NOT_MET_TEMPLATES[language](buildQualifiedCompoundText(components, language)),
    provenance: validation.provenance,
    components,
    value: validation.successCriterion,
  };
}

const AVOID_STRUCTURAL_TEMPLATES: Record<ResponseLanguage, (gapLabel: string) => string> = {
  English: (gapLabel) => `Validation demonstrates ${gapLabel} cannot be resolved to a defensible, viable estimate.`,
  Turkish: (gapLabel) => `Doğrulama, ${gapLabel} unsurunun savunulabilir, uygulanabilir bir tahmine çözümlenemediğini gösterir.`,
  German: (gapLabel) => `Die Validierung zeigt, dass ${gapLabel} nicht zu einer belastbaren, tragfähigen Schätzung aufgelöst werden kann.`,
  French: (gapLabel) => `La validation démontre que ${gapLabel} ne peut pas être résolu en une estimation défendable et viable.`,
  Spanish: (gapLabel) => `La validación demuestra que ${gapLabel} no puede resolverse en una estimación defendible y viable.`,
};

// The single, canonical, structured model every render surface must read
// for the controlling evidence gap's ENTER/MONITOR/AVOID conditions
// (requirement #1's exact field names). Only ever resolves for the SAME
// single-controlling-gap state Task #37/#38 already gate their own
// linkage on -- null when 0 or 2+ material gaps exist, never guessing
// which one is "the" controlling factor.
export type MarketIntelligenceControllingDecisionThreshold = {
  gapId: MarketIntelligenceEvidenceGapId;
  controllingFactor: string;
  affectedFactor: MarketIntelligenceDecisionFactor;
  requiredEvidence: string;
  currentThresholdState: string;
  enterConditions: MarketIntelligenceThresholdCriterion[];
  monitorConditions: MarketIntelligenceThresholdCriterion[];
  avoidConditions: MarketIntelligenceThresholdCriterion[];
  // Convenience pre-joined display strings (each criterion's own
  // description, space-joined) -- computed ONCE here so every render
  // surface shows the identical compact sentence instead of each
  // independently re-joining the arrays and risking drift.
  enterSummary: string;
  monitorSummary: string;
  avoidSummary: string;
};

// TASK #48 -- extracted from resolveMarketIntelligenceControllingDecisionThreshold
// so the SAME enrichment logic (report-stated OR linked-recommendation
// ENTER/AVOID criteria) can be built for ANY specific material gap, not
// only when it happens to be the sole one -- needed for multi-gap
// closure (see resolveMarketIntelligenceGapDecisionThreshold below).
// Behavior is byte-for-byte identical to the pre-Task-#48 inline body;
// this is a pure extraction, zero logic change.
function buildControllingThresholdForGap(
  gap: MarketIntelligenceEvidenceGap,
  canonicalState: MarketIntelligenceCanonicalState,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[],
  language: ResponseLanguage
): MarketIntelligenceControllingDecisionThreshold | null {
  const threshold = resolveMarketIntelligenceDecisionThresholds(canonicalState, language).find(
    (candidate) => candidate.gapId === gap.id
  );
  if (!threshold) return null;

  // TASK #39A -- confirmed live: numericBasis (and therefore provenance)
  // is derived from budget/metric/timeframe TOGETHER
  // (deriveStrategicRecommendationNumericBasis joins all three before
  // testing for a numeric figure), so a card can carry a real provenance
  // classification (e.g. because its budget or timeline is numeric)
  // while its OWN successCriterion/metric field is empty. Building an
  // AVOID/ENTER sentence around that empty string produced the reported
  // "Validation fails to meet the recommended target: ." -- a dangling
  // colon with nothing after it. A linked validation is only usable here
  // when it actually carries a non-empty measurable target string;
  // otherwise there is nothing structurally defensible to render, and
  // the caller must omit the clause entirely rather than invent one.
  const linkedValidation =
    recommendationValidations.find(
      (validation) =>
        validation.relatedEvidenceGapId === gap.id &&
        validation.provenance &&
        validation.successCriterion.trim().length > 0
    ) ?? null;

  const whatWouldChange = canonicalState.whatWouldChangeThisDecision;
  const enterPhrase = extractDecisionLinkedThresholdPhrase(whatWouldChange, "GO", language);
  const avoidPhrase = extractDecisionLinkedThresholdPhrase(whatWouldChange, "NO_GO", language);

  const enterConditions: MarketIntelligenceThresholdCriterion[] = [
    buildControllingGapCriterion(gap, gap.evidenceRequired),
  ];
  if (threshold.enterCondition.status === "defined" && enterPhrase) {
    enterConditions.push(buildReportStatedCriterion(gap, threshold.enterCondition, enterPhrase));
  } else if (linkedValidation) {
    const recommendationCriterion = buildRecommendationEnterCriterion(linkedValidation, language);
    if (recommendationCriterion) enterConditions.push(recommendationCriterion);
  }

  const monitorConditions: MarketIntelligenceThresholdCriterion[] = [
    buildControllingGapCriterion(gap, threshold.monitorCondition.description),
  ];

  const avoidConditions: MarketIntelligenceThresholdCriterion[] = [
    buildControllingGapCriterion(gap, AVOID_STRUCTURAL_TEMPLATES[language](gap.label)),
  ];
  if (threshold.avoidCondition.status === "defined" && avoidPhrase) {
    avoidConditions.push(buildReportStatedCriterion(gap, threshold.avoidCondition, avoidPhrase));
  } else if (linkedValidation) {
    const recommendationCriterion = buildRecommendationAvoidCriterion(linkedValidation, language);
    if (recommendationCriterion) avoidConditions.push(recommendationCriterion);
  }

  return {
    gapId: gap.id,
    controllingFactor: gap.label,
    affectedFactor: gap.decisionFactor as MarketIntelligenceDecisionFactor,
    requiredEvidence: gap.evidenceRequired,
    currentThresholdState: gap.currentStatus,
    enterConditions,
    monitorConditions,
    avoidConditions,
    enterSummary: enterConditions.map((criterion) => criterion.description).join(" "),
    monitorSummary: monitorConditions.map((criterion) => criterion.description).join(" "),
    avoidSummary: avoidConditions.map((criterion) => criterion.description).join(" "),
  };
}

// requirement #7: recommendation validation targets must be reused
// structurally, never recovered by prose parsing -- this accepts ONLY
// already-classified MarketIntelligenceRecommendationValidation objects
// (Task #38's own output), never raw recommendation item strings. Only
// ever resolves for the SAME single-controlling-gap state Task #37/#38
// already gate their own linkage on -- null when 0 or 2+ material gaps
// exist, never guessing which one is "the" controlling factor. This
// public contract is UNCHANGED by Task #48 -- it is now a thin wrapper
// over buildControllingThresholdForGap, so every pre-existing caller and
// test continues to see byte-identical behavior.
export function resolveMarketIntelligenceControllingDecisionThreshold(
  canonicalState: MarketIntelligenceCanonicalState | null,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceControllingDecisionThreshold | null {
  if (!canonicalState) return null;

  const materialGaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).filter(
    (gap) => gap.decisionFactor !== null
  );
  if (materialGaps.length !== 1) return null;

  return buildControllingThresholdForGap(materialGaps[0], canonicalState, recommendationValidations, language);
}

// TASK #48 -- the SAME enrichment model as
// resolveMarketIntelligenceControllingDecisionThreshold, generalized to
// ANY SPECIFIC material gap by id, regardless of how many OTHER material
// gaps are simultaneously unresolved. Used only for a gap that has
// already been classified as a genuine multi-gap PRIMARY or CO-
// CONTROLLING candidate (resolveMarketIntelligenceMultiGapPriorityState
// below) -- never called speculatively for an arbitrary gap, so this
// does not reintroduce the "guess which gap a card relates to" problem
// Task #38 was built to avoid; it only builds the DISPLAY model for a
// gap whose priority has already been resolved structurally.
export function resolveMarketIntelligenceGapDecisionThreshold(
  canonicalState: MarketIntelligenceCanonicalState | null,
  gapId: MarketIntelligenceEvidenceGapId,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceControllingDecisionThreshold | null {
  if (!canonicalState) return null;
  const gap = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).find(
    (candidate) => candidate.id === gapId && candidate.decisionFactor !== null
  );
  if (!gap) return null;
  return buildControllingThresholdForGap(gap, canonicalState, recommendationValidations, language);
}

// TASK #47 -- Make Market Intelligence evidence-gap closure actions
// structurally executable and measurable.
//
// PROBLEM: Tasks #35-#39 already make every decision-critical evidence
// gap structurally explained (WHAT/WHY) and its ENTER/MONITOR/AVOID
// thresholds structurally derived (WHAT RESULT would change the
// decision), but never state WHO owns closing the gap, BY WHEN, or AT
// WHAT COST. Each Strategic Recommendation card independently carries
// its OWN owner/timeline/budget (extractRecommendationSignals) -- and
// because resolveLinkedEvidenceGap links EVERY "validation"/"pilot"
// action to the sole controlling gap whenever exactly one exists, two or
// more such cards could each claim to be closing the SAME gap with a
// different owner, deadline, or budget, with nothing today reconciling
// or even flagging that.
//
// FIX: resolveMarketIntelligenceControllingClosurePlan builds ONE
// closure plan for the SAME single controlling gap
// resolveMarketIntelligenceControllingDecisionThreshold already gates on
// (null whenever 0 or 2+ material gaps are unresolved -- never guessing
// which one is "the" plan, identical discipline to
// controllingUnresolvedCondition/resolveLinkedEvidenceGap above).
// requiredEvidence/validationMethod/decisionImpact and the measurable
// success/monitor/failure criteria are pure aliases of data Tasks
// #35-#39 already compute (the gap's own evidenceRequired/
// validationMethod/decisionImpact, and the controlling threshold's own
// enterSummary/monitorSummary/avoidSummary) -- zero new interpretation
// logic, so this can never disagree with the "Evidence Gaps to Close"/
// decision-threshold surfaces that already render those exact strings.
//
// owner/timeline/budget are populated from the SINGLE authoritative
// recommendation card selectAuthoritativeClosurePlanValidation resolves
// (Task #47A) -- either the lone card linking to this gap
// (relatedEvidenceGapId, Task #38), or, when several link to the same
// gap, whichever ONE of them is unambiguously the most complete
// (non-empty owner, timeline, AND success criterion), never a guess
// between two equally (in)complete conflicting cards. When no such
// unique candidate exists, those fields fall back to an honest, single,
// localized "not yet assigned" sentence rather than fabricating or
// arbitrarily picking a winner between conflicting cards. Because
// owner/timeline are lifted verbatim
// from that ONE card's own already-extracted signals
// (extractRecommendationSignals, unchanged) and budget carries the SAME
// provenance suffix (verifiedEvidence/benchmarkDerived/planningAssumption/
// validationTarget, Task #38) the card itself already displays, any
// render surface that also shows that same card's own Owner/Timeline/
// Budget fields is guaranteed -- by construction, not a second
// reconciliation step -- to show identical text, so recommendation cards
// and this closure plan can never structurally disagree.
export type MarketIntelligenceEvidenceGapClosurePlan = {
  gapId: MarketIntelligenceEvidenceGapId;
  gapLabel: string;
  affectedFactor: MarketIntelligenceDecisionFactor;
  requiredEvidence: string;
  validationMethod: string;
  // Never empty -- always a real owner/timeline string, or the SAME
  // localized "not yet assigned" sentence every render surface would
  // otherwise have to word independently.
  owner: string;
  timeline: string;
  // null only when no budget figure applies at all (no linked card, an
  // ambiguous 2+-card link, or the sole linked card names no budget) --
  // mirrors the existing recommendation-card convention of omitting an
  // empty Budget field entirely rather than showing a blank one.
  budget: string | null;
  measurableSuccessCriterion: string;
  monitorStatus: string;
  failureCriterion: string;
  decisionImpact: string;
  // True only when exactly one recommendation card links to this gap --
  // the sole case owner/timeline/budget are ever sourced from real card
  // data rather than the shared fallback sentence.
  hasAssignedOwner: boolean;
  // TASK #53B -- requirement #3: the Closure Plan must inherit the
  // selected action's own Evidence Tie/Activity where available, never
  // fabricated. null (never a placeholder sentence) whenever no
  // authoritative candidate was selected, or the selected candidate
  // itself names no evidence tie/activity -- mirrors the existing
  // `budget` convention of omitting an empty field rather than showing a
  // blank or invented one.
  evidenceTie: string | null;
  activity: string | null;
};

const CLOSURE_PLAN_NO_OWNER: Record<ResponseLanguage, string> = {
  English: "Not yet assigned to a specific recommendation action.",
  Turkish: "Henüz belirli bir öneri eylemine atanmadı.",
  German: "Noch keiner bestimmten Empfehlungsaktion zugewiesen.",
  French: "Pas encore attribué à une action de recommandation spécifique.",
  Spanish: "Aún no asignado a una acción de recomendación específica.",
};

const CLOSURE_PLAN_NO_TIMELINE: Record<ResponseLanguage, string> = {
  English: "No timeline committed yet.",
  Turkish: "Henüz bir zaman çizelgesi belirlenmedi.",
  German: "Noch kein Zeitrahmen festgelegt.",
  French: "Aucun calendrier encore fixé.",
  Spanish: "Aún no se ha fijado un cronograma.",
};

// TASK #47A -- confirmed live against the real report: Task #47's own
// "exactly one linked candidate, else unassigned" rule was too
// conservative. resolveLinkedEvidenceGap (Task #38) links EVERY
// "validation"/"pilot" actionType recommendation to the sole controlling
// gap whenever exactly one exists -- so a real report with several such
// cards (e.g. "Pilot Recruitment" AND "Buyer Readiness Survey," both
// validating Obtainable Share) always has 2+ linked candidates, which
// Task #47 treated identically to a genuine conflict, always falling
// back to "Not yet assigned" even though one candidate is obviously the
// authoritative one.
//
// TASK #47B -- confirmed live against the REAL regenerated report: Task
// #47A's own bar (owner AND timeline AND a non-empty successCriterion
// STRING) still always fell back to "Not yet assigned," even with a
// clearly dominant "Pilot Recruitment" card (Owner: Head of Commercial/
// Partnerships, Timeline: 6 months) sitting right next to a clearly
// weaker "Buyer Readiness Survey" card (owner only). Root cause:
// successCriterion is literally an alias of signals.metric -- a
// SEPARATELY labeled "Success criterion:"/"Success metric:" field
// (report-presentation.ts) -- and this report style's real generation
// prompt frequently names its validation target INSIDE the timeframe
// itself ("6 months") rather than as a distinct metric string, leaving
// successCriterion genuinely empty on the one card that structurally
// IS the report's own validation target. classifyStrategicRecommendationValidation
// (Task #38) already classifies that exact case correctly --
// deriveStrategicRecommendationNumericBasis (market-intelligence-
// canonical-state.ts) joins budget/metric/timeframe BEFORE testing for
// a numeric figure, so a validation/pilot action's bare timeframe number
// alone already earns it `provenance: "validationTarget"` -- but Task
// #47A's selection bar never consulted that field, only the separate
// (and, in the real report, empty) successCriterion string, so the
// obviously-dominant "Pilot Recruitment" candidate silently failed to
// qualify and the whole selection fell back to "unassigned" every time.
//
// FIX: split "is this candidate real enough to consider at all" from "is
// it measurably a validation target." A candidate is only ever
// considered when it carries a non-empty owner AND timeline (the two
// fields the Closure Plan actually inherits, per requirement #6) --
// still never fabricated. Among candidates that clear that bar, one that
// ALSO carries a measurable target -- EITHER a distinct successCriterion
// string, OR the SAME provenance classification (Task #38's own
// verifiedEvidence/benchmarkDerived/planningAssumption/validationTarget)
// already attached to its owner/timeline/budget figures -- outranks one
// that carries neither. When exactly one candidate reaches the highest
// tier reached by any candidate, it is unambiguously the strongest
// action and becomes the authoritative source (requirement #6: one
// source action, never a synthetic merge of several). When zero
// candidates clear even the owner+timeline bar, or 2+ tie at the highest
// tier, there is no safe, non-arbitrary way to choose one, so this
// returns null and the caller falls back to the same honest "not yet
// assigned" sentence as before (requirement #7: never guess). A lone
// linked candidate (the exact case Task #47 already handled) is still
// used regardless of completeness -- there is nothing else it could be
// confused with.
// TASK #47C -- confirmed live against the REAL regenerated report: Task
// #47A/#47B's own tie-breaking (falling back to "not yet assigned"
// whenever 2+ candidates share the highest completeness score) turned
// out to be the COMMON case, not the rare one, for exactly the report
// type the Closure Plan matters most for. This report's own generation
// prompt (app/lib/report-engine/prompts/market.ts) REQUIRES "First 90
// Days" to name "exactly three concrete actions with owners" that are
// "bounded and reversible (validation, research, or a small gated
// pilot)" whenever the decision is anything short of a full ENTER -- so
// a real MONITOR report routinely has 2-3 equally-complete validation/
// pilot candidates (owner + timeline + a measurable target) simultaneously.
//
// TASK #48A -- confirmed live against a SECOND real regenerated report:
// even after Task #47C's fix, TWO candidates BOTH linked to the SAME
// SOLE controlling gap ("Vertical pilot": owner + timeline + an explicit
// "10%" success metric; "Procurement reference test": owner + timeline,
// but NO distinct success metric at all -- its own provenance still
// classifies as "validationTarget" purely because its BUDGET/TIMELINE
// figures are numeric) tied under Task #47C's single binary bonus
// ("has a measurable target" -- true for both, via two different
// routes), so selection still abstained even though "Vertical pilot" is
// structurally, unambiguously stronger: it carries an EXPLICIT success
// metric that the other candidate simply does not have at all.
//
// FIX: replace the single binary bonus with a SEQUENCE of progressively
// narrowing filters, applied in the SAME priority order this ticket's
// own requirement #2 lists (each stage only narrows the candidate pool
// when it actually distinguishes at least one candidate -- it never
// discards every remaining candidate just because none clears a later,
// stricter bar):
//   (1) owner AND timeline present (requirements #5/#6 -- a hard
//       prerequisite, unchanged from Task #47A/#47B).
//   (2) has a distinct, structured success metric AND that metric is
//       itself classified "validationTarget" (requirements #3/#4) --
//       strictly stronger than merely having SOME numeric content
//       elsewhere (a bare budget/timeline figure) earn the same
//       classification, which is exactly what let "Procurement
//       reference test" wrongly tie with "Vertical pilot" before.
//   (3) among whatever remains tied, prefer whichever candidate's own
//       success-metric figure NUMERICALLY matches this gap's own
//       report-stated threshold (gap.successThreshold, Task #35/#48's
//       existing type-aware percentage/dollar equality check, reused
//       verbatim) -- the closest available structural proxy for
//       requirement #8's "directly tests the controlling economic/
//       market uncertainty," since obtainable share's own bar is
//       always expressed as exactly that kind of figure. Still never a
//       word/keyword/gap-name comparison.
// When zero candidates clear stage (1), or 2+ remain tied after EVERY
// stage narrows as far as it safely can, there is no safe, non-
// arbitrary way to choose one, and this returns null -- the honest
// fallback is unchanged (requirement: never guess). A lone linked
// candidate is still used regardless of completeness, exactly as
// before -- there is nothing else it could be confused with.
function hasStructuredSuccessMetric(validation: MarketIntelligenceRecommendationValidation): boolean {
  return Boolean(validation.successCriterion.trim());
}

// Applies `predicate` to `pool` and narrows to the matching subset ONLY
// when that subset is both non-empty and strictly smaller than the
// current pool -- i.e. only when it actually distinguishes at least one
// candidate. A predicate that matches everyone, or no one, never
// eliminates a candidate that a later, more decisive stage might still
// be able to single out (requirement: never discard a candidate down to
// zero just because none clears one particular bar).
function narrowByStructuralCompleteness<T>(pool: readonly T[], predicate: (item: T) => boolean): readonly T[] {
  const matching = pool.filter(predicate);
  return matching.length > 0 && matching.length < pool.length ? matching : pool;
}

// TASK #53B -- requirement #2's own explicit, ordered preference list,
// applied as a SEQUENCE of progressively narrowing structural-
// completeness filters (never prose/title/keyword matching): validation/
// pilot action type, then owner, then timeline, then a measurable
// success metric, then an evidence tie. Each stage only narrows the pool
// when it actually distinguishes at least one candidate (see
// narrowByStructuralCompleteness above), so a report where every
// candidate ties on one dimension simply falls through to the next
// rather than collapsing to zero.
//
// CONFIRMED LIVE (a second real report, after Task #48A): "Buyer Demand
// Validation" (owner, timeline, an explicit "15%" success metric, and an
// evidence tie naming SUSB target lists) tied with a second, less
// complete procurement-validation action under the OLD rule -- both
// classified `provenance: "validationTarget"` (Task 48A's own bug
// class), and neither's own figure numerically matched this report's own
// stated Obtainable Share threshold (Task #47C's tiebreaker), so
// selection abstained even though "Buyer Demand Validation" is
// obviously, structurally the more complete candidate. Requiring only
// "has a distinct success metric" (never ALSO its provenance
// classification, which describes evidence QUALITY, not completeness) as
// its own stage, plus a NEW "has an evidence tie" stage, resolves this
// without reintroducing any prose/numeric-threshold guessing.
function selectAuthoritativeClosurePlanValidation(
  linkedValidations: readonly MarketIntelligenceRecommendationValidation[],
  gapSuccessThreshold: string | null
): MarketIntelligenceRecommendationValidation | null {
  if (linkedValidations.length === 0) return null;
  if (linkedValidations.length === 1) return linkedValidations[0];

  // Stage 0 (requirement #2, "validation/pilot action over generic
  // conditional execution"): defensive only -- resolveLinkedEvidenceGap
  // (Task #38) already refuses to link any OTHER action type to a gap at
  // all, so every real candidate reaching this function is already
  // validation/pilot. Only matters for a caller supplying a broader
  // candidate list directly.
  let pool = narrowByStructuralCompleteness(
    linkedValidations,
    (validation) => validation.actionType === "validation" || validation.actionType === "pilot"
  );
  if (pool.length === 1) return pool[0];

  // Stage 1 (requirements #5/#6, unchanged since Task #47A): owner and
  // timeline are a hard prerequisite -- a candidate missing either is
  // never eligible, regardless of how strong its other signals are (a
  // Closure Plan naming a WHO with no WHEN, or vice versa, is not
  // meaningfully more complete than no assignment at all).
  const eligible = pool.filter((validation) => validation.owner.trim() && validation.timeline.trim());
  if (eligible.length === 0) return null;
  if (eligible.length === 1) return eligible[0];
  pool = eligible;

  // Stage 2 (requirement #2, "action with measurable success metric"):
  // a candidate carrying its own explicit, structured success criterion
  // is preferred over one that names none at all -- a pure completeness
  // signal, deliberately never gated on that metric's OWN provenance
  // classification (provenance is surfaced separately on the resolved
  // plan, never used here to disqualify an otherwise-complete candidate).
  pool = narrowByStructuralCompleteness(pool, hasStructuredSuccessMetric);
  if (pool.length === 1) return pool[0];

  // Stage 3 (requirement #2, "action with evidence tie"): prefer a
  // candidate that names its own evidence tie.
  pool = narrowByStructuralCompleteness(pool, (validation) => Boolean(validation.evidenceTie.trim()));
  if (pool.length === 1) return pool[0];

  // Stage 4 (Task #47C, requirement #8 proxy, preserved): among a still-
  // tied pool, prefer whichever candidate's own success-metric figure
  // numerically matches this gap's own report-stated threshold -- never
  // applied unless the gap itself names a real, report-stated figure
  // (never a fabricated bar), and only ever narrows when it actually
  // distinguishes at least one candidate.
  const gapFigure = gapSuccessThreshold ? extractComparableThresholdFigure(gapSuccessThreshold) : null;
  if (gapFigure) {
    const numericMatches = pool.filter((validation) =>
      comparableThresholdFiguresMatch(gapFigure, extractComparableThresholdFigure(validation.successCriterion))
    );
    if (numericMatches.length > 0) pool = numericMatches;
  }

  return pool.length === 1 ? pool[0] : null;
}

type MarketIntelligenceClosurePlanAssignment = {
  owner: string;
  timeline: string;
  budget: string | null;
  hasAssignedOwner: boolean;
  evidenceTie: string | null;
  activity: string | null;
};

// requirement #1: owner/timeline/budget, sourced ONLY from the single
// authoritative candidate selectAuthoritativeClosurePlanValidation
// resolves -- see that function's own comment, and this section's
// top-of-file comment, for why an unresolved/ambiguous selection must
// never be arbitrated between.
function resolveClosurePlanAssignment(
  linkedValidations: readonly MarketIntelligenceRecommendationValidation[],
  gapSuccessThreshold: string | null,
  language: ResponseLanguage
): MarketIntelligenceClosurePlanAssignment {
  const validation = selectAuthoritativeClosurePlanValidation(linkedValidations, gapSuccessThreshold);
  if (!validation) {
    return {
      owner: CLOSURE_PLAN_NO_OWNER[language],
      timeline: CLOSURE_PLAN_NO_TIMELINE[language],
      budget: null,
      hasAssignedOwner: false,
      evidenceTie: null,
      activity: null,
    };
  }

  const owner = validation.owner.trim();
  const timeline = validation.timeline.trim();
  const budget = validation.budget.trim();
  const evidenceTie = validation.evidenceTie.trim();
  const activity = validation.activity.trim();
  // Task #38's own provenance suffix -- reused verbatim, never a second,
  // independently worded qualifier -- so "Planning Assumption"/
  // "Validation Target" reads identically here and on the recommendation
  // card it was lifted from.
  const provenanceSuffix = validation.provenance
    ? ` (${localizeRecommendationProvenance(validation.provenance, language)})`
    : "";

  return {
    owner: owner || CLOSURE_PLAN_NO_OWNER[language],
    timeline: timeline ? `${timeline}${provenanceSuffix}` : CLOSURE_PLAN_NO_TIMELINE[language],
    budget: budget ? `${budget}${provenanceSuffix}` : null,
    hasAssignedOwner: Boolean(owner),
    // requirement #3/#4: never fabricated -- null (never a placeholder
    // sentence) whenever the selected candidate itself names none.
    evidenceTie: evidenceTie || null,
    activity: activity || null,
  };
}

// TASK #48 -- extracted so the SAME closure-plan construction can run
// for ANY specific gap once its own controlling-threshold model has
// already been resolved (either the sole-controlling-gap path or the
// generalized per-gap path below) -- a pure extraction of the pre-Task-
// #48 body, zero logic change.
function buildClosurePlanForGap(
  gap: MarketIntelligenceEvidenceGap,
  controllingThreshold: MarketIntelligenceControllingDecisionThreshold,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[],
  language: ResponseLanguage
): MarketIntelligenceEvidenceGapClosurePlan {
  const linkedValidations = recommendationValidations.filter(
    (validation) => validation.relatedEvidenceGapId === gap.id
  );
  const assignment = resolveClosurePlanAssignment(linkedValidations, gap.successThreshold, language);

  return {
    gapId: gap.id,
    gapLabel: gap.label,
    affectedFactor: gap.decisionFactor as MarketIntelligenceDecisionFactor,
    requiredEvidence: gap.evidenceRequired,
    validationMethod: gap.validationMethod,
    owner: assignment.owner,
    timeline: assignment.timeline,
    budget: assignment.budget,
    // requirement #3: ENTER -> measurable successful validation, MONITOR
    // -> unresolved/inconclusive validation, AVOID -> failed validation --
    // aliased verbatim from the SAME controlling-threshold summaries
    // Evidence Gaps to Close already renders as "ENTER IF"/"MONITOR IF"/
    // "AVOID IF", never independently re-derived.
    measurableSuccessCriterion: controllingThreshold.enterSummary,
    monitorStatus: controllingThreshold.monitorSummary,
    failureCriterion: controllingThreshold.avoidSummary,
    decisionImpact: gap.decisionImpact,
    hasAssignedOwner: assignment.hasAssignedOwner,
    evidenceTie: assignment.evidenceTie,
    activity: assignment.activity,
  };
}

// The single, canonical, structured closure plan every render surface
// must read for a controlling evidence gap's WHO/WHEN/HOW-MUCH/WHAT-
// COUNTS-AS-SUCCESS-OR-FAILURE fields (requirement #1). Resolves ONLY
// for the SAME single-controlling-gap state
// resolveMarketIntelligenceControllingDecisionThreshold already gates on
// -- requirement #8's "multiple simultaneous material gaps do not cause
// the system to arbitrarily invent a single closure plan" is satisfied
// by construction here, not by a separate check, since this function
// simply cannot produce a non-null result unless that shared gate
// already resolved a single controlling gap. This public contract is
// UNCHANGED by Task #48 -- it is now a thin wrapper over
// buildClosurePlanForGap, so every pre-existing caller and test
// continues to see byte-identical behavior.
export function resolveMarketIntelligenceControllingClosurePlan(
  canonicalState: MarketIntelligenceCanonicalState | null,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceEvidenceGapClosurePlan | null {
  if (!canonicalState) return null;

  const controllingThreshold = resolveMarketIntelligenceControllingDecisionThreshold(
    canonicalState,
    recommendationValidations,
    language
  );
  if (!controllingThreshold) return null;

  const gap = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).find(
    (candidate) => candidate.id === controllingThreshold.gapId
  );
  // Structurally unreachable (controllingThreshold is itself derived from
  // this same gap list), kept as a defensive guard rather than a
  // non-null assertion.
  if (!gap) return null;

  return buildClosurePlanForGap(gap, controllingThreshold, recommendationValidations, language);
}

// TASK #48 -- the SAME closure-plan model, generalized to ANY SPECIFIC
// material gap by id, regardless of how many OTHER material gaps are
// simultaneously unresolved. Used only for a gap that has already been
// classified as a genuine multi-gap PRIMARY or CO-CONTROLLING candidate
// (resolveMarketIntelligenceMultiGapPriorityState below) -- never called
// speculatively for an arbitrary gap. Requirement #1's owner/timeline/
// budget/success/failure fields are built by the EXACT SAME
// buildClosurePlanForGap/resolveClosurePlanAssignment/
// selectAuthoritativeClosurePlanValidation pipeline the single-gap path
// already uses -- a secondary or co-controlling gap can therefore never
// borrow a field from a DIFFERENT gap's recommendation (requirement #5):
// linkedValidations is always filtered to `relatedEvidenceGapId ===
// gap.id`, and that identifier is itself never guessed (see
// resolveLinkedEvidenceGap's own comment).
export function resolveMarketIntelligenceGapClosurePlan(
  canonicalState: MarketIntelligenceCanonicalState | null,
  gapId: MarketIntelligenceEvidenceGapId,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceEvidenceGapClosurePlan | null {
  if (!canonicalState) return null;
  const gap = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).find(
    (candidate) => candidate.id === gapId && candidate.decisionFactor !== null
  );
  if (!gap) return null;

  const controllingThreshold = resolveMarketIntelligenceGapDecisionThreshold(
    canonicalState,
    gapId,
    recommendationValidations,
    language
  );
  if (!controllingThreshold) return null;

  return buildClosurePlanForGap(gap, controllingThreshold, recommendationValidations, language);
}

// TASK #48 -- Make Market Intelligence multi-gap evidence closure
// structurally authoritative.
//
// PROBLEM (the documented architectural note from Tasks #46/#47C):
// whenever 2+ material (decision-gating) evidence gaps are
// simultaneously unresolved, every "controlling factor" resolver above
// (resolveMarketIntelligenceControllingDecisionThreshold,
// resolveMarketIntelligenceControllingClosurePlan,
// resolveMarketIntelligenceDecisionThresholdState's own
// controllingUnresolvedCondition) abstains entirely -- correct
// discipline (never guess which of several co-equal, AND-gated pillars
// is "the" one), but leaves no defensible PRIORITIZED view at all, even
// when the report's own structured data already distinguishes the gaps
// (e.g. one has a report-stated numeric threshold and a structurally
// linked recommendation, the other has neither).
//
// FIX: resolveMarketIntelligenceMultiGapPriorityState ranks material
// gaps using ONLY two already-existing, already-structural signals, in a
// fixed precedence (never a weighted/invented score):
//   Tier 2 (strongest) -- the gap has a recommendation STRUCTURALLY
//     linked to it (relatedEvidenceGapId, Task #38/#48's own numeric-
//     match widening above) -- the report contains a concrete action
//     designed to close exactly this gap.
//   Tier 1 -- the gap has no linked recommendation, but the report's
//     OWN decision brief names a real threshold for it
//     (gap.successThreshold, Task #35).
//   Tier 0 -- neither.
// A gap reaching a HIGHER tier than every other material gap becomes
// the PRIMARY gap; every other material gap becomes SECONDARY. When 2+
// gaps tie at the HIGHEST tier reached by any gap, there is no
// structural basis to prefer one over the other -- they are represented
// as CO-CONTROLLING (primaryGap stays null; requirement #4: never guess
// between equally supported gaps), and any OTHER, lower-tier material
// gaps become secondary relative to that co-controlling set. With
// exactly one material gap, that gap is ALWAYS primary regardless of
// tier (requirement #5: preserve Task #47C's exact single-gap behavior)
// -- there is nothing to compare it against. With zero material gaps,
// every field is empty/null.
//
// This NEVER changes decisionCriticalEvidence, the canonical
// ENTER/MONITOR/AVOID decision, confidence, or which gaps count as
// material in the first place -- it only ranks gaps ALREADY found
// material by resolveMarketIntelligenceEvidenceGaps, using fields those
// same gaps and recommendationValidations already carry.
export type MarketIntelligenceGapPriorityStatus = "primary" | "secondary" | "coControlling";

export type MarketIntelligenceGapPriorityTier = "linkedRecommendation" | "reportStatedThreshold" | "unranked";

export type MarketIntelligencePrioritizedGap = {
  gap: MarketIntelligenceEvidenceGap;
  status: MarketIntelligenceGapPriorityStatus;
  tier: MarketIntelligenceGapPriorityTier;
  // The SAME closure plan resolveMarketIntelligenceGapClosurePlan
  // produces for this specific gap -- null only when this gap's own
  // controlling-threshold model does not resolve (structurally
  // unreachable for a gap already found material, kept as a defensive
  // type rather than a non-null assertion).
  closurePlan: MarketIntelligenceEvidenceGapClosurePlan | null;
};

export type MarketIntelligenceMultiGapPriorityState = {
  materialGaps: MarketIntelligenceEvidenceGap[];
  // Non-null whenever exactly one gap uniquely reaches the highest
  // priority tier (including the trivial single-material-gap case).
  // Null when zero material gaps exist, or 2+ tie at the top (see
  // coControllingGaps).
  primaryGap: MarketIntelligenceEvidenceGap | null;
  primaryClosurePlan: MarketIntelligenceEvidenceGapClosurePlan | null;
  // Every material gap that is NOT primary and NOT co-controlling.
  secondaryGaps: MarketIntelligenceEvidenceGap[];
  // Non-empty ONLY when 2+ gaps tie at the highest priority tier --
  // requirement #4's explicit "represent them explicitly as co-
  // controlling gaps" state. Always empty when primaryGap is non-null.
  coControllingGaps: MarketIntelligenceEvidenceGap[];
  // Per-gap breakdown (status/tier/own closure plan) for every material
  // gap, in the SAME order resolveMarketIntelligenceEvidenceGaps
  // returns them -- the single source every render surface should read
  // rather than re-deriving status per gap itself.
  prioritized: MarketIntelligencePrioritizedGap[];
};

function resolveGapPriorityTier(
  gap: MarketIntelligenceEvidenceGap,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[]
): MarketIntelligenceGapPriorityTier {
  const hasLinkedRecommendation = recommendationValidations.some(
    (validation) => validation.relatedEvidenceGapId === gap.id
  );
  if (hasLinkedRecommendation) return "linkedRecommendation";
  if (gap.successThreshold) return "reportStatedThreshold";
  return "unranked";
}

const GAP_PRIORITY_TIER_RANK: Record<MarketIntelligenceGapPriorityTier, number> = {
  linkedRecommendation: 2,
  reportStatedThreshold: 1,
  unranked: 0,
};

export function resolveMarketIntelligenceMultiGapPriorityState(
  canonicalState: MarketIntelligenceCanonicalState | null,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceMultiGapPriorityState {
  const materialGaps = canonicalState
    ? resolveMarketIntelligenceEvidenceGaps(canonicalState, language).filter((gap) => gap.decisionFactor !== null)
    : [];

  const empty: MarketIntelligenceMultiGapPriorityState = {
    materialGaps: [],
    primaryGap: null,
    primaryClosurePlan: null,
    secondaryGaps: [],
    coControllingGaps: [],
    prioritized: [],
  };
  if (!canonicalState || materialGaps.length === 0) return empty;

  const closurePlanFor = (gapId: MarketIntelligenceEvidenceGapId) =>
    resolveMarketIntelligenceGapClosurePlan(canonicalState, gapId, recommendationValidations, language);

  // Requirement #5: the trivial, already-shipped single-gap case is
  // ALWAYS primary, regardless of tier -- byte-identical to Task #47C's
  // own behavior (resolveMarketIntelligenceControllingClosurePlan is
  // itself called here, guaranteeing identical output, not a re-
  // implementation).
  if (materialGaps.length === 1) {
    const gap = materialGaps[0];
    const closurePlan = resolveMarketIntelligenceControllingClosurePlan(canonicalState, recommendationValidations, language);
    return {
      materialGaps,
      primaryGap: gap,
      primaryClosurePlan: closurePlan,
      secondaryGaps: [],
      coControllingGaps: [],
      prioritized: [
        { gap, status: "primary", tier: resolveGapPriorityTier(gap, recommendationValidations), closurePlan },
      ],
    };
  }

  const tiered = materialGaps.map((gap) => ({ gap, tier: resolveGapPriorityTier(gap, recommendationValidations) }));
  const highestRank = Math.max(...tiered.map((entry) => GAP_PRIORITY_TIER_RANK[entry.tier]));
  const topTierEntries = tiered.filter((entry) => GAP_PRIORITY_TIER_RANK[entry.tier] === highestRank);

  if (topTierEntries.length === 1) {
    const primaryGap = topTierEntries[0].gap;
    const secondaryGaps = materialGaps.filter((gap) => gap.id !== primaryGap.id);
    const prioritized: MarketIntelligencePrioritizedGap[] = tiered.map(({ gap, tier }) => ({
      gap,
      status: gap.id === primaryGap.id ? "primary" : "secondary",
      tier,
      closurePlan: closurePlanFor(gap.id),
    }));
    return {
      materialGaps,
      primaryGap,
      primaryClosurePlan: closurePlanFor(primaryGap.id),
      secondaryGaps,
      coControllingGaps: [],
      prioritized,
    };
  }

  // Requirement #4: 2+ gaps genuinely tie at the highest reached tier --
  // never guess between them. They are all CO-CONTROLLING; any other
  // material gap not in that top tier is secondary to the co-
  // controlling set.
  const coControllingIds = new Set(topTierEntries.map((entry) => entry.gap.id));
  const coControllingGaps = materialGaps.filter((gap) => coControllingIds.has(gap.id));
  const secondaryGaps = materialGaps.filter((gap) => !coControllingIds.has(gap.id));
  const prioritized: MarketIntelligencePrioritizedGap[] = tiered.map(({ gap, tier }) => ({
    gap,
    status: coControllingIds.has(gap.id) ? "coControlling" : "secondary",
    tier,
    closurePlan: closurePlanFor(gap.id),
  }));

  return {
    materialGaps,
    primaryGap: null,
    primaryClosurePlan: null,
    secondaryGaps,
    coControllingGaps,
    prioritized,
  };
}

// TASK #40 -- Make Market Intelligence confidence scoring structurally
// authoritative and explainable.
//
// AUDIT FINDING (confirmed via full trace: generation -> normalization ->
// canonical state -> persistence/reload -> Executive Summary -> Executive
// Snapshot -> Strategic Recommendations -> PDF): the confidence SCORE
// itself was already 100% structurally calculated, deterministic, and
// never AI-generated or prose-inferred. buildMarketExecutiveDecisionBrief
// (market-intelligence-presentation.ts) sets `confidence` to exactly
// `assessMarketEntryConfidence(coverage, decisionCriticalEvidence).confidence`
// -- a pure function of coverage.dimensions (a weighted blend:
// marketConfidence*0.4 + competitiveEvidence*0.25 + financialEvidence*0.2
// + productEvidence*0.15) capped by capConfidenceForEvidenceGap based on
// how many of the 3 decision-critical pillars are unresolved (0 -> no
// cap, 1 -> <=50, 2 -> <=40, 3 -> <=30). This module does NOT change, or
// duplicate, that calculation anywhere -- canonicalState.confidence
// (persisted verbatim from that one computation) remains the single
// source of truth for the NUMBER.
//
// THE ACTUAL GAP: confidence's own EXPLANATION was not structurally
// persisted or reproducible. buildMarketExecutiveDecisionBrief also
// computes confidenceFactors (buildConfidenceExplanation) at generation
// time, but MarketIntelligenceCanonicalState only ever persisted
// confidenceDirection, never the factors array itself -- so on reload,
// any surface wanting to explain "why is confidence X%" had no
// structured source and would have had to re-scan this report's own
// "Confidence Reduced Because"/"Confidence Supported By" rendered prose
// bullets -- exactly the keyword-matching-generated-prose anti-pattern
// this task forbids.
//
// FIX: resolveMarketIntelligenceConfidenceState is a PURE, read-time
// function of fields the canonical state has already persisted since
// version 3 (confidence, decision, decisionCriticalEvidence, and --
// through resolveMarketIntelligenceEvidenceGaps -- coverage/marketSizing/
// cagr) -- no new persisted field, no version bump, so it is correct
// immediately for every already-persisted report on reload (requirement
// #11/#12). Contributors (resolved pillars) and constraints (unresolved
// pillars) are built from the EXACT SAME 3-pillar decisionCriticalEvidence
// gate the score itself is capped on, and constraints reuse
// resolveMarketIntelligenceEvidenceGaps' own already-deduplicated
// material-gap list verbatim (requirement #8: "SOM unresolved"/
// "Obtainable Share unresolved"/"controlling factor" are the SAME single
// gap object here, never three independently-derived penalty lines).
export type MarketIntelligenceConfidenceContributor = {
  factor: MarketIntelligenceDecisionFactor;
  label: string;
  description: string;
};

export type MarketIntelligenceConfidenceConstraint = {
  factor: MarketIntelligenceDecisionFactor;
  label: string;
  description: string;
  // True only when this is the SOLE unresolved decision-critical pillar
  // (Task #37's own controllingUnresolvedCondition/Task #39's
  // controllingFactor discipline) -- never a guess among several.
  isControllingFactor: boolean;
};

// "structural" is the only value this module ever produces -- confidence
// here is always derived from canonical structured state, never from
// generated prose. Kept as an explicit field (rather than assumed)
// so a consumer never has to trust that by convention alone.
export type MarketIntelligenceConfidenceProvenance = "structural";

export type MarketIntelligenceConfidenceState = {
  // Verbatim canonicalState.confidence -- this module never recomputes,
  // second-guesses, or independently derives the number itself (that
  // would be "multiple independent confidence calculations", exactly
  // what this task forbids). See this module's own audit comment above
  // for how that number is actually produced upstream.
  score: number;
  level: MarketConfidenceFactorLevel;
  decision: ExecutiveDecisionCode;
  contributors: MarketIntelligenceConfidenceContributor[];
  constraints: MarketIntelligenceConfidenceConstraint[];
  rationale: string;
  provenance: MarketIntelligenceConfidenceProvenance;
};

function decisionFactorLabel(factor: MarketIntelligenceDecisionFactor, language: ResponseLanguage): string {
  if (factor === "marketSizingResolved") return MARKET_SIZING_GAP_COPY[language].label;
  if (factor === "competitiveEvidenceResolved") return COMPETITIVE_EVIDENCE_GAP_COPY[language].label;
  return OBTAINABLE_SHARE_GAP_COPY[language].label;
}

// The positive mirror of each gap's own "why it matters" framing --
// stated as a fact about what already resolved, never a new evidence
// classification. Deliberately short (one sentence), matching this
// report's own existing confidence-explanation prose style
// (buildConfidenceExplanation, market-intelligence-presentation.ts).
const CONFIDENCE_CONTRIBUTOR_DESCRIPTIONS: Record<MarketIntelligenceDecisionFactor, Record<ResponseLanguage, string>> = {
  marketSizingResolved: {
    English: "A verified market-size figure or defensible planning estimate exists for this market.",
    Turkish: "Bu pazar için doğrulanmış bir pazar büyüklüğü rakamı veya savunulabilir bir planlama tahmini mevcut.",
    German: "Für diesen Markt liegt eine verifizierte Marktgröße oder eine belastbare Planungsschätzung vor.",
    French: "Un chiffre de taille de marché vérifié ou une estimation de planification défendable existe pour ce marché.",
    Spanish: "Existe una cifra de tamaño de mercado verificada o una estimación de planificación defendible para este mercado.",
  },
  competitiveEvidenceResolved: {
    English: "At least one named, evidenced competitor or adjacent player was identified.",
    Turkish: "En az bir adı belirtilmiş, kanıtlanmış rakip veya yakın oyuncu tespit edildi.",
    German: "Mindestens ein benannter, belegter Wettbewerber oder angrenzender Akteur wurde identifiziert.",
    French: "Au moins un concurrent nommé et étayé, ou un acteur adjacent, a été identifié.",
    Spanish: "Se identificó al menos un competidor nombrado y respaldado por evidencia, o un actor adyacente.",
  },
  obtainableShareResolved: {
    English: "Obtainable share (SAM/SOM) was calculated from evidence-derived inputs.",
    Turkish: "Ulaşılabilir pay (SAM/SOM), kanıta dayalı girdilerden hesaplandı.",
    German: "Der erzielbare Anteil (SAM/SOM) wurde aus evidenzbasierten Eingaben berechnet.",
    French: "La part accessible (SAM/SOM) a été calculée à partir de données fondées sur des preuves.",
    Spanish: "La cuota alcanzable (SAM/SOM) se calculó a partir de datos basados en evidencia.",
  },
};

const CONFIDENCE_PILLAR_ORDER: readonly MarketIntelligenceDecisionFactor[] = [
  "marketSizingResolved",
  "competitiveEvidenceResolved",
  "obtainableShareResolved",
];

const CONFIDENCE_RATIONALE_ALL_RESOLVED_TEMPLATES: Record<ResponseLanguage, (score: number) => string> = {
  English: (score) => `${score}% confidence reflects all 3 decision-critical evidence pillars resolved.`,
  Turkish: (score) => `%${score} güven, karar açısından kritik 3 kanıt unsurunun tamamının çözümlendiğini yansıtır.`,
  German: (score) => `Eine Konfidenz von ${score}% spiegelt wider, dass alle 3 entscheidungskritischen Nachweissäulen geklärt sind.`,
  French: (score) => `Une confiance de ${score}% reflète les 3 piliers de preuves déterminants résolus.`,
  Spanish: (score) => `Una confianza del ${score}% refleja que se resolvieron los 3 pilares de evidencia críticos para la decisión.`,
};

const CONFIDENCE_RATIONALE_SINGLE_CONSTRAINT_TEMPLATES: Record<
  ResponseLanguage,
  (score: number, resolvedCount: number, constraintLabel: string) => string
> = {
  English: (score, resolvedCount, label) =>
    `${score}% confidence reflects ${resolvedCount} of 3 decision-critical evidence pillars resolved; ${label} remains the principal constraint.`,
  Turkish: (score, resolvedCount, label) =>
    `%${score} güven, karar açısından kritik 3 unsurdan ${resolvedCount} tanesinin çözümlendiğini yansıtır; temel kısıt ${label} olmaya devam ediyor.`,
  German: (score, resolvedCount, label) =>
    `Eine Konfidenz von ${score}% spiegelt wider, dass ${resolvedCount} von 3 entscheidungskritischen Nachweissäulen geklärt sind; ${label} bleibt die Hauptbeschränkung.`,
  French: (score, resolvedCount, label) =>
    `Une confiance de ${score}% reflète ${resolvedCount} des 3 piliers de preuves déterminants résolus ; ${label} demeure la principale contrainte.`,
  Spanish: (score, resolvedCount, label) =>
    `Una confianza del ${score}% refleja ${resolvedCount} de los 3 pilares de evidencia críticos resueltos; ${label} sigue siendo la principal limitación.`,
};

const CONFIDENCE_RATIONALE_MULTI_CONSTRAINT_TEMPLATES: Record<
  ResponseLanguage,
  (score: number, resolvedCount: number, unresolvedCount: number) => string
> = {
  English: (score, resolvedCount, unresolvedCount) =>
    `${score}% confidence reflects ${resolvedCount} of 3 decision-critical evidence pillars resolved; ${unresolvedCount} pillars remain unresolved.`,
  Turkish: (score, resolvedCount, unresolvedCount) =>
    `%${score} güven, karar açısından kritik 3 unsurdan ${resolvedCount} tanesinin çözümlendiğini yansıtır; ${unresolvedCount} unsur çözümlenmemiş durumda.`,
  German: (score, resolvedCount, unresolvedCount) =>
    `Eine Konfidenz von ${score}% spiegelt wider, dass ${resolvedCount} von 3 entscheidungskritischen Nachweissäulen geklärt sind; ${unresolvedCount} Säulen bleiben ungeklärt.`,
  French: (score, resolvedCount, unresolvedCount) =>
    `Une confiance de ${score}% reflète ${resolvedCount} des 3 piliers de preuves déterminants résolus ; ${unresolvedCount} piliers restent non résolus.`,
  Spanish: (score, resolvedCount, unresolvedCount) =>
    `Una confianza del ${score}% refleja ${resolvedCount} de los 3 pilares de evidencia críticos resueltos; ${unresolvedCount} pilares permanecen sin resolver.`,
};

function buildConfidenceRationale(
  score: number,
  resolvedCount: number,
  constraints: readonly MarketIntelligenceConfidenceConstraint[],
  language: ResponseLanguage
): string {
  if (constraints.length === 0) {
    return CONFIDENCE_RATIONALE_ALL_RESOLVED_TEMPLATES[language](score);
  }
  if (constraints.length === 1) {
    return CONFIDENCE_RATIONALE_SINGLE_CONSTRAINT_TEMPLATES[language](score, resolvedCount, constraints[0].label);
  }
  return CONFIDENCE_RATIONALE_MULTI_CONSTRAINT_TEMPLATES[language](score, resolvedCount, constraints.length);
}

// The single, canonical, structured confidence model every render
// surface must read (requirement #2). Never a second confidence
// calculation: `score`/`decision` are read verbatim from canonicalState;
// everything else is a pure reshape of the SAME 3-pillar
// decisionCriticalEvidence gate and the SAME deduplicated material-gap
// list every other Task #35-#39 resolver already computes.
export function resolveMarketIntelligenceConfidenceState(
  canonicalState: MarketIntelligenceCanonicalState | null,
  language: ResponseLanguage = "English"
): MarketIntelligenceConfidenceState | null {
  if (!canonicalState) return null;

  const evidence = canonicalState.decisionCriticalEvidence;
  const materialGaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).filter(
    (gap) => gap.decisionFactor !== null
  );

  const contributors: MarketIntelligenceConfidenceContributor[] = CONFIDENCE_PILLAR_ORDER.filter(
    (factor) => evidence[factor]
  ).map((factor) => ({
    factor,
    label: decisionFactorLabel(factor, language),
    description: CONFIDENCE_CONTRIBUTOR_DESCRIPTIONS[factor][language],
  }));

  // requirement #8 -- reusing resolveMarketIntelligenceEvidenceGaps'
  // already-deduplicated list (one entry per unresolved pillar) is what
  // makes double-counting structurally impossible here: there is no
  // second, independently-built "unresolved factors" list this could
  // ever disagree with.
  const constraints: MarketIntelligenceConfidenceConstraint[] = materialGaps.map((gap) => ({
    factor: gap.decisionFactor as MarketIntelligenceDecisionFactor,
    label: gap.label,
    description: gap.currentStatus,
    isControllingFactor: materialGaps.length === 1,
  }));

  return {
    score: canonicalState.confidence,
    level: categorizeConfidenceScore(canonicalState.confidence),
    decision: canonicalState.decision,
    contributors,
    constraints,
    rationale: buildConfidenceRationale(canonicalState.confidence, contributors.length, constraints, language),
    provenance: "structural",
  };
}

// TASK #53 -- Make Market Intelligence ENTER eligibility structurally
// evidence-gated.
//
// AUDIT FINDING (full trace of the canonical decision pipeline,
// assessMarketEntryConfidence, market-intelligence-presentation.ts):
// the canonical ENTER/MONITOR/AVOID decision is ALREADY, and remains,
// a pure function of exactly two already-persisted inputs -- coverage
// (4 confidence dimensions, computed at generation time from classified
// research evidence) and decisionCriticalEvidence (the SAME 3
// structural booleans this whole module already reads everywhere else).
// It NEVER reads a recommendation's own text, a Closure Plan, a Decision
// Threshold, or any "is this number met" evaluation -- there is no code
// path by which a recommendation's own "10 paying customers (Validation
// Target)" KPI, however it is worded or classified, could reach
// assessMarketEntryConfidence at all. evidenceGapBlocksStrongDecision
// (that function's own existing logic) ALREADY forces MONITOR --  never
// AVOID -- whenever any of the 3 pillars is unresolved, regardless of
// whether the raw blended score would otherwise read ENTER or AVOID:
// requirement #8 ("weak evidence must not automatically produce AVOID")
// was therefore ALREADY satisfied by the existing, unmodified
// methodology, confirmed here by trace and locked in by regression test
// rather than by any code change.
//
// THE ACTUAL GAP: nothing in this module ever separated a threshold's
// own TARGET (what must eventually be true) from an OBSERVED RESULT
// (what the available evidence demonstrates has actually happened) --
// "ENTER IF" text has always been a CONDITION STATEMENT, never a
// pass/fail evaluation. That is safe for DISPLAY (Tasks #35-#52 never
// claim a target has been met), but there was no STRUCTURAL, TESTABLE
// gate formalizing "a numeric ENTER requirement, however completely it
// is described, can only be treated as SATISFIED when its OWN
// provenance is genuinely verified -- never merely because a target
// number is present, matched, or classified as a validation target."
//
// FIX: resolveMarketIntelligenceEnterEligibility is a NEW, PURELY
// ADDITIVE, read-only function -- like every other resolver in this
// module, it computes a value FROM already-canonical state and NEVER
// writes back to it, and it is NOT a second decision engine: `eligible`
// is derived from decisionCriticalEvidence -- the EXACT SAME structural
// gate assessMarketEntryConfidence's own cap already uses -- so it can
// never disagree with, or influence, the canonical `decision` field.
// isEnterRequirementEvidenceQualified/isCompoundEnterRequirementEvidenceQualified
// are the formal TARGET-vs-OBSERVED gate requirement #6 asks for: a
// requirement's own numeric target string is NEVER itself evidence that
// the target was achieved -- only a genuinely verified (or, for a
// requirement class that explicitly and structurally allows it,
// benchmark-derived) provenance value counts as "the observed result
// satisfies this requirement." A compound threshold (Task #52) is
// satisfied only when EVERY component independently qualifies -- the
// weakest linked component governs, exactly requirement #3's "10
// paying customers + USD 25k ACV" example.
export type MarketIntelligenceEnterRequirementResult = {
  gapId: MarketIntelligenceEvidenceGapId;
  gapLabel: string;
  // The controlling ENTER criterion driving this result, broken into
  // its own per-component provenance (Task #52) -- empty when no
  // report-stated or recommendation-derived criterion exists at all
  // (evidence required, never fabricated).
  components: MarketIntelligenceThresholdComponent[];
  // Whether EVERY component's own provenance is strong enough to
  // independently satisfy this ENTER requirement -- never true merely
  // because a target number exists, matches, or is named a "Validation
  // Target"; never true for an empty components list (requirement #5:
  // "evidence required" is the honest default, not a guess).
  evidenceQualified: boolean;
};

export type MarketIntelligenceEnterEligibilityState = {
  decision: ExecutiveDecisionCode;
  // True only when NO decision-critical pillar is unresolved -- the
  // IDENTICAL structural condition assessMarketEntryConfidence's own
  // evidenceGapBlocksStrongDecision gate already requires before this
  // report's canonical decision can ever read ENTER (GO). This can
  // never disagree with the canonical decision, because it is derived
  // from the SAME decisionCriticalEvidence booleans, never a second,
  // independently-computed gate.
  eligible: boolean;
  // Every currently-unresolved material gap -- non-empty whenever
  // `eligible` is false for this reason. Empty when every pillar is
  // already resolved (regardless of whether `decision` itself happens
  // to read ENTER, MONITOR, or AVOID for OTHER reasons -- e.g. weak raw
  // coverage can still keep a fully-resolved report at MONITOR or
  // AVOID; this field only reports the EVIDENCE-GAP dimension of
  // eligibility, never the confidence-strength dimension, which remains
  // assessMarketEntryConfidence's own unchanged responsibility).
  blockingGaps: MarketIntelligenceEvidenceGap[];
  // Per-(currently unresolved) gap breakdown of what evidence would
  // need to qualify for THAT gap's own ENTER condition to be considered
  // satisfied -- requirement #5's "what evidence class is required,
  // whether it is actually satisfied" made explicit and testable.
  requirements: MarketIntelligenceEnterRequirementResult[];
};

// Strict by default: only a genuinely, independently verified citation
// qualifies as evidence that an ENTER requirement's own target has
// actually been achieved. allowBenchmarkDerived exists ONLY for a
// future requirement class this report style does not currently define
// one for; every real call site in this module leaves it false, so
// nothing short of real verified evidence can satisfy an ENTER
// requirement today -- "prefer abstention over guessing."
function isEnterRequirementEvidenceQualified(
  provenance: MarketIntelligenceRecommendationProvenance | null,
  options: { allowBenchmarkDerived?: boolean } = {}
): boolean {
  if (provenance === "verifiedEvidence") return true;
  if (provenance === "benchmarkDerived" && options.allowBenchmarkDerived) return true;
  return false;
}

// Compound-aware (Task #52): a multi-component threshold is satisfied
// for ENTER purposes ONLY when EVERY component independently qualifies
// -- the weakest component governs, never the strongest, and an empty
// component list (no numeric claim at all) is never "satisfied."
function isCompoundEnterRequirementEvidenceQualified(
  components: readonly MarketIntelligenceThresholdComponent[],
  options: { allowBenchmarkDerived?: boolean } = {}
): boolean {
  if (components.length === 0) return false;
  return components.every((component) => isEnterRequirementEvidenceQualified(component.provenance, options));
}

// The single, canonical, structured ENTER-eligibility model every
// render surface must read if it ever needs to explain (never
// recompute) why ENTER is or is not currently reachable. Pure and
// read-only: never mutates canonicalState, never a second decision
// engine, and structurally incapable of promoting a report to ENTER --
// it can only ever CONFIRM or EXPLAIN what assessMarketEntryConfidence
// already decided from decisionCriticalEvidence + coverage.
export function resolveMarketIntelligenceEnterEligibility(
  canonicalState: MarketIntelligenceCanonicalState | null,
  recommendationValidations: readonly MarketIntelligenceRecommendationValidation[] = [],
  language: ResponseLanguage = "English"
): MarketIntelligenceEnterEligibilityState | null {
  if (!canonicalState) return null;

  const blockingGaps = resolveMarketIntelligenceEvidenceGaps(canonicalState, language).filter(
    (gap) => gap.decisionFactor !== null
  );

  const requirements: MarketIntelligenceEnterRequirementResult[] = blockingGaps.map((gap) => {
    const threshold = resolveMarketIntelligenceGapDecisionThreshold(canonicalState, gap.id, recommendationValidations, language);
    const enterCriterion =
      threshold?.enterConditions.find(
        (criterion) => criterion.dimension === "recommendationValidationTarget" || criterion.dimension === "reportStatedThreshold"
      ) ?? null;
    const components =
      enterCriterion?.components ??
      (enterCriterion?.provenance && enterCriterion.value ? [{ text: enterCriterion.value, provenance: enterCriterion.provenance }] : []);
    return {
      gapId: gap.id,
      gapLabel: gap.label,
      components,
      evidenceQualified: isCompoundEnterRequirementEvidenceQualified(components),
    };
  });

  return {
    decision: canonicalState.decision,
    // requirement #2: ENTER requires NO unresolved decision-critical
    // evidence gap -- the IDENTICAL condition assessMarketEntryConfidence
    // already enforces, read here rather than recomputed, so this can
    // never disagree with the canonical decision.
    eligible: blockingGaps.length === 0,
    blockingGaps,
    requirements,
  };
}

// TASK #53A -- the single canonical decision-RESOLUTION entrypoint every
// Market Intelligence UI/PDF surface must call instead of
// resolveMarketIntelligenceExecutiveDecisionWithCanonicalState directly.
// It delegates to that existing resolver for everything (label,
// decisionSource, confidenceScore, language) and then applies exactly
// one additional check, reusing resolveMarketIntelligenceEnterEligibility
// above verbatim -- never a second, independently-computed decision
// engine, never a re-derivation of eligibility from anything other than
// the same decisionCriticalEvidence booleans assessMarketEntryConfidence
// already used at generation time.
//
// Gate: an ENTER (GO) verdict may reach a render surface only when
// resolveMarketIntelligenceEnterEligibility reports no unresolved
// decision-critical evidence gap for this canonical state; otherwise it
// is downgraded to MONITOR (CONDITIONAL_GO) for display purposes only.
// MONITOR and AVOID are never touched -- the eligibility check only ever
// narrows GO, so it structurally cannot promote or otherwise change any
// other decision (requirement #4). confidenceScore is passed through
// unchanged: this task gates the decision LABEL a report is allowed to
// show, not the confidence number generation already computed.
//
// For a correctly generated report this is a no-op: GO with an
// unresolved decision-critical evidence gap cannot occur, because
// assessMarketEntryConfidence's own evidenceGapBlocksStrongDecision
// already forces MONITOR at generation time from the identical
// condition. This gate is defense-in-depth for canonical state that
// predates that invariant or was altered after generation -- not a
// second source of truth.
//
// Reports with no canonicalState (legacy banner-parse fallback) are
// passed through completely unchanged: resolveMarketIntelligenceEnterEligibility
// requires a canonicalState to evaluate evidence gaps against, so there
// is nothing to gate.
export function resolveMarketIntelligenceGatedExecutiveDecision(
  canonicalState: MarketIntelligenceCanonicalState | null,
  executiveSummaryContent: string,
  language: ResponseLanguage = "English"
): MarketIntelligenceExecutiveDecision {
  const resolved = resolveMarketIntelligenceExecutiveDecisionWithCanonicalState(
    canonicalState,
    executiveSummaryContent,
    language
  );

  if (!canonicalState || canonicalState.decision !== "GO") return resolved;

  const eligibility = resolveMarketIntelligenceEnterEligibility(canonicalState, [], language);
  if (!eligibility || eligibility.eligible) return resolved;

  return {
    ...resolved,
    decisionLabel: localizeExecutiveDecision("CONDITIONAL_GO", resolved.language, "market"),
    canonicalDecision: mapExecutiveDecisionCodeToCanonicalDecision("CONDITIONAL_GO"),
  };
}
