"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

export type PlannerAttachment = {
  id: string;
  name: string;
  size: number;
  mimeType?: string;
  textContent?: string;
  dataUrl?: string;
  fingerprint?: string;
  status?: "processing" | "ready" | "error";
  progress?: number;
  error?: string;
};

const MAX_FILES = 6;
const MAX_FILE_SIZE_BYTES = 5_000_000;
const MAX_TOTAL_SIZE_BYTES = 12_000_000;

const acceptedMimeTypesByExtension: Record<string, string[]> = {
  pdf: ["application/pdf"],
  doc: ["application/msword", "application/octet-stream"],
  docx: [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/octet-stream",
  ],
  ppt: ["application/vnd.ms-powerpoint", "application/octet-stream"],
  pptx: [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/octet-stream",
  ],
  xls: ["application/vnd.ms-excel", "application/octet-stream"],
  xlsx: [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream",
  ],
  csv: ["text/csv", "application/csv", "text/plain"],
  tsv: ["text/tab-separated-values", "text/plain"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/plain"],
  json: ["application/json", "text/plain"],
  zip: ["application/zip", "application/x-zip-compressed", "application/octet-stream"],
  png: ["image/png"],
  jpg: ["image/jpeg"],
  jpeg: ["image/jpeg"],
  webp: ["image/webp"],
  gif: ["image/gif"],
  heic: ["image/heic", "image/heif"],
  avif: ["image/avif"],
};

function sanitizeClientFileName(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]+/g, "-")
    .trim()
    .slice(0, 180);
}

function getExtension(name: string) {
  return name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] || "";
}

function formatFileSize(bytes: number) {
  return bytes >= 1_000_000
    ? `${(bytes / 1_000_000).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1_000))} KB`;
}

function validateSelectedFile(file: File) {
  const name = sanitizeClientFileName(file.name);
  const extension = getExtension(name);
  const acceptedMimeTypes = acceptedMimeTypesByExtension[extension];
  const mimeType = file.type.trim().toLowerCase();

  if (!name || !acceptedMimeTypes) {
    return `"${file.name}" is not a supported file type.`;
  }

  if (!mimeType || !acceptedMimeTypes.includes(mimeType)) {
    return `"${file.name}" has a file type that does not match its extension.`;
  }

  if (file.size <= 0) {
    return `"${file.name}" is empty.`;
  }

  if (file.size > MAX_FILE_SIZE_BYTES) {
    return `"${file.name}" exceeds the ${formatFileSize(MAX_FILE_SIZE_BYTES)} file limit.`;
  }

  return "";
}

async function readAttachmentText(file: File) {
  const textLike =
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|tsv|json)$/i.test(file.name);

  if (!textLike || file.size > 220_000) {
    return "";
  }

  try {
    return (await file.text()).slice(0, 20_000);
  } catch (error) {
    console.error("[attachment text read failed]", error);
    return "";
  }
}

async function readAttachmentDataUrl(file: File) {
  const textLike =
    file.type.startsWith("text/") ||
    /\.(txt|md|csv|tsv|json)$/i.test(file.name);

  if (textLike || file.size > 5_000_000) {
    return "";
  }

  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => {
      console.error("[attachment binary read failed]", reader.error);
      resolve("");
    };
    reader.readAsDataURL(file);
  });
}

function logProcessedAttachments(
  point: string,
  attachments: PlannerAttachment[],
  sourceFiles: File[] = []
) {
  if (process.env.NODE_ENV === "production") {
    return;
  }

  console.info(`[planner:attachment-trace] ${point}`, {
    attachmentCount: attachments.length,
    attachments: attachments.map((attachment, index) => ({
      filename: attachment.name,
      mimeType: attachment.mimeType || "",
      objectKeys: Object.keys(attachment),
      hasFile: sourceFiles[index] instanceof File,
      hasBlob: sourceFiles[index] instanceof Blob,
      hasUploadedReference: Boolean(attachment.dataUrl),
      hasBinaryDataUrl: Boolean(attachment.dataUrl),
      hasTextContent: Boolean(attachment.textContent),
    })),
  });
}

