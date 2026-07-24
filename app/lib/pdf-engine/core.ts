import { jsPDF } from "jspdf";

export type PdfLocale = "en" | "tr";
export type PdfDocument = jsPDF;

export function createPdfDocument() {
  return new jsPDF("p", "mm", "a4");
}

export function getPdfPageMetrics(pdf: PdfDocument, margin = 14) {
  const pageWidth = pdf.internal.pageSize.getWidth();
  const pageHeight = pdf.internal.pageSize.getHeight();
  const contentWidth = pageWidth - margin * 2;

  return {
    pageWidth,
    pageHeight,
    margin,
    contentWidth,
  };
}

export function applyPdfFont(pdf: PdfDocument, fontBase64: string) {
  pdf.addFileToVFS("Geist-Regular.ttf", fontBase64);
  pdf.addFont("Geist-Regular.ttf", "Geist", "normal");
  pdf.setFont("Geist", "normal");
  pdf.setCharSpace(0);
}

export function paintPdfPageBackground(
  pdf: PdfDocument,
  {
    pageWidth,
    pageHeight,
  }: {
    pageWidth: number;
    pageHeight: number;
  }
) {
  pdf.setFillColor("#000000");
  pdf.rect(0, 0, pageWidth, pageHeight, "F");
  pdf.setDrawColor("#0f766e");
  pdf.setLineWidth(0.15);

  for (let gridX = 0; gridX <= pageWidth; gridX += 18) {
    pdf.line(gridX, 0, gridX, pageHeight);
  }

  for (let gridY = 0; gridY <= pageHeight; gridY += 18) {
    pdf.line(0, gridY, pageWidth, gridY);
  }
}

export function drawPdfFooter(
  pdf: PdfDocument,
  {
    pageWidth,
    pageHeight,
    margin,
    locale,
    includePageCounter = false,
  }: {
    pageWidth: number;
    pageHeight: number;
    margin: number;
    locale: PdfLocale;
    includePageCounter?: boolean;
  }
) {
  const currentPage = pdf.getCurrentPageInfo().pageNumber;

  pdf.setFillColor("#000000");
  pdf.rect(0, pageHeight - 13, pageWidth, 13, "F");
  pdf.setDrawColor("#27272a");
  pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);

  if (!includePageCounter) {
    return;
  }

  pdf.setFontSize(7);
  pdf.setTextColor("#71717a");
  pdf.text(
    locale === "tr"
      ? `Sayfa ${currentPage} / ${pdf.getNumberOfPages()}`
      : `Page ${currentPage} / ${pdf.getNumberOfPages()}`,
    pageWidth - margin - 22,
    pageHeight - 5
  );
}

export function drawPdfLogoMark(
  pdf: PdfDocument,
  x: number,
  logoY: number,
  size = 13
) {
  pdf.setFillColor("#042f2e");
  pdf.setDrawColor("#14b8a6");
  pdf.roundedRect(x, logoY, size, size, 3, 3, "FD");
  pdf.setFontSize(size * 0.52);
  pdf.setTextColor("#ccfbf1");
  pdf.text("Z", x + size * 0.34, logoY + size * 0.68);
}

