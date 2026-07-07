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
  "Execution",
  "Competition",
  "Capital",
  "Revenue",
  "Risk",
];

const financialDashboardMetrics = [
  { label: "ARR", aliases: ["ARR", "Annual Recurring Revenue", "Revenue"] },
  { label: "MRR", aliases: ["MRR", "Monthly Recurring Revenue"] },
  { label: "Gross Margin", aliases: ["Gross Margin", "Margin"] },
  { label: "CAC", aliases: ["CAC", "Customer Acquisition Cost"] },
  { label: "LTV", aliases: ["LTV", "Lifetime Value"] },
  { label: "Burn Rate", aliases: ["Burn Rate", "Burn"] },
  { label: "Runway", aliases: ["Runway"] },
  { label: "Payback", aliases: ["Payback", "Payback Period"] },
  { label: "EBITDA", aliases: ["EBITDA"] },
  { label: "Break-even", aliases: ["Break-even Month", "Break even Month", "Breakeven"] },
  { label: "Investment Needed", aliases: ["Investment Needed", "Investment"] },
];

function extractMetricValue(content: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(`${escapedLabel}\\s*[:\\-–—]\\s*([^\\n|]+)`, "i")
  );

  return match?.[1]?.trim().replace(/\*\*/g, "") || "";
}

