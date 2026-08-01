const employmentSignal = /\b(?:employment|employee|employer|termination|dismissal|overtime|severance|wage|salary|retaliation|işçi|işveren|fesih|fazla mesai|kıdem|ücret|maaş)\b/i;

const issue = (id, label, queryTerms, preferredSources, priority, signal, alwaysForEmployment = false) => ({
  id,
  label,
  queryTerms,
  preferredSources,
  priority,
  signal,
  alwaysForEmployment,
});

const legalIssueDefinitions = [
  issue("legal_overtime", "unpaid overtime", "overtime rules unpaid overtime wage claim", ["official legislation database", "official labor agency", "official regulator"], "critical", /\b(?:unpaid overtime|overtime compensation|fazla mesai|fazla çalışma)\b/i),
  issue("legal_exempt_status", "exempt-status classification", "exempt employee classification duties salary tests misclassification", ["official labor agency", "official regulation", "official legislation database"], "critical", /\b(?:classified (?:me )?as exempt|exempt classification|misclassif|muaf çalışan|istisna kapsam)\b/i),
  issue("legal_retaliation", "retaliation after wage complaint", "retaliation wage complaint protected activity termination", ["official labor agency", "official legislation database", "official court"], "critical", /\b(?:retaliat|after reporting|after complain|şikayet.{0,60}(?:sonra|ardından)|misilleme)\b/i),
  issue("legal_severance_enforceability", "severance agreement enforceability", "severance agreement enforceability employee release consideration revocation", ["official legislation database", "official regulator", "official court"], "critical", /\b(?:severance agreement|settlement agreement|release agreement|ibraname|ikale|sulh sözleşmesi)\b/i),
  issue("legal_claim_waiver", "waiver of employment claims", "waiver release of employment claims validity knowing voluntary nonwaivable claims", ["official legislation database", "official regulator", "official court"], "critical", /\b(?:waiv(?:e|ed|er)|release of claims|feragat|ibra)\b/i),
  issue("legal_final_pay", "final-pay obligations and penalties", "final pay termination unpaid wages penalties payment deadline", ["official labor agency", "official legislation database", "official regulation"], "critical", /\b(?:final pay|final salary|unpaid wage|unpaid salary|son ücret|ödenmeyen ücret|ödenmemiş maaş)\b/i, true),
  issue("legal_filing_routes", "agency and court filing routes", "employment claim agency complaint filing route court jurisdiction", ["official labor agency", "official court", "official regulator"], "high", /\b(?:filing|file a claim|agency|complaint|başvuru|dava|şikayet)\b/i, true),
  issue("legal_limitation_deadlines", "filing deadlines and limitation periods", "statute of limitations filing deadline employment wage retaliation release challenge", ["official legislation database", "official court", "official agency guidance"], "critical", /\b(?:deadline|limitation|within the next|time limit|zamanaşımı|hak düşürücü|süre)\b/i, true),
  issue("legal_evidence_preservation", "evidence preservation", "employment evidence preservation payroll time records personnel file litigation hold", ["official court", "official labor agency", "official civil procedure rules"], "high", /\b(?:evidence|records|documents|preserv|kanıt|delil|belge|kayıt)\b/i, true),
  issue("legal_case_law", "relevant case law", "official court decision case law employment overtime retaliation severance waiver", ["official court", "recognized primary legal repository"], "high", /\b(?:case law|court decision|precedent|içtihat|mahkeme kararı|emsal karar)\b/i, true),
];

function extractMatch(prompt, pattern) {
  return prompt.match(pattern)?.[1]?.trim() || "";
}

function collectUserFacts(prompt) {
  const facts = [];
  const add = (field, value) => {
    if (value && !facts.some((fact) => fact.field === field && fact.value === value)) facts.push({ field, value });
  };
  add("employment_duration", extractMatch(prompt, /\b((?:\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s*(?:years?|yıl|sene))\b/i));
  add("weekly_hours", extractMatch(prompt, /\b(\d+\s*[–-]\s*\d+\s*hours?(?:\s+per\s+week)?|haftada\s+\d+\s*[–-]\s*\d+\s*saat)\b/i));
  add("decision_deadline", extractMatch(prompt, /\b((?:next|within)\s+\d+\s+days?|önümüzdeki\s+\d+\s+gün)\b/i));
  add("severance_timing", extractMatch(prompt, /\b(\d+\s+days?\s+after\s+termination|fesih(?:ten)?\s+\d+\s+gün\s+sonra)\b/i));
  if (/\bsoftware company\b/i.test(prompt)) add("employer_industry", "software company");
  if (/\bterminated without prior warning\b/i.test(prompt)) add("termination_notice", "terminated without prior warning");
  if (/\bafter reporting repeated unpaid overtime\b/i.test(prompt)) add("retaliation_timing", "termination after reporting repeated unpaid overtime");
  if (/\bclassified (?:me )?as exempt\b/i.test(prompt)) add("employment_classification", "classified as exempt");
  if (/\bwithout overtime compensation\b/i.test(prompt)) add("overtime_compensation", "no overtime compensation");
  if (/\bsigned a severance agreement\b/i.test(prompt)) add("severance_agreement", "severance agreement signed");
  if (/\bwaived certain legal claims\b/i.test(prompt)) add("claim_waiver", "waiver of certain legal claims");
  return facts;
}

export function extractLegalResearchContext(prompt) {
  const isCalifornia = /\bCalifornia\b/i.test(prompt);
  const country = isCalifornia ? "United States" : extractMatch(prompt, /\b(?:country|ülke)\s*[:\-]\s*([^\n,;.]+)/i);
  const region = isCalifornia ? "California" : extractMatch(prompt, /\b(?:state|province|region|eyalet|bölge|il)\s*[:\-]\s*([^\n,;.]+)/i);
  const jurisdiction = [region, country].filter(Boolean).join(", ") || extractMatch(prompt, /\b(?:jurisdiction|governing law|yetkili hukuk|uygulanacak hukuk)\s*[:\-]\s*([^\n;.]+)/i);
  const isEmployment = employmentSignal.test(prompt);
  const issues = legalIssueDefinitions
    .filter(({ signal, alwaysForEmployment }) => signal.test(prompt) || (isEmployment && alwaysForEmployment))
    .map(({ id, label, queryTerms, preferredSources, priority }) => ({ id, label, queryTerms, preferredSources, priority }));
  const requestedDecision = /\bwhat (?:employment )?claims|legal options|what.*should i (?:do|take)|hangi hak|ne yapmalıyım/i.test(prompt)
    ? "Assess viable claims, deadlines, evidence, and immediate actions"
    : "Assess legal position and decision options";
  const urgency = extractMatch(prompt, /\b((?:next|within)\s+\d+\s+days?|önümüzdeki\s+\d+\s+gün)\b/i) || (/\bdeadline|limitation|urgent|acil|süre\b/i.test(prompt) ? "Deadline-sensitive" : "Not stated");
  return { country, region, jurisdiction, legalDomain: isEmployment ? "employment law" : "legal", issues, userFacts: collectUserFacts(prompt), requestedDecision, urgency };
}
