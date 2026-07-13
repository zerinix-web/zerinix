"use client";

import { Download, FileText } from "lucide-react";

type ExportTable = {
  id: string;
  title: string;
  columns: string[];
  rows: string[][];
};

function escapeCsvCell(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function exportCsv(table: ExportTable) {
  const rows = [table.columns, ...table.rows]
    .map((row) => row.map((cell) => escapeCsvCell(String(cell))).join(","))
    .join("\n");

  downloadFile(`${table.id}.csv`, rows, "text/csv;charset=utf-8");
}

function exportPdf(table: ExportTable) {
  const rows = table.rows.length
    ? table.rows
        .map(
          (row) =>
            `<tr>${row.map((cell) => `<td>${escapeHtml(String(cell))}</td>`).join("")}</tr>`
        )
        .join("")
    : `<tr><td colspan="${table.columns.length}">No records available.</td></tr>`;
  const html = `<!doctype html>
<html>
<head>
  <title>${table.title}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 24px; margin-bottom: 16px; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; vertical-align: top; }
    th { background: #111827; color: white; }
  </style>
</head>
<body>
  <h1>${escapeHtml(table.title)}</h1>
  <table>
    <thead><tr>${table.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("")}</tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.print();</script>
</body>
</html>`;
  const printWindow = window.open("", "_blank");

  if (!printWindow) {
    downloadFile(`${table.id}.html`, html, "text/html;charset=utf-8");
    return;
  }

  printWindow.opener = null;
  printWindow.document.write(html);
  printWindow.document.close();
}

export function AdminExports({ tables }: { tables: ExportTable[] }) {
  return (
    <section className="mt-6 rounded-[1.45rem] border border-white/10 bg-white/[0.045] p-5 shadow-[0_20px_80px_rgba(0,0,0,0.24)] backdrop-blur-xl">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-white">Analytics exports</h2>
          <p className="mt-1.5 text-sm text-zinc-500">Download every analytics table as CSV or print-ready PDF.</p>
        </div>
        <span className="rounded-full border border-white/10 bg-black/25 px-3 py-1 text-xs text-zinc-500">
          {tables.length} tables
        </span>
      </div>

      <div className="mt-5 grid gap-3.5 md:grid-cols-2 xl:grid-cols-3">
        {tables.map((table) => (
          <div key={table.id} className="rounded-[1.1rem] border border-white/10 bg-black/25 p-4 transition duration-300 hover:-translate-y-0.5 hover:border-purple-300/20 hover:bg-white/[0.04]">
            <p className="font-semibold text-white">{table.title}</p>
            <p className="mt-1 text-xs text-zinc-500">{table.rows.length} rows</p>
            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => exportCsv(table)}
                className="inline-flex h-9 items-center gap-2 rounded-[0.85rem] border border-purple-300/20 bg-purple-400/10 px-3 text-xs font-semibold text-purple-100 transition duration-300 hover:border-purple-300/35 hover:bg-purple-400/15 hover:text-white"
              >
                <Download className="h-3.5 w-3.5" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => exportPdf(table)}
                className="inline-flex h-9 items-center gap-2 rounded-[0.85rem] border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-zinc-300 transition duration-300 hover:border-purple-300/30 hover:text-white"
              >
                <FileText className="h-3.5 w-3.5" />
                PDF
              </button>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
