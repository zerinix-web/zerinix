import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";

import {
  buildAnalysisAssetContext,
  buildAnalysisAssetModelContent,
  getAnalysisAssetValidationError,
  normalizeAnalysisAssets,
} from "../app/lib/ai/analysis-assets.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const chatWorkspace = read("components/AIChatWorkspace.tsx");
const planner = read("components/Planner.tsx");
const useAttachmentsSource = read("components/planner/useAttachments.ts");

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
const PDF_BYTES = Buffer.from("%PDF-1.4\ntest\n");

// Mirrors what serializeAttachmentsForAnalysis() produces for a queued
// attachment, so the client contract is exercised against the real
// server-side validator rather than a restated copy of it.
function serializedAttachment(overrides) {
  return {
    name: "photo.jpg",
    type: "image/jpeg",
    size: JPEG_BYTES.length,
    textContent: "",
    dataUrl: `data:image/jpeg;base64,${JPEG_BYTES.toString("base64")}`,
    ...overrides,
  };
}

test("the serialized chat attachment contract reaches the model as image and file parts", () => {
  const image = serializedAttachment({});
  const pdf = serializedAttachment({
    name: "deck.pdf",
    type: "application/pdf",
    size: PDF_BYTES.length,
    dataUrl: `data:application/pdf;base64,${PDF_BYTES.toString("base64")}`,
  });

  assert.equal(getAnalysisAssetValidationError([image, pdf]), "");

  const assets = normalizeAnalysisAssets([image, pdf]);
  const modelContent = buildAnalysisAssetModelContent(assets);

  assert.deepEqual(modelContent.map((part) => part.type), ["input_image", "input_file"]);
  assert.equal(modelContent[0].image_url, image.dataUrl);
  assert.equal(modelContent[1].filename, "deck.pdf");
  assert.match(buildAnalysisAssetContext(assets), /photo\.jpg/);
});

test("the pre-fix chat payload (no type, no bytes) was rejected before reaching the model", () => {
  // Regression guard for the original bug: the Ask composer sent only
  // name/size/textContent, which the server rejects outright, so no upload
  // could ever be analyzed.
  const legacyPayload = [{ name: "photo.jpg", size: JPEG_BYTES.length, textContent: "" }];

  assert.equal(
    getAnalysisAssetValidationError(legacyPayload),
    "Attachment type is not supported."
  );
  assert.equal(buildAnalysisAssetModelContent(normalizeAnalysisAssets(legacyPayload)).length, 0);
});

test("text attachments still travel as extracted text without binary data", () => {
  const textAsset = serializedAttachment({
    name: "notes.txt",
    type: "text/plain",
    size: 11,
    textContent: "hello world",
    dataUrl: "",
  });

  assert.equal(getAnalysisAssetValidationError([textAsset]), "");

  const assets = normalizeAnalysisAssets([textAsset]);
  assert.equal(buildAnalysisAssetModelContent(assets).length, 0);
  assert.match(buildAnalysisAssetContext(assets), /hello world/);
});

test("unsupported and oversized uploads fail with specific, truthful errors", () => {
  assert.equal(
    getAnalysisAssetValidationError([
      serializedAttachment({ name: "malware.exe", type: "application/x-msdownload", dataUrl: "" }),
    ]),
    "Attachment type is not supported."
  );
  assert.equal(
    getAnalysisAssetValidationError([serializedAttachment({ size: 9_000_000 })]),
    "Attachment is too large."
  );

  // The client blocks the same cases first, with a message naming the file.
  assert.match(useAttachmentsSource, /is not a supported file type/);
  assert.match(useAttachmentsSource, /exceeds the \$\{formatFileSize\(MAX_FILE_SIZE_BYTES\)\} file limit/);
  assert.match(useAttachmentsSource, /Total attachment size cannot exceed/);
});

test("chat and planner share one attachment serialization contract", () => {
  assert.match(useAttachmentsSource, /export function serializeAttachmentsForAnalysis/);
  assert.match(useAttachmentsSource, /type: attachment\.mimeType \|\| ""/);
  assert.match(useAttachmentsSource, /dataUrl: attachment\.dataUrl \|\| ""/);

  // Both composers send every field the validator requires.
  for (const source of [useAttachmentsSource, planner]) {
    for (const field of ["name:", "type:", "size:", "textContent:", "dataUrl:"]) {
      assert.ok(source.includes(field), `missing ${field} in serialized attachment`);
    }
  }

  assert.match(chatWorkspace, /attachments: serializeAttachmentsForAnalysis\(currentAttachments\)/);
  assert.doesNotMatch(
    chatWorkspace,
    /attachments: currentAttachments\.map\(\(attachment\) => \(\{\s*name: attachment\.name,\s*size: attachment\.size,\s*textContent/
  );
});

test("the Ask composer reads real files through the shared hook and guards unreadable ones", () => {
  assert.match(chatWorkspace, /useAttachments\(\{ createId: createMessageId \}\)/);
  assert.match(chatWorkspace, /accept=\{ATTACHMENT_ACCEPT_ATTRIBUTE\}/);
  assert.match(chatWorkspace, /attachments\.some\(\(attachment\) => attachment\.status !== "ready"\)/);
  assert.match(chatWorkspace, /\{attachmentError\}/);
  // The composer must not keep its own weaker text-only reader.
  assert.doesNotMatch(chatWorkspace, /async function readAttachmentText/);
});

test("regenerate reuses the original binary attachments instead of dropping them", () => {
  assert.match(
    chatWorkspace,
    /const currentAttachments = addToHistory\s*\?\s*attachments\s*:\s*lastRequestAttachmentsRef\.current\.conversationId === conversationId\s*\?\s*lastRequestAttachmentsRef\.current\.attachments\s*:\s*\[\]/
  );
  assert.match(
    chatWorkspace,
    /lastRequestAttachmentsRef\.current = \{\s*conversationId,\s*attachments: currentAttachments,\s*\}/
  );
  // The kept binaries are per conversation, never a component-wide bucket.
  assert.match(chatWorkspace, /conversationId: string;\s*attachments: PlannerAttachment\[\];/);
});

test("raw file bytes are never written to the conversation history", () => {
  const persistStart = chatWorkspace.indexOf("async function persistMessage");
  const persistEnd = chatWorkspace.indexOf("async function updatePersistedMessage", persistStart);
  const persistSource = chatWorkspace.slice(persistStart, persistEnd);

  assert.match(persistSource, /attachments: message\.attachments \|\| \[\]/);
  assert.doesNotMatch(persistSource, /dataUrl/);

  const userMessageStart = chatWorkspace.indexOf("const userMessage: ChatMessage");
  const userMessageSource = chatWorkspace.slice(userMessageStart, userMessageStart + 700);

  assert.match(userMessageSource, /mimeType: attachment\.mimeType \|\| ""/);
  assert.doesNotMatch(userMessageSource, /dataUrl/);
});

test("iOS declares the media permissions the in-app file picker needs", () => {
  const plist = read("ios/App/App/Info.plist");

  assert.match(plist, /<key>NSCameraUsageDescription<\/key>/);
  assert.match(plist, /<key>NSPhotoLibraryUsageDescription<\/key>/);
});
