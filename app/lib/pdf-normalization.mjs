export function normalizePdfText(value) {
  return preservePdfInlineTokens(value
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\bEScooter\b/g, "E-Scooter")
    .replace(/\bPlanning inputs narrow\b/gi, "Planning inputs define")
    .replace(/\bMarket references\b/gi, "Market sources")
    .replace(/\bSee risk section\b/gi, "Primary risk is detailed in the risk analysis")
    .replace(/\bValidate critical proof point\b/gi, "Validate the primary investment thesis")
    .replace(/(\d+)(müşteri)/gi, "$1 $2")
    .replace(/\bfiyat\s+sıkıştırma\s+by\s+yerel\s+danışmanlar\b/gi, "yerel danışmanların fiyat baskısı")
    .replace(/\b(\d+(?:[.,]\d+)?)b\b/g, "$1B")
    .replace(/([.!?])\s+\1/g, "$1")
    .replace(/\s+([,.;:)])/g, "$1")
    .replace(/(\d)\.\s+(\d)(\s*[kKmMbB%])?/g, "$1.$2$3")
    .replace(/(\d),\s+(\d{3})/g, "$1,$2")
    .replace(/\n{3,}/g, "\n\n")
    .trim());
}

export function preservePdfInlineTokens(value) {
  return value
    .replace(/([€$₺])\s+(?=\d)/g, "$1")
    .replace(/([<>])\s+([€$₺]?\d)/g, "$1$2")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*months?\b/gi, "$1–$2\u00a0months")
    .replace(/\b(\d{2})(\d{2})\s*months?\b/gi, "$1–$2\u00a0months")
    .replace(/\b100\s*[-–]\s*3\s*[-–]\s*00\s+scooters?\b/gi, "100–300\u00a0scooters")
    .replace(/\b100\s*[-–]\s*3\s*[-–]\s*00\b/g, "100–300")
    .replace(/\b1\s*[-–]\s*80\s+days?\b/gi, "180\u00a0days")
    .replace(/\b1\s*[-–]\s*80\b/g, "180")
    .replace(/\b1224\b/g, "12–24")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*days?\b/gi, "$1–$2\u00a0days")
    .replace(/\b(\d{2})(\d{2})\s*days?\b/gi, "$1–$2\u00a0days")
    .replace(/\b(\d{2})(\d{2})\s+(days?|months?|scooters?|rides\/day|rides)\b/gi, "$1–$2\u00a0$3")
    .replace(/\b(\d{3})(\d{3})\s+(scooters?|rides\/day|rides)\b/gi, "$1–$2\u00a0$3")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*(?:rides\/day|rides)\b/gi, "$1–$2\u00a0rides/day")
    .replace(/\b(\d{1,2})\s*[-–]\s*(\d{1,2})\s*scooters?\b/gi, "$1–$2\u00a0scooters")
    .replace(/\b(\d{1,2})(\d{2})\s*%\b/g, "$1–$2%")
    .replace(/\b(\d{1,2})(\d{2})-month\b/gi, "$1–$2-month")
    .replace(/\b(\d+(?:[.,]\d+)*)\s*-\s*month\b/gi, "$1-month")
    .replace(/\b(\d{2})2month\b/gi, "$1\u00a0month")
    .replace(/\b(\d+(?:[.,]\d+)*)month\b/gi, "$1-month")
    .replace(/\b(\d+(?:[.,]\d+)*)months\b/gi, "$1\u00a0months")
    .replace(/\b(\d+(?:[.,]\d+)*)\s+month\b/gi, "$1\u00a0month")
    .replace(/\b(\d+(?:[.,]\d+)*)\s+months\b/gi, "$1\u00a0months")
    .replace(/\b(\d+)(?=(?:municipal|public|private|corporate|enterprise|customer|customers|user|users|month|months|day|days|scooter|scooters)\b)/gi, "$1 ")
    .replace(/(\d+)(?=müşteri)/gi, "$1 ")
    .replace(/\b(minimum)(?=revenue\b)/gi, "$1 ")
    .replace(/\b(public)(?=sector\b)/gi, "$1 ")
    .replace(/\b(private)(?=sector\b)/gi, "$1 ")
    .replace(/\b(last)(?=mile\b)/gi, "$1-")
    .replace(/\blast\s+mile\b/gi, "last-mile")
    .replace(/\b(third)(?=party\b)/gi, "$1-")
    .replace(/\bthird\s+party\b/gi, "third-party")
    .replace(/\b(one)(?=pager\b)/gi, "$1-")
    .replace(/\bone\s+pager\b/gi, "one-pager")
    .replace(/\b(well)(?=funded\b)/gi, "$1-")
    .replace(/\bwell\s+funded\b/gi, "well-funded")
    .replace(/\b(post)(?=\d{4}\b)/gi, "$1-")
    .replace(/(\d)\s+([kKmMbB%])\b/g, "$1$2")
    .replace(/(\d(?:[.,]\d+)*)\s*([kKmMbB])\b/g, "$1$2")
    .replace(/(\d(?:[.,]\d+)*)\s*%/g, "$1%")
    .replace(/([kKmMbB%])\s+([€$₺])/g, "$1$2")
    .replace(/([€$₺])(\d(?:[.,]\d+)*)\s*([kKmMbB])\b/g, "$1$2$3")
    .replace(/(\d+)(müşteri)/gi, "$1 $2")
    .replace(/(\d(?:[.,]\d+)*)\s+(months?|ay|gün|days?|weeks?|hafta|years?|yıl|scooters?)\b/gi, "$1\u00a0$2")
    .replace(/\bYear\s+(\d+)\b/gi, "Year\u00a0$1")
    .replace(/\bYear(\d+)\b/gi, "Year\u00a0$1")
    .replace(/\bMonth\s+(\d+)\b/gi, "Month\u00a0$1")
    .replace(/\bMonth(\d+)\b/gi, "Month\u00a0$1")
    .replace(/\(e\.\s*,/gi, "(e.g.,")
    .replace(/\be\.\s*,/gi, "e.g.,")
    .replace(/\bi\.\s*,/gi, "i.e.,")
    .replace(/\be\.\s*g\./gi, "e.g.")
    .replace(/\bi\.\s*e\./gi, "i.e.")
    .replace(/\bv\.\s*s\./gi, "vs.")
    .replace(/\bN\.\s*o\./g, "No.")
    .replace(/\bM\.\s*r\./g, "Mr.")
    .replace(/\bD\.\s*r\./g, "Dr.")
    .replace(/\betc\./gi, "etc.")
    .replace(/\b(e\.g\.|i\.e\.|vs\.|etc\.|No\.|Mr\.|Dr\.)\s+(?=\S)/g, "$1\u00a0")
    .replace(/\bU\.\s*S\./gi, "U.S.")
    .replace(/\bE\.\s*U\./gi, "E.U.")
    .replace(/\bB\s*2\s*B\b/gi, "B2B")
    .replace(/\bB\s*2\s*G\b/gi, "B2G")
    .replace(/\bA\s*R\s*P\s*A\b/gi, "ARPA")
    .replace(/\bC\s*A\s*C\b/gi, "CAC")
    .replace(/\bL\s*T\s*V\b/gi, "LTV")
    .replace(/\bE\s*B\s*I\s*T\s*D\s*A\b/gi, "EBITDA")
    .replace(/(\d)\.\s*(\d)/g, "$1.$2")
    .replace(/(\d),\s*(\d{3})/g, "$1,$2");
}

