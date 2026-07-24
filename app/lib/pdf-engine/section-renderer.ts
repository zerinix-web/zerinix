import type { PdfDocument } from "./core";

export function drawPdfSectionCardFrame(
  pdf: PdfDocument,
  {
    margin,
    y,
    contentWidth,
    cardHeight,
  }: {
    margin: number;
    y: number;
    contentWidth: number;
    cardHeight: number;
  }
) {
  pdf.setFillColor("#09090b");
  pdf.setDrawColor("#27272a");
  pdf.roundedRect(margin, y, contentWidth, cardHeight, 5, 5, "FD");

  pdf.setFillColor("#111113");
  pdf.roundedRect(margin, y, contentWidth, 18, 5, 5, "F");

  pdf.setFillColor("#18181b");
  pdf.setDrawColor("#27272a");
  pdf.roundedRect(margin + 4, y + 5, 11, 11, 3, 3, "FD");

  pdf.setDrawColor("#99f6e4");
  pdf.circle(margin + 9.5, y + 10.5, 2.9, "S");
  pdf.line(margin + 9.5, y + 7.8, margin + 9.5, y + 13.2);
  pdf.line(margin + 6.8, y + 10.5, margin + 12.2, y + 10.5);

  pdf.setFillColor("#5eead4");
  pdf.rect(margin, y + 5, 1, cardHeight - 10, "F");
}

