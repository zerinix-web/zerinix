import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  assessLegalResearchCoverage,
  prepareLegalDecisionReport,
} from "../app/lib/report-engine/legal-report-quality.ts";
import {
  buildLegalReportSections,
  formatLegalSourceContent,
  isLegalRenderableReport,
} from "../app/lib/report-engine/legal-report-rendering.ts";

const fields = [
  "subjectIdentification",
  "extractedFacts",
  "externalEvidence",
  "domainFindings",
  "regulatoryCompliance",
  "financialImplications",
  "operationalImplications",
  "riskAnalysis",
  "scenarioAnalysis",
  "decisionAssessment",
  "missingInformation",
  "recommendedActions",
  "finalRecommendation",
  "sources",
];

function pollutedReport() {
  return Object.fromEntries(
    fields.map((field) => [
      field,
      "[Recommendation] [Basis:R1] [Unknown] [Required:governing_law] [Verified from official source] compliance market_standard R1 provider registry timeout debug",
    ])
  );
}

function evidence(field, claim, index) {
  const urls = {
    1: "https://www.mevzuat.gov.tr/mevzuatmetin/1.5.4857.pdf",
    2: "https://www.resmigazete.gov.tr/eskiler/2003/06/20030610.htm",
    3: "https://karararama.yargitay.gov.tr/karar/notice-pay-2026",
    4: "https://www.csgb.gov.tr/arabuluculuk/is-uyusmazliklari",
    5: "https://karararama.yargitay.gov.tr/karar/zamanasimi-2026",
  };
  return {
    id: `R${index}`,
    field,
    claim,
    value: claim,
    label: "Verified from official source",
    sourceTitle: `Resmî hukuk kaynağı ${index}`,
    publisher: "Adalet Bakanlığı",
    url: urls[index] || `https://www.adalet.gov.tr/mevzuat/${index}`,
    sourceType: "official",
    authorityLevel: "primary",
    confidence: 90,
    publishedDate: "",
    lastChecked: "2026-07-31",
    supportingData: [claim],
    impact: "neutral",
    impactReason: "",
  };
}

function bundle({ facts = [], conflicts = [] } = {}) {
  const externalEvidence = [
    evidence("wages", "İş Kanunu kapsamında ücret ve fazla mesai alacağı kuralları", 1),
    evidence("severance", "Kıdem tazminatı için çalışma süresi ve fesih şartları", 2),
    evidence("notice", "İhbar tazminatı ve bildirim süresi şartları", 3),
    evidence("mediation", "İş uyuşmazlıklarında zorunlu arabuluculuk kuralı", 4),
    evidence("limitation", "İşçilik alacakları için zamanaşımı süreleri", 5),
  ];

  return {
    domain: "legal",
    decisionType: "risk_review",
    identifiers: [],
    plan: [],
    evidence: externalEvidence,
    attemptedFields: [],
    unresolvedFields: [],
    researchAttempted: true,
    researchCompleted: true,
    requiredResearchCompletion: 100,
    recommendedOutput: "preliminary_report",
    summary: "",
    providerResponseId: "fixture",
    fallbackUsed: false,
    failurePhase: "",
    failureReason: "",
    timings: {
      entityExtractionMs: 0,
      researchPlanningMs: 0,
      researchExecutionMs: 0,
    },
    decisionIntelligence: {
      version: "decision_intelligence_v1",
      intent: { primary: "legal", secondary: [], confidence: 100, rationale: [] },
      domain: "legal",
      domainProfile: {},
      extractedFacts: facts,
      researchPlan: [],
      evidenceValidation: {
        evidence: [],
        conflicts,
        corroboratedFields: [],
        unresolvedFields: [],
        coverage: 0,
        confidence: 0,
      },
      decision: {
        finalDecision: "WAIT",
        recommendation: "Wait",
        confidence: 0,
        topReasons: [],
        decisionChangingEvidence: "",
        conflictExplanation: "",
        scores: [],
        opportunities: [],
        risks: [],
        contradictions: [],
        unknowns: [],
        rationale: [],
        nextActions: [],
      },
      outputMode: "preliminary_report",
    },
  };
}

