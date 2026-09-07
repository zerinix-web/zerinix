"use client";

// TASK #69A-19 -- PERFORMANCE FIX. ROOT CAUSE (confirmed live): page.tsx
// (a Server Component) statically imported ReportPdfButton.tsx, which in
// turn statically imports jsPDF (a 664KB minified chunk, plus its own
// pako compression dependency) and several other PDF-only computation
// modules at its own top level. That eagerly bundled the entire PDF
// export machinery into the client JS every /dashboard/[id] page load
// had to fetch/parse/execute, even for the ~99% of visits that never
// click "Download PDF" -- confirmed by inspecting the real page
// response: a plain, eagerly-loaded <script src="...jspdf..."> tag was
// present on every load.
//
// `next/dynamic(..., { ssr: false })` is the correct fix (it, unlike a
// bare `dynamic()` call, actually defers BOTH the server render AND the
// client chunk fetch until the component is truly needed) -- but Next's
// App Router refuses `ssr: false` directly inside a Server Component
// ("`ssr: false` is not allowed with `next/dynamic` in Server
// Components. Please move it into a Client Component."). This file is
// that required Client Component boundary: a deliberately tiny,
// dependency-free wrapper that page.tsx (a Server Component) can import
// ordinarily, while the actual heavy chunk stays lazily loaded behind
// it.
import dynamic from "next/dynamic";
import type { DashboardReport } from "../report-utils";

const ReportPdfButton = dynamic(() => import("./ReportPdfButton"), {
  ssr: false,
});

export default function ReportPdfButtonLazy({
  report,
}: {
  report: DashboardReport;
}) {
  return <ReportPdfButton report={report} />;
}