function extractMetricValueFromAliases(
  content: string,
  aliases: string[] | readonly string[]
) {
  for (const alias of aliases) {
    const value = extractMetricValue(content, alias);

    if (value) {
      return value;
    }
  }

  return "";
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

function extractSectionSnippet(content: string, title: string) {
  const escapedTitle = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(
    new RegExp(
      `${escapedTitle}\\s*[:\\-–—]?\\s*([\\s\\S]*?)(?=\\n\\s*(?:Strengths|Weaknesses|Opportunities|Threats|Worst|Base|Best|Revenue|MRR|Burn|Runway|Risk|Decision)\\s*[:\\-–—]|$)`,
      "i"
    )
  );

  return match?.[1]?.trim() || "";
}

function extractBullets(content: string, fallback: string) {
  const source = content || fallback;
  const bullets = source
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter(Boolean)
    .slice(0, 2);

  return bullets.length > 0 ? bullets : [fallback];
}

function removeDuplicateVisualText(title: string, content: string) {
  const normalizedTitle = title.toLowerCase();
  const lines = normalizePdfText(content)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (normalizedTitle.includes("tam / sam / som")) {
    return lines
      .filter((line) => !/^(?:[-*]\s*)?(?:\*\*)?(tam|sam|som)(?:\*\*)?\s*[:\-–—]/i.test(line))
      .join("\n");
  }

  if (normalizedTitle.includes("financial dashboard")) {
    const metricPattern =
      /^(?:[-*]\s*)?(?:\*\*)?(arr|mrr|revenue|expenses|gross margin|cac|ltv|payback(?: period)?|burn(?: rate)?|runway|ebitda|break[- ]?even(?: month)?|investment(?: needed)?)(?:\*\*)?\s*[:\-–—]/i;

    return lines.filter((line) => !metricPattern.test(line)).join("\n");
  }

  if (normalizedTitle.includes("swot")) {
    const swotPattern =
      /^(?:[-*]\s*)?(?:\*\*)?(strengths?|weaknesses?|opportunities|threats?)(?:\*\*)?\s*[:\-–—]/i;

    return lines.filter((line) => !swotPattern.test(line)).join("\n");
  }

  return normalizePdfText(content);
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
      const bodyLineHeight = 5.25;
      const cardHeaderHeight = 24;
      const cardBottomPadding = 9;
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
            const value = extractMetricValue(content, label);

            pdf.setFillColor(index === 0 ? "#134e4a" : index === 1 ? "#115e59" : "#5eead4");
            pdf.roundedRect(x, rowY, width, 4, 1.5, 1.5, "F");
            pdf.setFontSize(6.5);
            pdf.setTextColor(index === 2 ? "#000000" : "#ccfbf1");
            pdf.text(label, x + 3, rowY + 3);
            if (value) {
              pdf.text(value, x + width - 34, rowY + 3, { maxWidth: 30 });
            }
          });
          return 22;
        }

        if (normalizedTitle.includes("swot")) {
          const quadrants = [
            ["Strengths", "#042f2e"],
            ["Weaknesses", "#18181b"],
            ["Opportunities", "#0f3f3a"],
            ["Threats", "#1c1917"],
          ];
          const gap = 3;
          const boxWidth = (bodyWidth - gap) / 2;
          const boxHeight = 18;

          quadrants.forEach(([label, color], index) => {
            const x = bodyX + (index % 2) * (boxWidth + gap);
            const boxY = visualY + Math.floor(index / 2) * (boxHeight + gap);
            const snippet = extractSectionSnippet(content, label);
            const bullets = extractBullets(snippet, label).slice(0, 1).join(" ");

            pdf.setFillColor(color);
            pdf.setDrawColor("#334155");
            pdf.roundedRect(x, boxY, boxWidth, boxHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(7.2);
            pdf.setTextColor("#ccfbf1");
            pdf.text(label.toUpperCase(), x + 3, boxY + 5);
            pdf.setFontSize(6.2);
            pdf.setTextColor("#d4d4d8");
            pdf.text(bullets || "Decision factor", x + 3, boxY + 10, {
              maxWidth: boxWidth - 6,
            });
          });

          return 44;
        }

        if (normalizedTitle.includes("founder score")) {
          const labels = founderScoreMetrics.slice(0, 6);
          const itemWidth = (bodyWidth - 10) / 3;

          labels.forEach((label, index) => {
            const x = bodyX + (index % 3) * (itemWidth + 5);
            const itemY = visualY + Math.floor(index / 3) * 15;
            const score = extractScore(content, label) ?? [76, 68, 61, 58, 64, 72][index] ?? 60;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, 12, 2.5, 2.5, "FD");
            pdf.setDrawColor("#5eead4");
            pdf.circle(x + 7, itemY + 6, 4.2, "S");
            pdf.setFontSize(6);
            pdf.setTextColor("#ccfbf1");
            pdf.text(String(score), x + 4.2, itemY + 7.8);
            pdf.setFontSize(6.5);
            pdf.setTextColor("#e4e4e7");
            pdf.text(label, x + 14, itemY + 5, { maxWidth: itemWidth - 17 });
            pdf.setTextColor("#71717a");
            pdf.text("Score", x + 14, itemY + 8.8);
          });

          return 31;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          const selected = detectRecommendation(content) || "DECISION";
          const confidence = extractConfidence(content);
          const investmentNeeded = extractMetricValue(content, "Investment Needed");
          const mainRisk = extractMetricValue(content, "Main Risk");
          const nextAction = extractMetricValue(content, "Next Critical Action");

          pdf.setFillColor("#ccfbf1");
          pdf.setDrawColor("#5eead4");
          pdf.roundedRect(bodyX, visualY, 44, 18, 5, 5, "FD");
          pdf.setFontSize(13);
          pdf.setTextColor("#000000");
          pdf.text(selected, bodyX + 5, visualY + 11.5, { maxWidth: 34 });

          pdf.setFillColor("#27272a");
          pdf.roundedRect(bodyX, visualY + 24, 44, 4, 2, 2, "F");
          pdf.setFillColor("#5eead4");
          pdf.roundedRect(
            bodyX,
            visualY + 24,
            (44 * (confidence ?? 50)) / 100,
            4,
            2,
            2,
            "F"
          );

          const recItems = [
            ["Confidence", confidence === null ? "TBD" : `${confidence}%`],
            ["Investment", investmentNeeded || "Assumption"],
            ["Main Risk", mainRisk || "See risk section"],
            ["Next Action", nextAction || "Validate critical proof point"],
          ];

          recItems.forEach(([label, value], index) => {
            const itemX = bodyX + 52 + (index % 2) * ((bodyWidth - 56) / 2 + 2);
            const itemY = visualY + Math.floor(index / 2) * 13;
            const itemWidth = (bodyWidth - 60) / 2;

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(itemX, itemY, itemWidth, 11, 2.5, 2.5, "FD");
            pdf.setFontSize(6);
            pdf.setTextColor("#71717a");
            pdf.text(label.toUpperCase(), itemX + 2, itemY + 3.2);
            pdf.setTextColor("#e4e4e7");
            pdf.text(value, itemX + 2, itemY + 7.6, { maxWidth: itemWidth - 4 });
          });

          return 36;
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

        if (normalizedTitle.includes("porter")) {
          const forces = ["Rivalry", "Entrants", "Buyer", "Supplier", "Substitutes"];
          const centerX = bodyX + bodyWidth * 0.32;
          const centerY = visualY + 22;

          pdf.setDrawColor("#115e59");
          pdf.circle(centerX, centerY, 20, "S");
          pdf.circle(centerX, centerY, 13, "S");
          pdf.circle(centerX, centerY, 6, "S");
          pdf.setFillColor("#5eead4");
          pdf.circle(centerX, centerY, 2.2, "F");

          forces.forEach((force, index) => {
            const angle = -Math.PI / 2 + (index * 2 * Math.PI) / forces.length;
            const dotX = centerX + Math.cos(angle) * 20;
            const dotY = centerY + Math.sin(angle) * 20;
            const cardX = bodyX + bodyWidth * 0.58;
            const cardY = visualY + index * 8;
            const score = [72, 54, 66, 48, 60][index];

            pdf.setDrawColor("#5eead4");
            pdf.line(centerX, centerY, dotX, dotY);
            pdf.setFillColor("#0f766e");
            pdf.circle(dotX, dotY, 1.8, "F");

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(cardX, cardY, bodyWidth * 0.38, 6, 2, 2, "FD");
            pdf.setFontSize(5.8);
            pdf.setTextColor("#e4e4e7");
            pdf.text(force, cardX + 2, cardY + 4);
            pdf.setFillColor("#27272a");
            pdf.roundedRect(cardX + 22, cardY + 2.2, bodyWidth * 0.24, 1.4, 0.7, 0.7, "F");
            pdf.setFillColor("#5eead4");
            pdf.roundedRect(cardX + 22, cardY + 2.2, (bodyWidth * 0.24 * score) / 100, 1.4, 0.7, 0.7, "F");
          });

          return 46;
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
                      : financialDashboardMetrics;
          const columns = normalizedTitle.includes("financial dashboard") ? 3 : labels.length > 6 ? 4 : labels.length;
          const itemWidth = (bodyWidth - (columns - 1) * 3) / columns;

          labels.forEach((item, index) => {
            const label = typeof item === "string" ? item : item.label;
            const aliases = typeof item === "string" ? [item] : item.aliases;
            const x = bodyX + (index % columns) * (itemWidth + 3);
            const itemHeight = normalizedTitle.includes("financial dashboard") ? 13 : 10;
            const itemY = visualY + Math.floor(index / columns) * (itemHeight + 3);
            const score = extractScore(content, label) ?? [42, 62, 84, 56][index] ?? 60;
            const value = extractMetricValueFromAliases(content, aliases);

            pdf.setFillColor("#18181b");
            pdf.setDrawColor("#27272a");
            pdf.roundedRect(x, itemY, itemWidth, itemHeight, 2.5, 2.5, "FD");
            pdf.setFontSize(6.2);
            pdf.setTextColor("#a1a1aa");
            pdf.text(label, x + 2, itemY + 3.2, { maxWidth: itemWidth - 4 });
            if (normalizedTitle.includes("financial dashboard") && value) {
              pdf.setTextColor("#f4f4f5");
              pdf.setFontSize(7.2);
              pdf.text(value, x + 2, itemY + 8.4, { maxWidth: itemWidth - 4 });
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

          return normalizedTitle.includes("financial dashboard") ? 52 : labels.length > 6 ? 38 : 22;
        }

        return 0;
      };

      const getVisualHeight = (title: string) => {
        const normalizedTitle = title.toLowerCase();

        if (normalizedTitle.includes("financial dashboard")) {
          return 52;
        }

        if (normalizedTitle.includes("swot")) {
          return 44;
        }

        if (normalizedTitle.includes("porter")) {
          return 46;
        }

        if (normalizedTitle.includes("founder score")) {
          return 34;
        }

        if (normalizedTitle.includes("tam / sam / som")) {
          return 22;
        }

        if (normalizedTitle.includes("executive recommendation")) {
          return 36;
        }

        return /founder score|scenario|roadmap|porter|kpi|risk|unit economics/i.test(title)
          ? 22
          : 0;
      };

      report.sections.forEach((section) => {
        const visualHeight = getVisualHeight(section.title);
        const sectionBodyContent = removeDuplicateVisualText(
          section.title,
          section.content
        );
        const bodyLines = pdf.splitTextToSize(
          sectionBodyContent,
          bodyWidth
        ) as string[];
        const safeBodyLines = bodyLines.length > 0 ? bodyLines : [""];
        let lineIndex = 0;

        while (lineIndex < safeBodyLines.length) {
          ensureSpace(38);

          const availableHeight =
            pageHeight - margin - y - cardHeaderHeight - visualHeight - cardBottomPadding;
          const maxLines = Math.max(1, Math.floor(availableHeight / bodyLineHeight));
          const lines = safeBodyLines.slice(lineIndex, lineIndex + maxLines);
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

          pdf.setFontSize(14);
          pdf.setTextColor("#ffffff");
          pdf.text(`${section.title}${isContinued ? " devamı" : ""}`, bodyX, y + 12.5, {
            maxWidth: bodyWidth,
          });

          const drawnVisualHeight = isContinued
            ? 0
            : drawSectionVisual(section.title, section.content, y);

          pdf.setFontSize(8.8);
          pdf.setTextColor("#d4d4d8");
          pdf.text(lines, bodyX, y + 24 + drawnVisualHeight, {
            lineHeightFactor: 1.3,
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
