import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  createUniversalDocumentIntelligenceFallback,
  documentDomainValues,
  universalDocumentIntelligenceSchema,
} from "../app/lib/ai/universal-document-intelligence.ts";

const planRouteSource = await readFile(
  new URL("../app/api/plan/route.ts", import.meta.url),
  "utf8"
);

test("documentDomainValues contains exactly the required categories", () => {
  assert.deepEqual(
    [...documentDomainValues].sort(),
    [
      "Legal",
      "Financial",
      "Business",
      "Medical",
      "Technical",
      "Engineering",
      "Real Estate",
      "HR",
      "Government",
      "Academic",
      "Contract",
      "Spreadsheet",
      "Unknown",
    ].sort()
  );
});

test("a financial document is classified Financial with purpose, entities, risks, decisions, obligations, and evidence populated", () => {
  const asset = {
    name: "q3_report.pdf",
    mimeType: "application/pdf",
    textContent: `Subject: Q3 2024 Financial Statement Review

FINANCIAL SUMMARY

This report presents the balance sheet and income statement for Acme Corporation for the period ending September 30, 2024.

Prepared by John Smith, Chief Financial Officer, and reviewed by the Acme Corporation audit committee on 2024-10-15.

Revenue for the quarter was $4,500,000, an increase of 12%. There is a material risk of currency exposure given international operations. The board approved the quarterly budget on October 15, 2024.

The company is required to submit quarterly filings to the Ministry of Finance. Evidence supporting these figures is attached as Exhibit A, including bank statements and audited ledgers.`,
  };

  const result = createUniversalDocumentIntelligenceFallback({ assets: [asset] });
  assert.equal(universalDocumentIntelligenceSchema.safeParse(result).success, true);

  assert.equal(result.documentDomain, "Financial");
  assert.ok(result.domainConfidence >= 0.65);
  assert.equal(result.documentPurpose, "Q3 2024 Financial Statement Review");
  assert.ok(result.documentStructure.headings.includes("FINANCIAL SUMMARY"));
  assert.ok(result.entities.people.includes("John Smith"));
  assert.ok(!result.entities.people.some((p) => /officer|chief|statement|review/i.test(p)));
  assert.ok(result.entities.organizations.includes("Acme Corporation"));
  assert.ok(result.entities.dates.includes("2024-10-15"));
  assert.ok(result.entities.numbers.includes("$4,500,000"));
  assert.ok(result.risks.some((r) => /risk of currency exposure/i.test(r)));
  assert.ok(result.decisions.some((d) => /board approved/i.test(d)));
  assert.ok(result.obligations.some((o) => /required to submit/i.test(o)));
  assert.ok(result.evidence.some((e) => /attached as exhibit a/i.test(e)));
});

test("a medical document is classified Medical and does not cross line breaks when extracting names", () => {
  const asset = {
    name: "discharge.pdf",
    textContent: `Patient: Jane Doe
Physician: Dr. Robert Chen

Diagnosis: Type 2 Diabetes Mellitus. The patient was prescribed a treatment plan including dosage adjustments. Discharge summary prepared at Mercy General Hospital on 2024-05-01.`,
  };

  const result = createUniversalDocumentIntelligenceFallback({ assets: [asset] });
  assert.equal(universalDocumentIntelligenceSchema.safeParse(result).success, true);
  assert.equal(result.documentDomain, "Medical");
  assert.ok(result.entities.people.includes("Jane Doe"));
  assert.ok(result.entities.people.includes("Robert Chen"));
  assert.ok(!result.entities.people.some((p) => p.includes("\n")));
  assert.ok(result.entities.organizations.includes("Mercy General Hospital"));
  assert.ok(result.entities.dates.includes("2024-05-01"));
});

test("a spreadsheet attachment is classified Spreadsheet from its file type regardless of content", () => {
  const result = createUniversalDocumentIntelligenceFallback({
    assets: [
      {
        name: "inventory.xlsx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        textContent: "SKU,Name,Qty\n1,Widget,10\n2,Gadget,20",
      },
    ],
  });

  assert.equal(result.documentDomain, "Spreadsheet");
  assert.equal(result.documentStructure.hasTabularData, true);
});

test("a Yargıtay-style legal decision is still classified generically (Legal), not routed through the legal-specific pipeline", () => {
  const result = createUniversalDocumentIntelligenceFallback({
    assets: [
      {
        name: "decision.jpg",
        mimeType: "image/jpeg",
        textContent:
          "The Court of Appeal reviewed the plaintiff's litigation against the defendant and issued its verdict following testimony and jurisdiction review by counsel.",
      },
    ],
  });

  assert.equal(result.documentDomain, "Legal");
});

test("no attachment produces an Unknown, schema-valid, empty result", () => {
  const result = createUniversalDocumentIntelligenceFallback({ assets: [] });
  assert.equal(universalDocumentIntelligenceSchema.safeParse(result).success, true);
  assert.equal(result.documentDomain, "Unknown");
  assert.equal(result.domainConfidence, 0);
  assert.ok(result.missingInformation.length > 0);
});

test("low-signal text is marked Unknown with missing-information notes rather than guessed", () => {
  const result = createUniversalDocumentIntelligenceFallback({
    assets: [{ name: "notes.txt", textContent: "Some unrelated notes about groceries and travel plans." }],
  });

  assert.equal(result.documentDomain, "Unknown");
  assert.ok(result.missingInformation.length > 0);
});

test("app/api/plan/route.ts wires the universal layer right after attachment parsing, before the legal-specific layers", () => {
  const attachmentValidationIndex = planRouteSource.indexOf("attachmentValidationError");
  const universalCallIndex = planRouteSource.indexOf(
    "createUniversalDocumentIntelligenceFallback({"
  );
  const layer1Index = planRouteSource.indexOf("classifyAttachmentDocument({");

  assert.ok(attachmentValidationIndex > -1 && universalCallIndex > -1 && layer1Index > -1);
  assert.ok(attachmentValidationIndex < universalCallIndex);
  assert.ok(universalCallIndex < layer1Index);
  assert.match(
    planRouteSource,
    /const universalDocumentIntelligence = createUniversalDocumentIntelligenceFallback/
  );
  assert.match(
    planRouteSource,
    /body\.universalDocumentIntelligence = universalDocumentIntelligence;/
  );
});

test("the universal layer never reads or writes body.analysisMode", () => {
  const startIndex = planRouteSource.indexOf(
    "createUniversalDocumentIntelligenceFallback({"
  );
  const endMarker = "body.universalDocumentIntelligence = universalDocumentIntelligence;";
  const endIndex = planRouteSource.indexOf(endMarker, startIndex) + endMarker.length;
  const statementSource = planRouteSource.slice(startIndex, endIndex);

  assert.ok(startIndex > -1 && endIndex > startIndex);
  assert.doesNotMatch(statementSource, /analysisMode/);
});

test("layer 4 does not touch report generation, PDF generation, or Business Intelligence logic", () => {
  const forbiddenPaths = [
    "app/lib/pdf-engine",
    "app/lib/report-engine",
    "app/lib/billing",
    "app/lib/ai/market-analysis",
    "app/lib/ai/adaptive-report-writer",
    "app/lib/decision-intelligence/",
  ];

  for (const path of forbiddenPaths) {
    assert.doesNotMatch(planRouteSource, new RegExp(path.replace(/\//g, "\\/")));
  }
});
