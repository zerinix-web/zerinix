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

// Splits report prose into single-sentence candidates for extraction.
// AI-generated sections sometimes write every point as its own line/bullet,
// but just as often cram a whole ranked list into one dense paragraph like
// "Temel tehditler: (1) foo. (2) bar. (3) baz." -- naively taking that
// entire paragraph as "the one risk" produces an unreadable, multi-point
// quote everywhere it's reused (Biggest Risk, First 90 Days, the closing
// verdict). Splitting on the inline "(N)" markers and trimming each
// fragment to its first sentence keeps every extraction a single,
// quotable point regardless of which style the model used.
function splitIntoCandidateSentences(content: string): string[] {
  return (content || "")
    .split("\n")
    .flatMap((line) =>
      line
        .replace(/^[-*•]\s*/, "")
        .replace(/^#{1,6}\s*/, "")
        .split(/\s*\(\d+\)\s*/)
    )
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      // Drop a short "Label:" lead-in (e.g. "Temel tehditler:") that
      // precedes the first numbered point in the same paragraph.
      const withoutLeadIn = item.replace(/^[^:]{0,40}:\s*/, "").trim() || item;
      const sentenceMatch = withoutLeadIn.match(/^[^.!?]*[.!?]/);
      return (sentenceMatch ? sentenceMatch[0] : withoutLeadIn).trim();
    });
}

// Extracted sentences already end in their own terminal punctuation;
// templates that append "." after interpolating one must use this instead
// of a raw literal period, or the result reads "...sentence..".
function ensureSentence(text: string) {
  const trimmed = (text || "").trim();
  return trimmed && !/[.!?]$/.test(trimmed) ? `${trimmed}.` : trimmed;
}