const employmentPrompt =
  "İşverenim üç aylık ücretimi ödemedi ve beni işten çıkardı. Kıdem ve ihbar tazminatı talep edebilir miyim?";
const failedLegalQuery =
  "Türkiye’de bir işyerinde 6 yıl çalıştım. İşveren beni “performans düşüklüğü” gerekçesiyle işten çıkardı ancak daha önce bana yazılı savunma talebi, performans uyarısı veya iyileştirme planı verilmedi. Son 2 aylık maaşım, kullanılmayan yıllık izin ücretim ve kıdem tazminatım da ödenmedi. Elimde iş sözleşmesi, SGK hizmet dökümü, banka kayıtları, işten çıkarma bildirimi ve işverenle yaptığım WhatsApp yazışmaları var. İşveren performansımın düşük olduğunu söylüyor ancak buna ilişkin imzalı değerlendirme belgesi göstermiyor. Türkiye hukuku açısından işe iade davası açabilir miyim, hangi alacakları talep edebilirim, delillerimin gücü nedir, hangi süreleri kaçırmamam gerekir, dava öncesi zorunlu arabuluculuk nasıl işler ve ZERINIX’in net tavsiyesi nedir?";

test("employment dispute reasons from user claims without treating an unparsed upload as verified", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [
      {
        name: "dilekce.pdf",
        type: "application/pdf",
        size: 123,
        textContent: "",
        dataUrl: "data:application/pdf;base64,AA==",
      },
    ],
    prompt: employmentPrompt,
    language: "Turkish",
  });
  const output = Object.values(report).join("\n");

  assert.match(
    report.finalRecommendation,
    /^Nihai tavsiye: (?:MUHTEMEL|BELİRSİZ)/
  );
  assert.match(report.extractedFacts, /Beyan edilen olgular \(bağımsız doğrulama yapılmadı\)/);
  assert.doesNotMatch(report.extractedFacts, /olay olgusu ayrıştırılmadı/i);
  assert.doesNotMatch(output, /\[(?:Recommendation|Basis|Unknown|Required|Verified)/i);
  assert.doesNotMatch(
    output,
    /\b(?:governing_law|compliance|market_standard|provider|registry|debug|R\d+)\b/i
  );
});

test("employment report evaluates every required claim issue separately", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt: employmentPrompt,
    language: "Turkish",
  });

  const combinedFindings = [
    report.domainFindings,
    report.regulatoryCompliance,
    report.financialImplications,
    report.operationalImplications,
    report.riskAnalysis,
  ].join("\n");
  for (const heading of [
    "Ödenmeyen ücretler",
    "Kıdem tazminatı",
    "İhbar tazminatı",
    "Kullanılmayan yıllık izin",
    "İşe iade",
    "Feshin geçerliliği",
    "Zorunlu arabuluculuk",
    "Zamanaşımı",
  ]) {
    assert.match(combinedFindings, new RegExp(heading));
  }
  assert.match(report.operationalImplications, /İşveren savunmaları/);
  assert.match(report.operationalImplications, /Dosya stratejisi/);
});

test("legal recommendation is concise, confidence is explained once, and actions appear once", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle({
      conflicts: [
        {
          field: "limitation",
          evidenceIds: ["R1", "R2"],
          values: ["A", "B"],
          explanation: "İki güvenilir kaynak farklı süre belirtiyor.",
          severity: "high",
        },
      ],
    }),
    assets: [],
    prompt: employmentPrompt,
    language: "Turkish",
  });

  assert.match(report.finalRecommendation, /^Nihai tavsiye: /);
  assert.equal(report.recommendedActions.match(/^\d+\./gm)?.length, 3);
  assert.doesNotMatch(report.finalRecommendation, /Olasılık|Kritik eksik|Hemen atılacak/);
  assert.doesNotMatch(report.scenarioAnalysis, /Olasılık|Güven:/);
  assert.match(report.decisionAssessment, /5 kritik olay grubundan \d/);
  assert.match(report.decisionAssessment, /8 hukuk başlığından \d/);
  assert.match(report.riskAnalysis, /kaynaklar arasında çelişki/i);
});

