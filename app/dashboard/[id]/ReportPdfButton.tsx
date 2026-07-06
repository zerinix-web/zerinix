"use client";

import { useEffect, useState } from "react";
import { jsPDF } from "jspdf";
import { Download } from "lucide-react";
import type { DashboardReport } from "../report-utils";

let pdfFontPromise: Promise<string> | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}

function loadPdfFont() {
  pdfFontPromise ??= fetch("/fonts/Geist-Regular.ttf")
    .then((response) => {
      if (!response.ok) {
        throw new Error("PDF font could not be loaded.");
      }

      return response.arrayBuffer();
    })
    .then(arrayBufferToBase64);

  return pdfFontPromise;
}

function normalizePdfText(value: string) {
  return value
    .normalize("NFC")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\t/g, "  ")
    .replace(/[ \u00a0]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const founderRoadmapSteps = [
  "Tomorrow",
  "This Week",
  "30 Days",
  "90 Days",
  "180 Days",
  "12 Months",
];

const founderScoreMetrics = [
  "Overall Score",
  "Innovation",
  "Market Timing",
  "Competition",
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`${escapedLabel}\\s*[:\\-–—]\\s*([^\\n|]+)`, "i")
  );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function extractScore(content: string, label: string) {
  const value = extractMetricValue(content, label);
  const scoreMatch = value.match(/\b(\d{1,3})\b/);
  const fallbackMatch = content.match(
    new RegExp(`${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^\\d]{0,30}(\\d{1,3})`, "i")
  );
  const rawScore = Number(scoreMatch?.[1] || fallbackMatch?.[1] || NaN);

  if (!Number.isFinite(rawScore)) {
    return null;
  }

  return Math.max(0, Math.min(100, rawScore));
}

function detectRecommendation(content: string) {
  const match = content.match(/\b(GO|NO GO|WAIT|PIVOT|RAISE|BOOTSTRAP)\b/i);

  return match?.[1]?.toUpperCase() || "";
}

function extractConfidence(content: string) {
  const explicit = extractScore(content, "Confidence");

  if (explicit !== null) {
    return explicit;
  }

  const percentMatch = content.match(/\b(\d{1,3})\s*%/);
  const percent = Number(percentMatch?.[1] || NaN);

  return Number.isFinite(percent) ? Math.max(0, Math.min(100, percent)) : null;
}

function createFileName(title: string) {
  const slug = title
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

  return `${slug || "zerinix-report"}.pdf`;
}

