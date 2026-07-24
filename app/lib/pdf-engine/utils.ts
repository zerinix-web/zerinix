import type { PdfDocument } from "./core";

export function wrapPdfText({
  pdf,
  text,
  width,
  normalizeText,
}: {
  pdf: PdfDocument;
  text: string;
  width: number;
  normalizeText: (value: string) => string;
}) {
  return pdf.splitTextToSize(normalizeText(text), width) as string[];
}

export function splitPdfReadableLines({
  pdf,
  content,
  width,
  normalizeText,
  repairLineFragments,
  isOrphanBulletText,
}: {
  pdf: PdfDocument;
  content: string;
  width: number;
  normalizeText: (value: string) => string;
  repairLineFragments: (
    lines: string[],
    isOrphanBulletText: (value: string) => boolean
  ) => string[];
  isOrphanBulletText: (value: string) => boolean;
}) {
  return repairLineFragments(
    content.split("\n").flatMap((rawLine) => {
      const line = normalizeText(rawLine);

      if (!line) {
        return [""];
      }

      const isBullet = /^[-*•]\s+/.test(line);
      const isSourceMetaLine = /^(?:Domain|Publisher|Year|Confidence|Type|URL)\s*:/i.test(line);
      const availableWidth = isBullet || isSourceMetaLine ? width - 4 : width;
      const wrapped = pdf.splitTextToSize(line, availableWidth) as string[];

      return wrapped.map((wrappedLine, index) => {
        if (isSourceMetaLine) {
          return `${index > 0 ? "    " : "  "}${wrappedLine}`;
        }

        return isBullet && index > 0 ? `  ${wrappedLine}` : wrappedLine;
      });
    }),
    isOrphanBulletText
  );
}