test("verified material adverse file evidence derives LOW PROBABILITY", () => {
  const adverseFact = {
    field: "release",
    value: "Geçerli ibraname ve tam ödeme kaydı",
    source: "release.pdf",
    category: "Verified Asset",
    confidence: 95,
    verified: true,
    estimated: false,
    missing: false,
  };
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle({ facts: [adverseFact] }),
    assets: [
      { name: "release.pdf", type: "application/pdf", size: 1, textContent: "text", dataUrl: "" },
    ],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.match(
    report.finalRecommendation,
    /^Final recommendation: LOW PROBABILITY/
  );
});

test("irrelevant and malformed external sources never reach the legal report", () => {
  const research = bundle();
  research.evidence.push(
    { ...evidence("market_standard", "General business market page", 6), url: "https://example.com" },
    { ...evidence("wages", "Employment wage rule", 7), url: "belge" }
  );
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "Turkish",
  });

  assert.doesNotMatch(
    Object.values(report).join("\n"),
    /example\.com|URL:\s*belge|market_standard/i
  );
});

test("sources include real URL, institution, and access date", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt: employmentPrompt,
    language: "Turkish",
  });

  assert.match(report.sources, /Yayınlayan: Adalet Bakanlığı/);
  assert.match(report.sources, /Resmî başlık: Resmî hukuk kaynağı 1/);
  assert.match(report.sources, /URL: https:\/\//);
  assert.match(report.sources, /Erişim tarihi: 2026-07-31/);
  assert.match(report.sources, /Güvenilirlik: Yüksek — resmî birincil kaynak/);
  assert.match(report.sources, /Metodoloji/);
  assert.doesNotMatch(
    Object.values(report).join("\n"),
    /kanıt bulunamadı|pazar karşılaştırmaları|market comparisons/i
  );
});

test("legal evidence gate emits source classification and exact coverage diagnostics", () => {
  const logs = [];
  const originalInfo = console.info;
  const originalDiagnostics = process.env.LEGAL_RESEARCH_DIAGNOSTICS;
  process.env.LEGAL_RESEARCH_DIAGNOSTICS = "true";
  console.info = (...args) => logs.push(args);
  try {
    assessLegalResearchCoverage(bundle().evidence, "Turkish", {
      traceId: "legal-regression-trace",
      originalQuery: failedLegalQuery,
    });
  } finally {
    console.info = originalInfo;
    if (originalDiagnostics === undefined) {
      delete process.env.LEGAL_RESEARCH_DIAGNOSTICS;
    } else {
      process.env.LEGAL_RESEARCH_DIAGNOSTICS = originalDiagnostics;
    }
  }

  const events = logs.map(([event]) => String(event));
  assert.ok(events.includes("[legal-research-diagnostic] coverage-input"));
  assert.ok(events.includes("[legal-research-diagnostic] source-classification"));
  assert.ok(events.includes("[legal-research-diagnostic] coverage-decision"));
  const coverage = logs.find(
    ([event]) => event === "[legal-research-diagnostic] coverage-decision"
  )?.[1];
  assert.equal(coverage.originalUserQuery, failedLegalQuery);
  assert.equal(coverage.hasLegislation, true);
  assert.equal(coverage.hasCaseLaw, true);
  assert.equal(coverage.gracefulDegradationCondition, "!hasLegislation || !hasCaseLaw");
  assert.equal(coverage.blocksReportGeneration, false);
  const researchSource = readFileSync(
    new URL("../app/lib/ai/domain-research.ts", import.meta.url),
    "utf8"
  );
  for (const marker of [
    "legal-pipeline-original-query",
    "legal-pipeline-generated-queries",
    "legal-pipeline-provider-called",
    "legal-pipeline-raw-provider-result",
    "legal-pipeline-provider-skipped",
    "legal-pipeline-evidence-passed",
  ]) {
    assert.match(researchSource, new RegExp(marker));
  }
});