export default function ReportPdfButton({ report }: { report: DashboardReport }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const [fontBase64, setFontBase64] = useState("");

  useEffect(() => {
    let mounted = true;

    loadPdfFont()
      .then((loadedFont) => {
        if (mounted) {
          setFontBase64(loadedFont);
        }
      })
      .catch((fontError) => {
        console.error(fontError);
      });

    return () => {
      mounted = false;
    };
  }, []);

  function downloadPdf() {
    if (exporting) {
      return;
    }

    if (!fontBase64) {
      setError("PDF fontu yükleniyor. Lütfen birkaç saniye sonra tekrar deneyin.");
      return;
    }

    setExporting(true);
    setError("");

    try {
      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 14;
      const contentWidth = pageWidth - margin * 2;
      const bodyX = margin + 20;
      const bodyWidth = contentWidth - 28;
      const bodyLineHeight = 4.8;
      const cardHeaderHeight = 20;
      const cardBottomPadding = 7;
      let y = margin;

      pdf.addFileToVFS("Geist-Regular.ttf", fontBase64);
      pdf.addFont("Geist-Regular.ttf", "Geist", "normal");
      pdf.setFont("Geist", "normal");
      pdf.setCharSpace(0);

      const paintPage = () => {
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
      };

      const ensureSpace = (height: number) => {
        if (y + height <= pageHeight - margin) {
          return;
        }

        drawFooter();
        pdf.addPage();
        paintPage();
        y = margin;
      };

      const drawFooter = () => {
        pdf.setDrawColor("#27272a");
        pdf.line(margin, pageHeight - 10, pageWidth - margin, pageHeight - 10);
        pdf.setFontSize(7);
        pdf.setTextColor("#71717a");
        pdf.text("ZERINIX CONFIDENTIAL INVESTOR REPORT", margin, pageHeight - 5);
        pdf.text(
          `Page ${pdf.getNumberOfPages()}`,
          pageWidth - margin - 18,
          pageHeight - 5
        );
      };

      const drawTag = (label: string, x: number, tagY: number, width: number) => {
        pdf.setFillColor("#042f2e");
        pdf.setDrawColor("#115e59");
        pdf.roundedRect(x, tagY, width, 10, 5, 5, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor("#ccfbf1");
        pdf.text(label, x + 4, tagY + 6.4, { maxWidth: width - 8 });
      };

      const drawCoverPage = () => {
        paintPage();
        pdf.setFillColor("#020617");
        pdf.setDrawColor("#134e4a");
        pdf.roundedRect(margin, 18, contentWidth, pageHeight - 36, 8, 8, "FD");
        pdf.setFillColor("#14b8a6");
        pdf.rect(margin, 18, 2, pageHeight - 36, "F");

        pdf.setFontSize(10);
        pdf.setTextColor("#5eead4");
        pdf.text("ZERINIX REPORT", margin + 12, 38);

        pdf.setFontSize(31);
        pdf.setTextColor("#ffffff");
        const coverTitle = pdf.splitTextToSize(normalizePdfText(report.title), contentWidth - 24);
        pdf.text(coverTitle, margin + 12, 60, {
          lineHeightFactor: 1.08,
          maxWidth: contentWidth - 24,
        });

        pdf.setFontSize(11);
        pdf.setTextColor("#a1a1aa");
        pdf.text("Premium AI business intelligence report for founder and investor decisions.", margin + 12, 84, {
          maxWidth: contentWidth - 24,
        });

        drawTag("AI Ready", margin + 12, 101, 28);
        drawTag("Investor Ready", margin + 44, 101, 38);

        const coverMeta = [
          ["Report Type", report.type],
          ["Business Idea", report.title],
          ["Date", report.createdAt ? new Date(report.createdAt).toLocaleDateString("tr-TR") : "Tarih yok"],
          ["Status", report.status],
        ];

        let metaY = 128;
        coverMeta.forEach(([label, value]) => {
          pdf.setFillColor("#09090b");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(margin + 12, metaY, contentWidth - 24, 17, 4, 4, "FD");
          pdf.setFontSize(7.5);
          pdf.setTextColor("#71717a");
          pdf.text(label.toUpperCase(), margin + 18, metaY + 6);
          pdf.setFontSize(9.5);
          pdf.setTextColor("#f4f4f5");
          pdf.text(value, margin + 18, metaY + 12, { maxWidth: contentWidth - 36 });
          metaY += 22;
        });

        ["TAM / SAM / SOM", "Financial Dashboard", "Founder Score", "Executive Recommendation"].forEach((label, index) => {
          const cardWidth = (contentWidth - 33) / 2;
          const cardX = margin + 12 + (index % 2) * (cardWidth + 9);
          const cardY = 220 + Math.floor(index / 2) * 20;

          pdf.setFillColor("#0a0a0a");
          pdf.setDrawColor("#27272a");
          pdf.roundedRect(cardX, cardY, cardWidth, 14, 4, 4, "FD");
          pdf.setFillColor("#5eead4");
          pdf.circle(cardX + 6, cardY + 7, 1.7, "F");
          pdf.setFontSize(8);
          pdf.setTextColor("#d4d4d8");
          pdf.text(label, cardX + 11, cardY + 8.5, { maxWidth: cardWidth - 15 });
        });

        drawFooter();
      };

      drawCoverPage();
      pdf.addPage();
      paintPage();
      y = margin;

      pdf.setFontSize(10);
      pdf.setTextColor("#5eead4");
      pdf.text("ZERINIX REPORT", margin, y);

      pdf.setFontSize(21);
      pdf.setTextColor("#ffffff");
      const titleLines = pdf.splitTextToSize(normalizePdfText(report.title), contentWidth - 38);
      pdf.text(titleLines, margin, y + 11, {
        lineHeightFactor: 1.18,
        maxWidth: contentWidth - 38,
      });

      pdf.setFillColor("#042f2e");
      pdf.setDrawColor("#115e59");
      pdf.roundedRect(pageWidth - margin - 32, y + 1, 32, 10, 5, 5, "FD");
      pdf.setFontSize(8);
      pdf.setTextColor("#ccfbf1");
      pdf.text(report.status, pageWidth - margin - 25, y + 7.3, {
        maxWidth: 22,
      });

      y += 28 + Math.max(0, titleLines.length - 1) * 7;

      const meta = `${report.type} - ${
        report.createdAt
          ? new Date(report.createdAt).toLocaleDateString("tr-TR")
          : "Tarih yok"
      }`;
      pdf.setFontSize(8.5);
      pdf.setTextColor("#a1a1aa");
      pdf.text(meta, margin, y, { maxWidth: contentWidth });
      y += 9;

      const summaryCards = [
        `${report.sections.length} Sections`,
        report.type,
        "Investor Ready",
      ];

      summaryCards.forEach((label, index) => {
        const cardWidth = (contentWidth - 8) / 3;
        const cardX = margin + index * (cardWidth + 4);

        pdf.setFillColor("#09090b");
        pdf.setDrawColor("#27272a");
        pdf.roundedRect(cardX, y, cardWidth, 12, 3, 3, "FD");
        pdf.setFontSize(7.5);
        pdf.setTextColor(index === 2 ? "#ccfbf1" : "#a1a1aa");
        pdf.text(label, cardX + 4, y + 7.5, { maxWidth: cardWidth - 8 });
      });

      y += 18;

      const drawSectionVisual = (title: string, content: string, sectionY: number) => {
        const normalizedTitle = title.toLowerCase();
        const visualY = sectionY + 19;

        if (normalizedTitle.includes("tam / sam / som")) {
          const funnelWidths = [bodyWidth, bodyWidth * 0.66, bodyWidth * 0.34];
          ["TAM", "SAM", "SOM"].forEach((label, index) => {
            const width = funnelWidths[index];
            const x = bodyX + (bodyWidth - width) / 2;
            const rowY = visualY + index * 6;

            pdf.setFillColor(index === 0 ? "#134e4a" : index === 1 ? "#115e59" : "#5eead4");
            pdf.roundedRect(x, rowY, width, 4, 1.5, 1.5, "F");
            pdf.setFontSize(6.5);
            pdf.setTextColor(index === 2 ? "#000000" : "#ccfbf1");
            pdf.text(label, x + 3, rowY + 3);
          });
          return 22;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          const selected = detectRecommendation(content) || "DECISION";
          const confidence = extractConfidence(content);
          const investmentNeeded = extractMetricValue(content, "Investment Needed");
          const mainRisk = extractMetricValue(content, "Main Risk");
          const nextAction = extractMetricValue(content, "Next Critical Action");

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 28, 10, 5, 5, "FD");
          pdf.setFontSize(8);
          pdf.setTextColor("#000000");
          pdf.text(selected, bodyX + 4, visualY + 6.5, { maxWidth: 20 });

          const recItems = [
            ["Confidence", confidence === null ? "TBD" : `${confidence}%`],
            ["Investment", investmentNeeded || "Assumption"],
            ["Main Risk", mainRisk || "See risk section"],
            ["Next Action", nextAction || "Validate critical proof point"],
          ];

          recItems.forEach(([label, value], index) => {
            const itemX = bodyX + 34 + (index % 2) * ((bodyWidth - 38) / 2 + 2);
            const itemY = visualY + Math.floor(index / 2) * 9;
            const itemWidth = (bodyWidth - 42) / 2;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, 7, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#71717a");
            pdf.text(label, itemX + 2, itemY + 2.7);
            pdf.setTextColor("#e4e4e7");
            pdf.text(value, itemX + 2, itemY + 5.7, { maxWidth: itemWidth - 4 });
          });

          return 21;
        }

        if (normalizedTitle.includes("roadmap")) {
          const stepWidth = (bodyWidth - 10) / 6;
          founderRoadmapSteps.forEach((step, index) => {
            const x = bodyX + index * (stepWidth + 2);
            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, visualY, stepWidth, 9, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(step, x + 2, visualY + 5.7, { maxWidth: stepWidth - 4 });
          });
          return 12;
        }

        if (
          normalizedTitle.includes("financial dashboard") ||
          normalizedTitle.includes("founder score") ||
          normalizedTitle.includes("scenario") ||
          normalizedTitle.includes("porter")
        ) {
          const labels = normalizedTitle.includes("founder score")
            ? founderScoreMetrics
            : normalizedTitle.includes("scenario")
              ? ["Worst", "Base", "Best"]
              : normalizedTitle.includes("porter")
                ? ["Rivalry", "Entrants", "Buyer", "Substitutes"]
                : normalizedTitle.includes("kpi")
                  ? ["Acquisition", "Activation", "Retention", "Revenue"]
                  : normalizedTitle.includes("risk")
                    ? ["Market", "Product", "Pricing", "Execution"]
                    : normalizedTitle.includes("unit economics")
                      ? ["Gross Margin", "CAC", "LTV", "Payback"]
                      : ["Revenue", "Expenses", "Gross Margin", "CAC", "LTV", "Payback Period", "Burn Rate", "Runway", "EBITDA", "Break-even Month", "Investment Needed"];
          const columns = labels.length > 6 ? 4 : labels.length;
          const itemWidth = (bodyWidth - (columns - 1) * 3) / columns;

          labels.forEach((label, index) => {
            const x = bodyX + (index % columns) * (itemWidth + 3);
            const itemY = visualY + Math.floor(index / columns) * 12;
            const score = extractScore(content, label) ?? [42, 62, 84, 56][index] ?? 60;
            const value = extractMetricValue(content, label);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 10, 2, 2, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(label, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
            if (normalizedTitle.includes("financial dashboard") && value) {
              pdf.setTextColor("#f4f4f5");
              pdf.text(value, x + 2, itemY + 7.2, { maxWidth: itemWidth - 4 });
              return;
            }
            pdf.setFillColor("#27272a");
            pdf.roundedRect(x + 2, itemY + 7, itemWidth - 4, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(
              x + 2,
              itemY + 7,
              Math.max(3, ((itemWidth - 4) * score) / 100),
              1.4,
              0.7,
              0.7,
              "F"
            );
          });

          return labels.length > 6 ? 38 : 16;
        }

        return 0;
      };

      const getVisualHeight = (title: string) => {
        const normalizedTitle = title.toLowerCase();

        if (normalizedTitle.includes("financial dashboard")) {
          return 38;
        }

        if (normalizedTitle.includes("tam / sam / som")) {
          return 22;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          return 21;
        }

        return /founder score|scenario|roadmap|porter|kpi|risk|unit economics/i.test(title)
          ? 16
          : 0;
      };

      report.sections.forEach((section) => {
        const visualHeight = getVisualHeight(section.title);
        const bodyLines = pdf.splitTextToSize(
          normalizePdfText(section.content),
          bodyWidth
        ) as string[];
        let lineIndex = 0;

        while (lineIndex < bodyLines.length) {
          ensureSpace(38);

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - visualHeight - cardBottomPadding;
          const maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
          const lines = bodyLines.slice(lineIndex, lineIndex + maxLines);
          const isContinued = lineIndex > 0;
          const cardHeight = Math.max(
            31,
            cardHeaderHeight + visualHeight + lines.length * bodyLineHeight + cardBottomPadding
          );

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

          pdf.setFontSize(13);
          pdf.setTextColor("#ffffff");
          pdf.text(`${section.title}${isContinued ? " devamı" : ""}`, bodyX, y + 11, {
            maxWidth: bodyWidth,
          });

          const drawnVisualHeight = isContinued
            ? 0
            : drawSectionVisual(section.title, section.content, y);

          pdf.setFontSize(9);
          pdf.setTextColor("#d4d4d8");
          pdf.text(lines, bodyX, y + 20 + drawnVisualHeight, {
            lineHeightFactor: 1.22,
            maxWidth: bodyWidth,
          });

          lineIndex += lines.length;
          y += cardHeight + 5;
        }
      });

      drawFooter();

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      const isSafari =
        /^((?!chrome|android).)*safari/i.test(navigator.userAgent) ||
        navigator.vendor.includes("Apple");

      if (isSafari) {
        const openedWindow = window.open(url, "_blank");

        if (!openedWindow) {
          URL.revokeObjectURL(url);
          setError("Safari PDF sekmesini engelledi. Lütfen açılır pencerelere izin verip tekrar deneyin.");
          return;
        }

        window.setTimeout(() => URL.revokeObjectURL(url), 300000);
      } else {
        const link = document.createElement("a");

        link.href = url;
        link.download = createFileName(report.title);
        link.rel = "noopener";
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();

        window.setTimeout(() => URL.revokeObjectURL(url), 120000);
      }
    } catch (downloadError) {
      console.error(downloadError);
      setError("PDF oluşturulamadı. Lütfen tekrar deneyin.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={downloadPdf}
        disabled={exporting}
        className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-2xl border border-teal-200/30 bg-teal-300 px-5 py-3 text-sm font-semibold text-black shadow-lg shadow-teal-950/30 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Download className="h-4 w-4 text-black" />
        {exporting ? "PDF hazırlanıyor..." : "Download PDF"}
      </button>
      {error ? (
        <p className="mt-3 max-w-xs text-sm leading-6 text-red-300">{error}</p>
      ) : null}
    </div>
  );
}