export function useAttachments({ createId }: { createId: () => string }) {
  const [attachments, setAttachments] = useState<PlannerAttachment[]>([]);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [attachmentError, setAttachmentError] = useState("");
  const attachmentsRef = useRef<PlannerAttachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

  async function handleFiles(files: FileList | null) {
    if (!files) {
      return [] as PlannerAttachment[];
    }

    setAttachmentError("");
    const currentAttachments = attachmentsRef.current;
    const existingFingerprints = new Set(
      currentAttachments.map(
        (attachment) =>
          attachment.fingerprint ||
          `${attachment.name.toLocaleLowerCase("en-US")}:${attachment.size}`
      )
    );
    const errors: string[] = [];
    const acceptedFiles: Array<{ file: File; fingerprint: string; id: string; name: string }> = [];
    let totalSize = currentAttachments.reduce(
      (sum, attachment) => sum + attachment.size,
      0
    );

    for (const file of Array.from(files)) {
      if (currentAttachments.length + acceptedFiles.length >= MAX_FILES) {
        errors.push(`You can attach up to ${MAX_FILES} files per request.`);
        break;
      }

      const validationError = validateSelectedFile(file);
      if (validationError) {
        errors.push(validationError);
        continue;
      }

      const name = sanitizeClientFileName(file.name);
      const fingerprint = `${name.toLocaleLowerCase("en-US")}:${file.size}:${file.lastModified}`;

      if (
        existingFingerprints.has(fingerprint) ||
        acceptedFiles.some((item) => item.fingerprint === fingerprint)
      ) {
        errors.push(`"${name}" is already attached.`);
        continue;
      }

      if (totalSize + file.size > MAX_TOTAL_SIZE_BYTES) {
        errors.push(
          `Total attachment size cannot exceed ${formatFileSize(MAX_TOTAL_SIZE_BYTES)}.`
        );
        continue;
      }

      acceptedFiles.push({
        file,
        fingerprint,
        id: createId(),
        name,
      });
      totalSize += file.size;
    }

    if (errors.length > 0) {
      setAttachmentError([...new Set(errors)].join(" "));
    }

    if (acceptedFiles.length === 0) {
      return [] as PlannerAttachment[];
    }

    const processingAttachments: PlannerAttachment[] = acceptedFiles.map(
      ({ file, fingerprint, id, name }) => ({
        id,
        name,
        size: file.size,
        mimeType: file.type,
        fingerprint,
        status: "processing",
        progress: 15,
      })
    );

    setAttachments((current) => [...current, ...processingAttachments]);

    const uploadedFiles = await Promise.all(
      acceptedFiles.map(async ({ file, fingerprint, id, name }) => {
        const [textContent, dataUrl] = await Promise.all([
          readAttachmentText(file),
          readAttachmentDataUrl(file),
        ]);
        const binaryRequired = !(
          file.type.startsWith("text/") ||
          /\.(txt|md|csv|tsv|json)$/i.test(file.name)
        );
        const failed = binaryRequired && !dataUrl;

        return {
          id,
          name,
          size: file.size,
          mimeType: file.type,
          textContent,
          dataUrl,
          fingerprint,
          status: failed ? ("error" as const) : ("ready" as const),
          progress: failed ? 0 : 100,
          error: failed ? "This file could not be read. Remove it and try again." : "",
        };
      })
    );

    logProcessedAttachments(
      "POINT_1_FILE_PICKER_PROCESSED",
      uploadedFiles,
      acceptedFiles.map((item) => item.file)
    );
    setAttachments((current) => {
      const uploadedById = new Map(
        uploadedFiles.map((attachment) => [attachment.id, attachment])
      );
      const queuedAttachments = current.map(
        (attachment) => uploadedById.get(attachment.id) || attachment
      );
      logProcessedAttachments(
        "POINT_2_QUEUED_STATE_UPDATED",
        queuedAttachments
      );
      return queuedAttachments;
    });

    return uploadedFiles;
  }

  async function handleDropFiles(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setIsDraggingFiles(false);

    return handleFiles(event.dataTransfer.files);
  }

  return {
    attachments,
    setAttachments,
    attachmentError,
    setAttachmentError,
    isDraggingFiles,
    setIsDraggingFiles,
    handleFiles,
    handleDropFiles,
  };
}