test("verified parsed facts increase probability without changing evidence provenance", () => {
  const facts = [
    ["employment", "İşçi ve işveren arasındaki iş sözleşmesi", "contract.pdf"],
    ["service", "İşe giriş tarihi ve çalışma süresi", "contract.pdf"],
    ["termination", "İşveren fesih bildirimi", "termination.pdf"],
    ["payment", "Bordro ve banka ödeme kayıtları", "payroll.pdf"],
    ["dates", "Talep tarihi 01.06.2026", "termination.pdf"],
  ].map(([field, value, source]) => ({
    field,
    value,
    source,
    category: "Verified Asset",
    confidence: 90,
    verified: true,
    estimated: false,
    missing: false,
  }));
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle({ facts }),
    assets: [
      { name: "contract.pdf", type: "application/pdf", size: 1, textContent: "text", dataUrl: "" },
      { name: "termination.pdf", type: "application/pdf", size: 1, textContent: "text", dataUrl: "" },
      { name: "payroll.pdf", type: "application/pdf", size: 1, textContent: "text", dataUrl: "" },
    ],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.match(
    report.finalRecommendation,
    /^Final recommendation: (?:LIKELY|HIGH PROBABILITY)/
  );
  assert.doesNotMatch(
    Object.values(report).join("\n"),
    /\b(?:En olası hukuki sonuç|Alternatif sonuç|Olasılık|Kritik eksik kanıt|Hemen atılacak adımlar)\b/
  );
});

test("detailed user allegations produce conditional legal reasoning instead of WAIT", () => {
  const prompt = [
    "6 yıl çalıştım.",
    "İşverenim beni düşük performans gerekçesiyle işten çıkardı.",
    "Yazılı uyarı verilmedi, savunmam alınmadı.",
    "Performans geliştirme planı ve objektif değerlendirme yapılmadı.",
    "Maaşım ödenmedi ve kullanılmayan yıllık iznim var.",
  ].join(" ");
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt,
    language: "Turkish",
  });

  assert.match(report.finalRecommendation, /^Nihai tavsiye: MUHTEMEL/);
  assert.doesNotMatch(report.finalRecommendation, /\bBEKLE\b/);
  assert.match(report.domainFindings, /Feshin geçerliliği/);
  assert.match(report.subjectIdentification, /Kullanıcının anlatımı doğruysa/i);
  assert.match(report.decisionAssessment, /Olasılık: %\d+/);
  assert.match(report.decisionAssessment, /Güven: %\d+/);
});

