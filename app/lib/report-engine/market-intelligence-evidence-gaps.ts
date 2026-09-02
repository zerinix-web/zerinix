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
import {
  localizeExecutiveDecision,
  type ExecutiveDecisionCode,
} from "@/app/lib/report-engine/executive-decision-brief";
import type { DecisionCriticalEvidenceState } from "@/app/lib/report-engine/market-intelligence-presentation";
import type {
  MarketIntelligenceCanonicalState,
  MarketIntelligenceCanonicalMarketSizing,
} from "@/app/lib/report-engine/market-intelligence-canonical-state";

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
// Scoped to obtainable-share/market-sizing language (percentage-of-share
// or dollar-figure phrasing tied to "above/over/at least/exceeding")
// since that is the only class of numeric bar this report style ever
// names for itself.
const NAMED_SUCCESS_THRESHOLD_PATTERN =
  /\b(?:above|over|exceeding|beyond|at least)\s+[\d.,]+\s?%|\b[\d.,]+\s?%\s+(?:or\s+(?:higher|more|above))/i;

function extractNamedSuccessThreshold(whatWouldChangeThisDecision: string): string | null {
  const match = whatWouldChangeThisDecision.match(NAMED_SUCCESS_THRESHOLD_PATTERN);
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
      successThreshold: null,
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
export type MarketIntelligenceGapDrivenAction = {
  gapId: MarketIntelligenceEvidenceGapId;
  gapLabel: string;
  action: string;
  measurableResult: string;
  decisionConsequence: string;
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
    }));
}