function firstSubstantiveLine(content: string) {
  const line = splitIntoCandidateSentences(content).find(
    (item) => item.length > 24 && !/^[A-Z0-9 /&-]{2,40}:?$/.test(item)
  );

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
  const lines = splitIntoCandidateSentences(content)
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
        `- What would change this: verified, independent evidence that closes the "${risk}" gap.`,
        `- Bunu değiştirecek şey: "${risk}" boşluğunu kapatan doğrulanmış, bağımsız kanıt.`,
        `- Was dies ändern würde: verifizierte, unabhängige Belege, die die Lücke „${risk}" schließen.`,
        `- Ce qui changerait cela : des preuves indépendantes vérifiées comblant la lacune « ${risk} ».`,
        `- Qué cambiaría esto: evidencia independiente y verificada que cierre la brecha "${risk}".`
      ),
      marketText(
        language,
        "- Reassess when: new verified data becomes available, not on a fixed calendar date.",
        "- Yeniden değerlendirme zamanı: sabit bir takvim tarihinde değil, yeni doğrulanmış veri elde edildiğinde.",
        "- Neu bewerten, wenn: neue verifizierte Daten verfügbar werden, nicht zu einem festen Kalenderdatum.",
        "- Réévaluer lorsque : de nouvelles données vérifiées deviennent disponibles, pas à une date calendaire fixe.",
        "- Reevaluar cuando: haya nuevos datos verificados disponibles, no en una fecha fija del calendario."
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

// Decision-code-conditioned First 90 Days. GO gets entry-oriented
// language; CONDITIONAL_GO gets a bounded, gated pilot; NO_GO must never
// contain entry/pilot/scale language -- only monitoring and a concrete
// re-entry trigger. This is the fix for the contradiction bug where the
// action plan used to say "Prioritize entry..." even when the decision
// itself was AVOID/NO_GO.
function buildDecisionConditionedFirst90Days(
  code: ExecutiveDecisionCode,
  sections: MarketSections,
  language: ResponseLanguage,
  primaryRisk: string
): string[] {
  if (code === "GO") {
    // where/topDriver come from the report's own prose and can be a full
    // sentence rather than a bare noun phrase -- introduced as a labeled
    // clause (colon) instead of embedded as a grammatical object, so the
    // sentence stays valid regardless of the extracted phrase's own shape.
    const where = ensureSentence(whereToEnter(sections, language));
    const topDriver = ensureSentence(topMarketDriver(sections, language));
    return [
      marketText(
        language,
        `Prioritize entry now. Regional signal: ${where} Primary driver to anchor on: ${topDriver}`,
        `Girişe şimdi öncelik verin. Bölgesel sinyal: ${where} Odaklanılacak birincil itici güç: ${topDriver}`,
        `Priorisieren Sie den Markteintritt jetzt. Regionales Signal: ${where} Haupttreiber, auf den fokussiert wird: ${topDriver}`,
        `Priorisez l'entrée dès maintenant. Signal régional : ${where} Principal moteur à privilégier : ${topDriver}`,
        `Priorice la entrada ahora. Señal regional: ${where} Motor principal en el que enfocarse: ${topDriver}`
      ),
      marketText(
        language,
        `Execution approach: ${ensureSentence(howToEnter(sections, language))}`,
        `Uygulama yaklaşımı: ${ensureSentence(howToEnter(sections, language))}`,
        `Vorgehensweise: ${ensureSentence(howToEnter(sections, language))}`,
        `Approche d'exécution : ${ensureSentence(howToEnter(sections, language))}`,
        `Enfoque de ejecución: ${ensureSentence(howToEnter(sections, language))}`
      ),
      marketText(
        language,
        `Track "${primaryRisk}" as the leading indicator before committing further spend.`,
        `Daha fazla harcama taahhüt etmeden önce "${primaryRisk}" öncü göstergesini izleyin.`,
        `Verfolgen Sie „${primaryRisk}" als Frühindikator, bevor weitere Ausgaben zugesagt werden.`,
        `Suivez « ${primaryRisk} » comme indicateur avancé avant d'engager d'autres dépenses.`,
        `Monitoree "${primaryRisk}" como indicador principal antes de comprometer más gasto.`
      ),
    ];
  }

  if (code === "CONDITIONAL_GO") {
    const where = ensureSentence(whereToEnter(sections, language));
    const topDriver = ensureSentence(topMarketDriver(sections, language));
    return [
      marketText(
        language,
        `Run a bounded pilot, capped to the minimum spend needed to test the primary driver. Regional signal: ${where} Primary driver to test: ${topDriver}`,
        `Ana itici gücü test etmek için gereken en düşük bütçeyle sınırlı bir pilot uygulama yürütün. Bölgesel sinyal: ${where} Test edilecek itici güç: ${topDriver}`,
        `Führen Sie einen begrenzten Pilotversuch durch, beschränkt auf das Mindestbudget zur Prüfung des Haupttreibers. Regionales Signal: ${where} Zu testender Haupttreiber: ${topDriver}`,
        `Menez un pilote limité, plafonné au budget minimal nécessaire pour tester le moteur principal. Signal régional : ${where} Moteur principal à tester : ${topDriver}`,
        `Ejecute un piloto acotado, limitado al gasto mínimo necesario para probar el motor principal. Señal regional: ${where} Motor principal a probar: ${topDriver}`
      ),
      marketText(
        language,
        `Set an explicit go/no-go checkpoint before any further commitment: continue only if "${primaryRisk}" measurably improves.`,
        `Daha fazla taahhütten önce açık bir devam/dur kontrol noktası belirleyin: yalnızca "${primaryRisk}" ölçülebilir şekilde iyileşirse ilerleyin.`,
        `Legen Sie vor jeder weiteren Verpflichtung einen expliziten Go/No-Go-Kontrollpunkt fest: nur fortsetzen, wenn sich „${primaryRisk}" messbar verbessert.`,
        `Fixez un point de contrôle explicite go/no-go avant tout engagement supplémentaire : poursuivez uniquement si « ${primaryRisk} » s'améliore de manière mesurable.`,
        `Establezca un punto de control explícito de continuar/no continuar antes de cualquier compromiso adicional: continúe solo si "${primaryRisk}" mejora de forma medible.`
      ),
      marketText(
        language,
        `Do not scale spend or team beyond the pilot until that checkpoint is passed.`,
        `Bu kontrol noktası geçilmeden bütçe veya ekibi pilot ötesine büyütmeyin.`,
        `Erhöhen Sie Budget oder Team nicht über den Pilotumfang hinaus, bevor dieser Kontrollpunkt erreicht ist.`,
        `N'augmentez pas le budget ni l'équipe au-delà du pilote avant d'avoir franchi ce point de contrôle.`,
        `No escale el gasto ni el equipo más allá del piloto hasta superar ese punto de control.`
      ),
    ];
  }

  return [
    marketText(
      language,
      `Do not commit entry, pilot, or expansion budget to this market at this time.`,
      `Bu pazara giriş, pilot veya genişleme bütçesi ayırmayın.`,
      `Verpflichten Sie derzeit kein Budget für Markteintritt, Pilotprojekt oder Expansion in diesem Markt.`,
      `N'engagez pas de budget d'entrée, de pilote ou d'expansion sur ce marché pour le moment.`,
      `No comprometa presupuesto de entrada, piloto o expansión en este mercado por ahora.`
    ),
    marketText(
      language,
      `Reassign the budget that would have funded entry to a market with stronger verified demand evidence.`,
      `Girişe ayrılacak bütçeyi, daha güçlü doğrulanmış talep kanıtına sahip bir pazara yönlendirin.`,
      `Weisen Sie das für den Markteintritt vorgesehene Budget einem Markt mit stärkeren verifizierten Nachfragenachweisen zu.`,
      `Réaffectez le budget destiné à l'entrée vers un marché disposant de preuves de demande vérifiées plus solides.`,
      `Reasigne el presupuesto destinado a la entrada a un mercado con evidencia de demanda verificada más sólida.`
    ),
    marketText(
      language,
      `Revisit this market only if "${primaryRisk}" is directly resolved with new, verified evidence.`,
      `Bu pazarı yalnızca "${primaryRisk}" doğrudan yeni ve doğrulanmış kanıtlarla çözülürse yeniden değerlendirin.`,
      `Betrachten Sie diesen Markt nur erneut, wenn „${primaryRisk}" durch neue, verifizierte Belege direkt gelöst wird.`,
      `Ne réexaminez ce marché que si « ${primaryRisk} » est directement résolu par de nouvelles preuves vérifiées.`,
      `Reconsidere este mercado solo si "${primaryRisk}" se resuelve directamente con evidencia nueva y verificada.`
    ),
  ];
}

// Named, concrete data gaps that could change the decision itself -- never
// a generic "more research is needed" caveat. Ranked weakest dimension
// first so the single most decision-relevant gap leads.
function identifyMarketInformationGaps(
  coverage: MarketResearchCoverage,
  language: ResponseLanguage
): string[] {
  const gaps: Array<{ weight: number; text: string }> = [];

  if (!coverage.verifiedMarketSizeAvailable) {
    gaps.push({
      weight: 0,
      text: marketText(
        language,
        "No verified, independently-sourced market-size figure (TAM/SAM/SOM or CAGR) was found -- the sizing in this report is a modeled estimate, not a confirmed fact.",
        "Doğrulanmış, bağımsız kaynaklı bir pazar büyüklüğü verisi (TAM/SAM/SOM veya CAGR) bulunamadı; bu rapordaki büyüklük tahmini modellenmiş bir tahmindir, doğrulanmış bir gerçek değildir.",
        "Es wurde keine verifizierte, unabhängig belegte Marktgrößenangabe (TAM/SAM/SOM oder CAGR) gefunden -- die Größenangabe in diesem Bericht ist eine modellierte Schätzung, keine bestätigte Tatsache.",
        "Aucun chiffre de taille de marché vérifié et issu de sources indépendantes (TAM/SAM/SOM ou TCAC) n'a été trouvé -- l'estimation de ce rapport est modélisée, non confirmée.",
        "No se encontró una cifra de tamaño de mercado verificada y de fuentes independientes (TAM/SAM/SOM o CAGR); la estimación de este informe es modelada, no un hecho confirmado."
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
        "Independent evidence of real product-market fit (customer usage, retention, or third-party reviews) is limited.",
        "Gerçek ürün-pazar uyumuna ilişkin bağımsız kanıt (müşteri kullanımı, elde tutma oranı veya üçüncü taraf incelemeleri) sınırlıdır.",
        "Unabhängige Belege für eine tatsächliche Produkt-Markt-Passung (Kundennutzung, Kundenbindung oder Bewertungen Dritter) sind begrenzt.",
        "Les preuves indépendantes d'une réelle adéquation produit-marché (utilisation client, rétention ou avis de tiers) sont limitées.",
        "La evidencia independiente de un ajuste real de producto-mercado (uso del cliente, retención o reseñas de terceros) es limitada."
      ),
    });
  }

  if (coverage.dimensions.marketConfidence < 50) {
    gaps.push({
      weight: coverage.dimensions.marketConfidence,
      text: marketText(
        language,
        "Overall market evidence coverage sits below the threshold for a high-confidence read -- targeted primary research (e.g. paid industry reports or direct customer interviews) would materially change this decision's confidence.",
        "Toplam pazar kanıt kapsamı, yüksek güvenli bir değerlendirme için gereken eşiğin altındadır; hedefe yönelik birincil araştırma (örn. ücretli sektör raporları veya doğrudan müşteri görüşmeleri) bu kararın güven düzeyini önemli ölçüde değiştirebilir.",
        "Die gesamte Marktevidenzabdeckung liegt unter dem Schwellenwert für eine belastbare Einschätzung -- gezielte Primärforschung (z. B. kostenpflichtige Branchenberichte oder direkte Kundeninterviews) würde die Konfidenz dieser Entscheidung wesentlich verändern.",
        "La couverture globale des preuves de marché est inférieure au seuil requis pour une lecture fiable -- une recherche primaire ciblée (rapports sectoriels payants ou entretiens clients directs) modifierait sensiblement la confiance de cette décision.",
        "La cobertura general de evidencia de mercado está por debajo del umbral necesario para una lectura de alta confianza; una investigación primaria específica (informes sectoriales de pago o entrevistas directas con clientes) cambiaría sustancialmente la confianza de esta decisión."
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

  // The single best opportunity/risk line becomes Biggest Opportunity;
  // any additional distinct sentences become the supporting reasons (Why)
  // so the two blocks never restate the same sentence.
  const primaryOpportunity = biggestOpportunity(sections, language);
  const primaryRisk = biggestRisk(sections, language);
  const additionalReasons = topSubstantiveLines(sections.opportunities || "", 3).filter(
    (line) => line !== primaryOpportunity
  );
  const additionalRisks = topSubstantiveLines(sections.threats || "", 3).filter(
    (line) => line !== primaryRisk
  );

  return {
    decision: code,
    confidence,
    // Never duplicate biggestOpportunity as a fallback reason: when the
    // evidence only supports one distinct opportunity sentence, the
    // structural market driver is a genuinely separate fact instead of a
    // repeated one.
    topReasons: additionalReasons.length ? additionalReasons : [topMarketDriver(sections, language)],
    topRisks: [primaryRisk, ...additionalRisks].slice(0, 3),
    biggestOpportunity: primaryOpportunity,
    missingInformation: identifyMarketInformationGaps(coverage, language),
    first90Days: buildDecisionConditionedFirst90Days(code, sections, language, primaryRisk),
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
  const localizedDecision = localizeExecutiveDecision(brief.decision, language);
  const heading = marketText(
    language,
    "Final Investment Decision",
    "Nihai Yatırım Kararı",
    "Endgültige Investitionsentscheidung",
    "Décision d'investissement finale",
    "Decisión de inversión final"
  );

  // biggestOpportunity/topRisks[0] can be a full sentence from the
  // report's own prose -- quoted as a clause here (never used as a bare
  // grammatical subject), so the paragraph stays valid regardless of the
  // extracted sentence's own internal punctuation.
  const opportunityClause = brief.biggestOpportunity.trim().replace(/[.!?]+$/, "");
  const primaryRiskClause = (brief.topRisks[0] || "").trim().replace(/[.!?]+$/, "");

  const paragraph =
    brief.decision === "GO"
      ? marketText(
          language,
          `The verdict is ${localizedDecision} at ${brief.confidence}% confidence. The deciding factor -- "${opportunityClause}" -- outweighs the identified risks, and the First 90-Day Action Plan above is the fastest safe path to capturing it, so entry should proceed on that basis.`,
          `Karar %${brief.confidence} güvenle ${localizedDecision}: belirleyici unsur -- "${opportunityClause}" -- belirlenen risklerden daha ağır basmaktadır ve yukarıdaki İlk 90 Günlük Aksiyon Planı bunu yakalamak için en hızlı güvenli yoldur; bu nedenle girişin bu temelde ilerlemesi gerekir.`,
          `Das Urteil lautet mit ${brief.confidence}% Konfidenz ${localizedDecision}. Der entscheidende Faktor -- „${opportunityClause}" -- überwiegt die identifizierten Risiken, und der obige Aktionsplan für die ersten 90 Tage ist der schnellste sichere Weg, sie zu nutzen, daher sollte der Markteintritt auf dieser Grundlage erfolgen.`,
          `Le verdict est ${localizedDecision} avec ${brief.confidence}% de confiance. Le facteur déterminant -- « ${opportunityClause} » -- l'emporte sur les risques identifiés, et le plan d'action des 90 premiers jours ci-dessus est la voie sûre la plus rapide pour la saisir, donc l'entrée doit se poursuivre sur cette base.`,
          `El veredicto es ${localizedDecision} con un ${brief.confidence}% de confianza. El factor decisivo -- "${opportunityClause}" -- supera a los riesgos identificados, y el Plan de Acción de los Primeros 90 Días anterior es la vía segura más rápida para capturarla, por lo que la entrada debe proceder sobre esta base.`
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
            `The verdict is ${localizedDecision} at ${brief.confidence}% confidence. The deciding factor -- "${primaryRiskClause}" -- outweighs the identified opportunity today, so no entry, pilot, or expansion budget should be committed to this market until that specific gap is resolved with new, verified evidence.`,
            `Karar %${brief.confidence} güvenle ${localizedDecision}: belirleyici unsur -- "${primaryRiskClause}" -- bugün belirlenen fırsattan daha ağır basmaktadır; bu nedenle bu belirli boşluk yeni ve doğrulanmış kanıtlarla çözülene kadar bu pazara giriş, pilot veya genişleme bütçesi ayrılmamalıdır.`,
            `Das Urteil lautet mit ${brief.confidence}% Konfidenz ${localizedDecision}. Der entscheidende Faktor -- „${primaryRiskClause}" -- überwiegt die identifizierte Chance derzeit, daher sollte kein Budget für Markteintritt, Pilotprojekt oder Expansion in diesem Markt gebunden werden, bis diese spezifische Lücke durch neue, verifizierte Belege geschlossen ist.`,
            `Le verdict est ${localizedDecision} avec ${brief.confidence}% de confiance. Le facteur déterminant -- « ${primaryRiskClause} » -- l'emporte aujourd'hui sur l'opportunité identifiée, donc aucun budget d'entrée, de pilote ou d'expansion ne doit être engagé sur ce marché jusqu'à ce que cette lacune précise soit résolue par de nouvelles preuves vérifiées.`,
            `El veredicto es ${localizedDecision} con un ${brief.confidence}% de confianza. El factor decisivo -- "${primaryRiskClause}" -- supera hoy a la oportunidad identificada, por lo que no debe comprometerse presupuesto de entrada, piloto o expansión en este mercado hasta que esa brecha específica se resuelva con evidencia nueva y verificada.`
          );

  return [heading, "", paragraph].join("\n");
}