export function cleanPdfContinuationFragment(value) {
  return preservePdfInlineTokens(value.trim().replace(/^[-*•]\s*/, ""));
}

export function shouldJoinPdfLineFragment(previousLine, currentLine) {
  const previous = previousLine.trim();
  const current = cleanPdfContinuationFragment(currentLine);

  if (!previous || !current) {
    return false;
  }

  return (
    /(?:[€$₺]?\d+(?:[.,]\d+)*[.,]|[€$₺]?\d+)$/.test(previous) &&
      /^(?:\d+(?:[.,]\d+)?(?:[kKmMbB%])?|[kKmMbB%]|months?|days?|ay|gün|scooters?)\b/i.test(current)
  ) || (
    /\b(?:e|i|v|N|M|D)\.$/.test(previous) && /^(?:g|e|s|o|r)\.$/i.test(current)
  ) || (
    /(?:\(|\b)(?:e|i)\.$/i.test(previous) && /^,\s*\S/.test(current)
  ) || (
    /\b(?:e\.g\.|i\.e\.|vs\.|etc\.|No\.|Mr\.|Dr\.)$/i.test(previous) && /^[.,)]$/.test(current)
  ) || (
    /[€$₺(]$/.test(previous) && /^\d/.test(current)
  ) || (
    /[a-zçğıöşü]$/i.test(previous) && /^(?:municipal|permit|sector|revenue|market|customer|customers|user|users|month|months|scooters?|pilot|validation)\b/i.test(current)
  ) || (
    !/[.!?:;)]$/.test(previous) && /^(?:mile|funded|revenue|sector|pager|party|month|months|pilot|validation|\d{1,3})$/i.test(current)
  ) || /^[.,)]$/.test(current);
}

export function joinPdfLineFragment(previousLine, currentLine) {
  const current = cleanPdfContinuationFragment(currentLine);

  if (/(?:\(|\b)e\.$/i.test(previousLine.trim()) && /^,\s*\S/.test(current)) {
    return preservePdfInlineTokens(`${previousLine.trimEnd()}g.${current}`);
  }

  if (/(?:\(|\b)i\.$/i.test(previousLine.trim()) && /^,\s*\S/.test(current)) {
    return preservePdfInlineTokens(`${previousLine.trimEnd()}e.${current}`);
  }

  const separator =
    /(?:[€$₺]?\d+(?:[.,]\d+)*[.,]|[€$₺(]|\b(?:e|i|v|N|M|D)\.)$/i.test(previousLine.trim()) ||
    /^[.,)]/.test(current)
      ? ""
      : " ";

  return preservePdfInlineTokens(`${previousLine.trimEnd()}${separator}${current}`);
}

export function repairPdfLineFragments(lines, isOrphanBulletText = () => false) {
  return lines.reduce((repaired, line) => {
    const withoutBullet = cleanPdfContinuationFragment(line);

    if (repaired.length > 0 && shouldJoinPdfLineFragment(repaired[repaired.length - 1], line)) {
      repaired[repaired.length - 1] = joinPdfLineFragment(repaired[repaired.length - 1], line);
      return repaired;
    }

    if (isOrphanBulletText(withoutBullet)) {
      return repaired;
    }

    if (repaired[repaired.length - 1]?.trim() === line.trim()) {
      return repaired;
    }

    repaired.push(line);
    return repaired;
  }, []);
}
