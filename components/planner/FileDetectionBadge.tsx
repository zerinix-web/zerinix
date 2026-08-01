import { FileImage, FileSpreadsheet, FileText, Link2 } from "lucide-react";
import type { DetectedFile, IntentRecommendation } from "./IntentDetector";

function FileKindIcon({ file }: { file: DetectedFile }) {
  if (file.kind === "image") {
    return <FileImage className="h-3.5 w-3.5 shrink-0 text-teal-200" />;
  }

  if (file.kind === "spreadsheet" || file.kind === "financial-spreadsheet") {
    return <FileSpreadsheet className="h-3.5 w-3.5 shrink-0 text-teal-200" />;
  }

  return <FileText className="h-3.5 w-3.5 shrink-0 text-teal-200" />;
}

export function FileDetectionBadge({
  file,
}: {
  file: DetectedFile;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.055] px-3 py-1.5 text-xs text-zinc-300">
      <FileKindIcon file={file} />
      <span className="truncate">{file.label}</span>
    </span>
  );
}

export function UrlDetectionBadge({
  detectedUrl,
}: {
  detectedUrl: NonNullable<IntentRecommendation["detectedUrl"]>;
}) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-white/[0.055] px-3 py-1.5 text-xs text-zinc-300">
      <Link2 className="h-3.5 w-3.5 shrink-0 text-teal-200" />
      <span className="truncate">{detectedUrl.label}</span>
      <span className="truncate text-zinc-600">{detectedUrl.hostname}</span>
    </span>
  );
}
