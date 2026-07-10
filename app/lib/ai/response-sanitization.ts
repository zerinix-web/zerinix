const accidentalPrefixPattern =
  /(^|\n)\s*(?:[-*•]\s*)?(?:(?:理由|原因|回答|答案|結論|结论|要点|建議|建议|説明|説明理由|分析|根拠|요약|이유|원인|답변|결론|분석)\s*[：:]\s*)+/g;

const accidentalStandaloneTokenPattern =
  /(^|\n)\s*(?:[-*•]\s*)?(?:理由|原因|回答|答案|結論|结论|要点|建議|建议|説明|説明理由|分析|根拠|요약|이유|원인|답변|결론|분석)\s*[：:]\s*(?=\n|$)/g;

export function sanitizeAiResponseText(value: string) {
  return value
    .normalize("NFC")
    .replace(accidentalStandaloneTokenPattern, "$1")
    .replace(accidentalPrefixPattern, "$1")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
