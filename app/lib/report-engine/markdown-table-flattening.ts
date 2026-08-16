// The PDF/browser renderer for Market Intelligence sections has no
// markdown-table drawing support anywhere in the codebase (confirmed: no
// table-layout code exists in ReportPdfButton.tsx outside the unrelated
// Table of Contents). When the model writes a competitor comparison as a
// literal markdown table (a real, observed failure mode for
// competitiveLandscape/majorPlayers), the raw "| a | b | c |" syntax
// renders as unreadable pipe-delimited text instead of a table -- a
// concrete "broken table" render defect. Rather than building a new
// PDF table-drawing feature, this flattens any markdown table found in
// report content into one readable bullet line per row, using the
// header row as field labels -- safe for both the browser view and the
// PDF export since both already render bullet/prose text correctly.

function isTableRow(line: string): boolean {
  return /^\s*\|.*\|\s*$/.test(line);
}

function isSeparatorRow(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableCells(line: string): string[] {
  const trimmed = line.trim();
  const withoutEdges = trimmed.replace(/^\|/, "").replace(/\|$/, "");
  return withoutEdges.split("|").map((cell) => cell.trim());
}

export function flattenMarkdownTables(content: string): string {
  if (!content || !content.includes("|")) {
    return content;
  }

  const lines = content.split("\n");
  const result: string[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    const next = lines[index + 1];

    if (isTableRow(line) && typeof next === "string" && isSeparatorRow(next)) {
      const headers = splitTableCells(line);
      let rowIndex = index + 2;
      const rows: string[][] = [];

      while (rowIndex < lines.length && isTableRow(lines[rowIndex])) {
        rows.push(splitTableCells(lines[rowIndex]));
        rowIndex += 1;
      }

      for (const row of rows) {
        const label = row[0]?.trim();
        const fields = headers
          .slice(1)
          .map((header, cellIndex) => {
            const value = row[cellIndex + 1]?.trim();
            return value && value !== "-" ? `${header}: ${value}` : "";
          })
          .filter(Boolean)
          .join("; ");

        if (label || fields) {
          result.push(fields ? `- ${label || "Entry"} — ${fields}` : `- ${label}`);
        }
      }

      index = rowIndex;
      continue;
    }

    result.push(line);
    index += 1;
  }

  return result.join("\n");
}