test("no official evidence produces a preliminary report without fabricated sources", () => {
  const research = bundle();
  research.evidence = [];
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.match(report.subjectIdentification, /^Official sources could not be fully verified\./);
  assert.match(report.finalRecommendation, /^Final recommendation:/);
  assert.match(report.sources, /No publishable external source was used/);
  assert.match(report.sources, /Methodology/);
  assert.doesNotMatch(report.sources, /https?:\/\//);
});

test("legislation without case law still produces a preliminary report", () => {
  const research = bundle();
  research.evidence = research.evidence.filter(
    (item) => !/yargitay|karar/i.test(item.url)
  );
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.match(report.subjectIdentification, /^Official sources could not be fully verified\./);
  assert.match(report.sources, /https:\/\/www\.mevzuat\.gov\.tr/);
  assert.doesNotMatch(report.sources, /yargitay/i);
});

test("provider timeout still produces a preliminary report", () => {
  const research = bundle();
  research.evidence = [];
  research.researchCompleted = false;
  research.failurePhase = "Research Execution";
  research.failureReason = "provider timed out";
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.match(report.subjectIdentification, /^Official sources could not be fully verified\./);
  assert.doesNotMatch(Object.values(report).join("\n"), /provider timed out/i);
});

test("complete official evidence produces a verified report without preliminary warning", () => {
  const research = bundle();
  research.evidence = [
    {
      ...evidence("wages", "Employment Rights Act wage protection rule", 1),
      sourceTitle: "Employment Rights Act 1996",
      publisher: "UK Parliament",
      url: "https://www.legislation.gov.uk/ukpga/1996/18/section/13",
    },
    {
      ...evidence(
        "dismissalProcedure",
        "Supreme Court judgment on employment dismissal procedure and written warning",
        5
      ),
      sourceTitle: "Supreme Court employment judgment",
      publisher: "UK Supreme Court",
      url: "https://www.supremecourt.uk/cases/uksc-2025-001",
    },
  ];
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.doesNotMatch(report.finalRecommendation, /Official sources could not be fully verified/);
  assert.match(report.sources, /https:\/\/www\.legislation\.gov\.uk/);
  assert.match(report.sources, /https:\/\/www\.supremecourt\.uk/);
});

test("legal cleanup removes business and runtime artifacts", () => {
  const raw = pollutedReport();
  raw.domainFindings = [
    "Contract interpretation requires evidence.",
    "CAC: 120",
    "Market intelligence: growth",
    "Product strategy: launch",
    "Request was aborted",
    "Provider unavailable",
  ].join("\n");
  const research = bundle();
  const report = prepareLegalDecisionReport({
    report: raw,
    research,
    assets: [],
    prompt: "Review this commercial contract",
    language: "English",
  });

  assert.match(report.domainFindings, /Contract interpretation/);
  assert.doesNotMatch(
    Object.values(report).join("\n"),
    /\bCAC\b|market intelligence|product strategy|request was aborted|provider unavailable/i
  );
});

test("normal, cached, and timeout paths all apply legal quality preparation", () => {
  const source = readFileSync(
    new URL("../app/lib/report-jobs/plan-executor.ts", import.meta.url),
    "utf8"
  );
  assert.ok((source.match(/prepareLegalDecisionReport\(/g) || []).length >= 3);
  assert.match(
    source,
    /createGroundedDomainTimeoutFallback[\s\S]*domain === "legal"[\s\S]*prepareLegalDecisionReport/
  );
  assert.match(
    source,
    /domain === "legal"[\s\S]*assessLegalResearchCoverage\(domainResearch\.evidence/
  );
});

test("preliminary warning, confidence, missing evidence, and actions each have one owner", () => {
  const research = bundle();
  research.evidence = [];
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });
  const output = Object.values(report).join("\n");
  const warning =
    "Official sources could not be fully verified. This analysis is preliminary and should not replace professional advice.";

  assert.equal(output.split(warning).length - 1, 1);
  assert.equal(output.match(/Confidence: \d+%/g)?.length, 1);
  assert.equal(report.recommendedActions.match(/^\d+\./gm)?.length, 3);
  assert.doesNotMatch(report.finalRecommendation, /^\d+\./m);
  for (const action of report.recommendedActions.split("\n")) {
    assert.equal(output.split(action).length - 1, 1);
  }
});

test("source writer hides absent metadata and never emits placeholder fields", () => {
  const research = bundle();
  research.evidence = [
    {
      ...evidence("wages", "Employment wage law and salary payment protection", 8),
      sourceTitle: "",
      publisher: "",
      url: "https://law.example.org/statutes/employment-wages",
    },
  ];
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research,
    assets: [],
    prompt: employmentPrompt,
    language: "English",
  });

  assert.doesNotMatch(report.sources, /Official title:\s*(?:\n|$)/);
  assert.doesNotMatch(report.sources, /Publisher:\s*(?:\n|$)/);
  assert.doesNotMatch(report.sources, /Not provided|Validation required|Unknown|title\./i);
  assert.match(report.sources, /URL: https:\/\/law\.example\.org\/statutes\/employment-wages/);
  assert.match(report.sources, /Reliability:/);
});

test("complete employment statement retains every supplied fact and document as user-reported", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt: failedLegalQuery,
    language: "Turkish",
  });
  const facts = report.extractedFacts;

  for (const expected of [
    "6 yıllık çalışma ilişkisi",
    "Performans gerekçeli fesih",
    "Yazılı uyarı verilmemesi",
    "Savunma istenmemesi",
    "Performans geliştirme planı uygulanmaması",
    "Son 2 aylık ücretin ödenmediği beyanı",
    "Kullanılmayan yıllık izin",
    "İşveren tarafından fesih",
    "İş sözleşmesinin mevcut olduğu belirtiliyor",
    "SGK/hizmet kayıtlarının mevcut olduğu belirtiliyor",
    "Banka kayıtlarının mevcut olduğu belirtiliyor",
    "Fesih bildiriminin mevcut olduğu belirtiliyor",
    "İşverenle yazışmaların mevcut olduğu belirtiliyor",
  ]) {
    assert.match(facts, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(report.domainFindings, /işverenin performans feshi savunmasını zayıflatabilir/i);
  assert.match(report.financialImplications, /ayrı bir alacak talebini destekler/i);
  assert.doesNotMatch(
    Object.values(report).join("\n"),
    /Mevcut olay anlatımı bu başlıkta yön belirlemek için yeterli ayrıntı içermiyor|Uygulanabilir kural resmî kaynakla desteklendiği için hukuki çerçeve daha güçlüdür/g
  );
});

