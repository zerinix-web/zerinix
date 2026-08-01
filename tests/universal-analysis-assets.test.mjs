import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { strToU8, zipSync } from "fflate";
import {
  buildAnalysisAssetContext,
  buildAnalysisProviderInput,
  createAnalysisAssetFingerprint,
  extractAnalysisUrls,
  getAnalysisAssetValidationError,
  normalizeAnalysisAssets,
  shouldUseAnalysisWebResearch,
} from "../app/lib/ai/analysis-assets.ts";

const imageAsset = {
  name: "site.png",
  type: "image/png",
  size: 1,
  textContent: "",
  dataUrl: "data:image/png;base64,eA==",
};

const pdfAsset = {
  name: "business-plan.pdf",
  type: "application/pdf",
  size: 4,
  textContent: "",
  dataUrl: "data:application/pdf;base64,JVBERg==",
};

test("universal assets preserve multiple files and route images and documents correctly", () => {
  assert.equal(getAnalysisAssetValidationError([imageAsset, pdfAsset]), "");

  const assets = normalizeAnalysisAssets([imageAsset, pdfAsset]);
  const input = buildAnalysisProviderInput("Analyze these assets.", assets);

  assert.equal(assets.length, 2);
  assert.equal(Array.isArray(input), true);
  assert.equal(input[0].content[1].type, "input_image");
  assert.equal(input[0].content[2].type, "input_file");
  assert.equal(input[0].content[2].filename, "business-plan.pdf");
  assert.match(buildAnalysisAssetContext(assets), /site\.png/);
  assert.match(buildAnalysisAssetContext(assets), /business-plan\.pdf/);
});

test("ZIP and text assets use the same bounded validation contract", () => {
  const zipBytes = zipSync({
    "evidence/metrics.txt": strToU8("ARR 240000\nGross margin 72%"),
  });
  const zipAsset = {
    name: "evidence.zip",
    type: "application/zip",
    size: zipBytes.byteLength,
    textContent: "",
    dataUrl: `data:application/zip;base64,${Buffer.from(zipBytes).toString("base64")}`,
  };
  const textAsset = {
    name: "notes.txt",
    type: "text/plain",
    size: 12,
    textContent: "Revenue 120",
    dataUrl: "",
  };

  assert.equal(getAnalysisAssetValidationError([zipAsset, textAsset]), "");
  assert.match(
    buildAnalysisAssetContext(normalizeAnalysisAssets([zipAsset, textAsset])),
    /Revenue 120/
  );
  assert.match(
    buildAnalysisAssetContext(normalizeAnalysisAssets([zipAsset])),
    /Gross margin 72%/
  );
  assert.equal(
    getAnalysisAssetValidationError([{ ...imageAsset, url: "https://example.com" }]),
    "Attachment metadata is invalid."
  );
});

test("URL and research intent automatically enable web context", () => {
  assert.deepEqual(
    extractAnalysisUrls(
      "Compare https://example.com/listing and www.example.org/company."
    ),
    ["https://example.com/listing", "https://www.example.org/company"]
  );
  assert.equal(
    shouldUseAnalysisWebResearch("Review https://example.com/listing"),
    true
  );
  assert.equal(shouldUseAnalysisWebResearch("What is gross margin?"), false);
  assert.equal(shouldUseAnalysisWebResearch("Analyze this", [pdfAsset]), false);
  assert.equal(
    shouldUseAnalysisWebResearch("Compare this with current market data", [
      pdfAsset,
    ]),
    true
  );
});

test("asset fingerprints prevent cross-file report cache reuse", () => {
  const first = createAnalysisAssetFingerprint([imageAsset]);
  const second = createAnalysisAssetFingerprint([
    { ...imageAsset, dataUrl: "data:image/png;base64,eQ==" },
  ]);

  assert.notEqual(first, second);
  assert.equal(first.length, 64);
});
