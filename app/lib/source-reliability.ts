export type SourceReliabilityCategory =
  | "Official"
  | "Government"
  | "Academic"
  | "Industry"
  | "News"
  | "Community"
  | "AI Generated"
  | "Unknown";

export type SourceReliabilitySummary = {
  source_count: number;
  average_source_score: number;
  lowest_source_score: number;
  highest_source_score: number;
  source_distribution: Record<SourceReliabilityCategory, number>;
};

type SourceCandidate = {
  text: string;
  url: string;
};

const categories: SourceReliabilityCategory[] = [
  "Official",
  "Government",
  "Academic",
  "Industry",
  "News",
  "Community",
  "AI Generated",
  "Unknown",
];

const trustedIndustryPublishers =
  /\b(statista|mckinsey|bcg|deloitte|pwc|ey|kpmg|gartner|forrester|cb insights|pitchbook|crunchbase|euromonitor|nielsen|idc|gsma)\b/i;
const governmentPublishers =
  /\b(world bank|imf|oecd|eurostat|tüik|tuik|tcmb|fed|federal reserve|sec|gov\.uk|data\.gov|united nations|un\b|commerce department|ministry|world health organization)\b/i;
// Checked separately, case-sensitively: the bare word "who" is common
// English (interrogative/relative pronoun) and false-positives as a
// government source ("Who Eats by ATX Is For") when matched case-
// insensitively. Only the literal acronym "WHO" is a real signal.
const worldHealthOrganizationAcronym = /\bWHO\b/;
const academicPublishers =
  /\b(university|journal|research institute|arxiv|ssrn|springer|elsevier|jstor|nature|science|edu\b)\b/i;
const officialSignals = /\b(official|company website|annual report|investor relations|10-k|form 10-k|sec filing)\b/i;
const newsPublishers =
  /\b(reuters|bloomberg|financial times|wall street journal|wsj|economist|techcrunch|forbes|business insider|cnbc|bbc|guardian|nyt|new york times)\b/i;
const communitySignals = /\b(reddit|quora|medium|substack|forum|discord|telegram|x\.com|twitter|linkedin post|blog)\b/i;
const aiSignals =
  /\b(ai generated|ai-derived analysis|not externally verified|planning assumption|model assumption|validation required|no verified source|source metadata was not provided|kaynak bilgisi doğrulanamadı|harici olarak doğrulanmadı)\b/i;

function emptyDistribution(): Record<SourceReliabilityCategory, number> {
  return Object.fromEntries(categories.map((category) => [category, 0])) as Record<
    SourceReliabilityCategory,
    number
  >;
}

function getDomain(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function collectSourceCandidates(report: Record<string, string>) {
  const sourceText = Object.entries(report)
    .filter(([field]) => /source|sources|kaynak/i.test(field))
    .map(([, content]) => content)
    .join("\n");
  const fallbackText = sourceText || Object.values(report).join("\n");
  const urls = [...fallbackText.matchAll(/https?:\/\/[^\s),\]]+/gi)].map((match) =>
    match[0].replace(/[.,;:]+$/, "")
  );
  const lines = fallbackText
    .split(/\n|•|-/)
    .map((line) => line.trim())
    .filter((line) => line.length >= 8 && !/^(sources|kaynaklar|assumptions|varsayımlar)$/i.test(line));
  const candidates = new Map<string, SourceCandidate>();

  for (const url of urls) {
    const domain = getDomain(url);

    candidates.set(domain || url, { text: domain || url, url });
  }

  for (const line of lines) {
    if (!/(source|publisher|confidence|verified|benchmark|official|government|industry|academic|news|url|http|kaynak|yayıncı|doğrulanmış|benchmark)/i.test(line)) {
      continue;
    }

    const url = line.match(/https?:\/\/[^\s),\]]+/i)?.[0]?.replace(/[.,;:]+$/, "") || "";
    const key = getDomain(url) || line.toLowerCase().slice(0, 120);

    candidates.set(key, { text: line, url });
  }

  return [...candidates.values()];
}

export function classifySourceReliability(candidate: SourceCandidate): {
  category: SourceReliabilityCategory;
  score: number;
} {
  const domain = getDomain(candidate.url);
  const text = `${candidate.text} ${domain}`;

  if (aiSignals.test(text)) {
    return { category: "AI Generated", score: 35 };
  }

  if (
    governmentPublishers.test(text) ||
    worldHealthOrganizationAcronym.test(text) ||
    /\.(gov|gov\.tr|int)$/i.test(domain)
  ) {
    return { category: "Government", score: 92 };
  }

  if (academicPublishers.test(text) || /\.edu$/i.test(domain)) {
    return { category: "Academic", score: 88 };
  }

  if (officialSignals.test(text) || (candidate.url && /\b(company|investor|about|annual-report)\b/i.test(candidate.url))) {
    return { category: "Official", score: 86 };
  }

  if (trustedIndustryPublishers.test(text)) {
    return { category: "Industry", score: 78 };
  }

  if (newsPublishers.test(text)) {
    return { category: "News", score: 66 };
  }

  if (communitySignals.test(text)) {
    return { category: "Community", score: 42 };
  }

  return { category: "Unknown", score: candidate.url ? 50 : 30 };
}

export function scoreReportSources(report: Record<string, string>): SourceReliabilitySummary {
  const candidates = collectSourceCandidates(report);
  const distribution = emptyDistribution();

  if (candidates.length === 0) {
    distribution.Unknown = 1;

    return {
      source_count: 0,
      average_source_score: 0,
      lowest_source_score: 0,
      highest_source_score: 0,
      source_distribution: distribution,
    };
  }

  const scores = candidates.map((candidate) => {
    const result = classifySourceReliability(candidate);

    distribution[result.category] += 1;

    return result.score;
  });

  return {
    source_count: candidates.length,
    average_source_score: Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length),
    lowest_source_score: Math.min(...scores),
    highest_source_score: Math.max(...scores),
    source_distribution: distribution,
  };
}