test("legal renderer exposes only the legal section architecture and omits business artifacts", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt: failedLegalQuery,
    language: "Turkish",
  });
  const sections = fields.map((field) => ({
    field,
    title: field,
    content: report[field],
  }));
  const dashboardReport = {
    type: "Strategic Report",
    title: "Stratejik Analiz",
    prompt: failedLegalQuery,
    sections,
  };
  assert.equal(isLegalRenderableReport(dashboardReport), true);
  const rendered = buildLegalReportSections(sections, "tr");

  assert.deepEqual(rendered.map((section) => section.title), [
    "Yönetici Hukuki Değerlendirmesi",
    "Maddi Olgular",
    "Talep Bazlı Analiz",
    "Kanıt Değerlendirmesi",
    "Usul ve Süre Riskleri",
    "İşverenin Olası Savunmaları",
    "Eksik Kanıtlar",
    "Hemen Atılacak Üç Adım",
    "Nihai Tavsiye",
    "Doğrulanmış Kaynaklar",
    "Hukuki Metodoloji ve Sınırlamalar",
  ]);
  assert.ok(rendered.every((section) => section.content.trim()));
  assert.match(
    rendered.find((section) => section.field === "legalMaterialFacts")?.content || "",
    /Beyan edilen olgular \(bağımsız doğrulama yapılmadı\)/
  );
  assert.doesNotMatch(
    rendered.map((section) => section.content).join("\n"),
    /Investor Ready|Strategy Model|Customer validation|\bCAC\b|Capital efficiency|Competition|Market|Product|startup KPI/i
  );
});

test("legal source rendering omits unusable and placeholder records", () => {
  const content = [
    "• Resmî başlık: İş Kanunu",
    "  Yayınlayan: Resmî Mevzuat Kurumu",
    "  URL: https://law.example.gov/statutes/employment",
    "  Erişim tarihi: 2026-07-31",
    "  Kaynak türü: Resmî birincil hukuk kaynağı",
    "",
    "• Resmî başlık: Validation Required",
    "  Yayınlayan: Not provided",
    "  URL: Not provided",
    "  Erişim tarihi: erişim.tarihi.2026",
    "  Kaynak türü: güvenilirlik.yüksek",
  ].join("\n");
  const rendered = formatLegalSourceContent(content, "tr");

  assert.match(rendered, /İş Kanunu/);
  assert.match(rendered, /Resmî Mevzuat Kurumu/);
  assert.match(rendered, /https:\/\/law\.example\.gov\/statutes\/employment/);
  assert.match(rendered, /Kaynak türü: Resmî birincil hukuk kaynağı/);
  assert.doesNotMatch(
    rendered,
    /Not provided|Validation Required|erişim\.tarihi|güvenilirlik\.yüksek|resm\.başlık/i
  );
});

test("final legal recommendation is directional and actions remain exactly three", () => {
  const report = prepareLegalDecisionReport({
    report: pollutedReport(),
    research: bundle(),
    assets: [],
    prompt: failedLegalQuery,
    language: "Turkish",
  });

  assert.match(report.finalRecommendation, /^Nihai tavsiye: (?:YÜKSEK OLASILIK|MUHTEMEL|BELİRSİZ|DÜŞÜK OLASILIK|BEKLE)/);
  assert.match(report.finalRecommendation, /en güçlü potansiyel talep/i);
  assert.match(report.finalRecommendation, /başvuru süreleri derhâl teyit edilmelidir/i);
  assert.match(report.finalRecommendation, /tersine çevirebilir/i);
  assert.equal(report.recommendedActions.match(/^\d+\./gm)?.length, 3);
});
