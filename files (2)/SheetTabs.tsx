import { useMemo, useState } from "react";
import { useQA } from "@/lib/qa-store";
import { colLetter } from "@/lib/qa-engine";
import type { SheetReport, ErrorRecord } from "@/lib/qa-engine";
import { AlertTriangle, Eye } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";

const MAX_ROWS = 150;
const MAX_COLS = 35;

const SEVERITY_CLASS: Record<string, string> = {
  CRITICAL: "bg-critical text-white",
  HIGH: "bg-high text-white",
  HEADER: "bg-info text-white",
  MEDIUM: "bg-medium text-black",
  LOW: "bg-low text-black",
};

export function SheetTabs() {
  const { report, activeSheet, setActiveSheet } = useQA();
  if (!report) return null;
  if (report.sheets.length === 0) {
    return (
      <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm text-sm text-muted-foreground">
        No comparable sheets found.
      </div>
    );
  }
  const sheet = report.sheets.find((s) => s.name === activeSheet) ?? report.sheets[0];
  return (
    <div className="rounded-2xl bg-surface border border-border shadow-sm overflow-hidden">
      <div className="flex flex-wrap gap-1 border-b border-border bg-surface-2 px-3 py-2">
        {report.sheets.map((s) => {
          const isActive = s.name === sheet.name;
          const total = s.errors.length;
          return (
            <button
              key={s.name}
              onClick={() => setActiveSheet(s.name)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                isActive ? "bg-primary text-primary-foreground shadow-sm"
                         : "hover:bg-accent text-foreground"
              }`}
            >
              <span className="truncate max-w-[140px]">{s.name}</span>
              {total > 0 && (
                <span className={`tabular-nums text-[10px] px-1.5 rounded ${
                  isActive ? "bg-white/20" : "bg-critical/15 text-critical"
                }`}>{total}</span>
              )}
            </button>
          );
        })}
        {report.excludedSheets.map((s) => (
          <span key={s.name} className="px-3 py-1.5 rounded-md text-xs font-medium text-muted-foreground line-through opacity-60" title={s.reason}>
            {s.name}
          </span>
        ))}
      </div>
      <SheetView sheet={sheet} />
    </div>
  );
}

function SheetView({ sheet }: { sheet: SheetReport }) {
  const [view, setView] = useState<"employee" | "reviewer">("employee");
  const errorMap = useMemo(() => {
    const m = new Map<string, ErrorRecord>();
    for (const e of sheet.errors) {
      if (e.errorClass !== "Row Shift" && e.errorClass !== "Column Shift") {
        m.set(`${e.row},${e.col}`, e);
      }
    }
    return m;
  }, [sheet]);

  // Grid Inspector metrics (spec)
  const metrics = useMemo(() => {
    const structural = ["Missing Row","Extra Row","Missing Column","Extra Column","Missing Cell","Extra Cell","Local Row Misalignment","Local Column Misalignment"];
    const shiftTypes = ["Row Shift","Column Shift"];
    const rangeTypes = ["Range Inversion","Range Boundary","Range Representation"];
    const numericTypes = ["Missing Digit","Extra Digit","Digit Substitution","Digit Transposition","Numeric Difference"];
    const textTypes = ["Text Typo","Major Text Difference","Minor Variation"];
    const headerTypes = ["Header Mismatch"];
    let structuralCount = 0, shiftCount = 0, rangeCount = 0, numericCount = 0, textCount = 0, headerCount = 0;
    for (const e of sheet.errors) {
      if (structural.includes(e.errorClass)) structuralCount++;
      else if (shiftTypes.includes(e.errorClass)) shiftCount++;
      else if (rangeTypes.includes(e.errorClass)) rangeCount++;
      else if (numericTypes.includes(e.errorClass)) numericCount++;
      else if (textTypes.includes(e.errorClass)) textCount++;
      else if (headerTypes.includes(e.errorClass)) headerCount++;
    }
    const accuracy = sheet.comparedCells
      ? ((sheet.comparedCells - sheet.errors.length) / sheet.comparedCells * 100).toFixed(1)
      : "100.0";
    return { structuralCount, shiftCount, rangeCount, numericCount, textCount, headerCount, accuracy };
  }, [sheet]);

  const totalRows = Math.max(sheet.gridA.length, sheet.gridB.length);
  const totalCols = sheet.colCount;
  const rows = Math.min(totalRows, MAX_ROWS);
  const cols = Math.min(totalCols, MAX_COLS);
  const cropped = totalRows > MAX_ROWS || totalCols > MAX_COLS;
  const grid = view === "employee" ? sheet.gridA : sheet.gridB;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-border bg-surface">
        <div className="flex items-center gap-3 text-xs">
          <div className="font-semibold text-sm">{sheet.name}</div>
          <span className="text-muted-foreground">·</span>
          <span className="text-muted-foreground tabular-nums">
            {sheet.comparedCells.toLocaleString()} cells · {sheet.errors.length} defects · {metrics.accuracy}% accuracy
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-md border border-border bg-surface-2 p-0.5">
            {(["employee", "reviewer"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)}
                className={`px-2.5 py-1 text-xs font-medium rounded ${
                  view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground"
                }`}>
                {v === "employee" ? "File A" : "File B"}
              </button>
            ))}
          </div>
          <Legend />
        </div>
      </div>

      {/* Grid Inspector breakdown (spec) */}
      <div className="grid grid-cols-3 md:grid-cols-6 gap-px bg-border border-b border-border text-[10px]">
        {[
          { label: "Structural", value: metrics.structuralCount, tone: metrics.structuralCount > 0 ? "text-critical" : "text-muted-foreground" },
          { label: "Shift", value: metrics.shiftCount, tone: metrics.shiftCount > 0 ? "text-critical" : "text-muted-foreground" },
          { label: "Range", value: metrics.rangeCount, tone: metrics.rangeCount > 0 ? "text-high" : "text-muted-foreground" },
          { label: "Numeric", value: metrics.numericCount, tone: metrics.numericCount > 0 ? "text-medium" : "text-muted-foreground" },
          { label: "Text", value: metrics.textCount, tone: metrics.textCount > 0 ? "text-medium" : "text-muted-foreground" },
          { label: "Header", value: metrics.headerCount, tone: metrics.headerCount > 0 ? "text-info" : "text-muted-foreground" },
        ].map((m) => (
          <div key={m.label} className="bg-surface-2 px-3 py-2 flex items-center justify-between">
            <span className="text-muted-foreground uppercase tracking-wider font-medium">{m.label}</span>
            <span className={`font-semibold tabular-nums ${m.tone}`}>{m.value}</span>
          </div>
        ))}
      </div>

      {cropped && (
        <div className="flex items-center gap-2 px-4 py-2 bg-medium/10 border-b border-medium/20 text-xs text-medium">
          <Eye className="h-3.5 w-3.5" />
          Visual viewport cropped to {rows}×{cols}. Metrics still computed across full {totalRows}×{totalCols}.
        </div>
      )}
      <div className="overflow-auto max-h-[600px]">
        <table className="text-xs font-mono border-separate border-spacing-0">
          <thead className="sticky top-0 z-10 bg-surface-2">
            <tr>
              <th className="sticky left-0 z-20 bg-surface-2 border-b border-r border-border px-2 py-1 text-muted-foreground font-normal w-12">#</th>
              {Array.from({ length: cols }).map((_, c) => (
                <th key={c} className="border-b border-r border-border px-2 py-1 text-muted-foreground font-medium min-w-[120px]">
                  {colLetter(c)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }).map((_, r) => (
              <tr key={r}>
                <td className="sticky left-0 z-10 bg-surface-2 border-b border-r border-border px-2 py-1 text-muted-foreground tabular-nums w-12 text-right">
                  {r + 1}
                </td>
                {Array.from({ length: cols }).map((_, c) => {
                  const key = `${r},${c}`;
                  const err = errorMap.get(key);
                  const isShift = sheet.shiftCells.has(key);
                  const isHeader = r < sheet.headerRows;
                  const val = grid[r]?.[c] ?? "";
                  return (
                    <Cell key={c} err={err} isShift={isShift} isHeader={isHeader} value={String(val)} />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Cell({ err, isShift, isHeader, value }: { err?: ErrorRecord; isShift: boolean; isHeader: boolean; value: string }) {
  let cls = "border-b border-r border-border px-2 py-1 truncate max-w-[200px] ";
  if (err) cls += "grid-cell-error ";
  else if (isShift) cls += "grid-cell-shift ";
  else if (isHeader) cls += "grid-cell-header ";
  const td = <td className={cls} title={value}>{value || <span className="text-muted-foreground/40">·</span>}</td>;
  if (!err) return td;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>{td}</TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <div className="font-semibold mb-1 flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-critical" />
            {err.errorClass}
            <span className={`ml-auto px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEVERITY_CLASS[err.severity]}`}>{err.severity}</span>
          </div>
          <div className="space-y-0.5 font-mono">
            <div><span className="text-muted-foreground">Expected:</span> {err.expected || "∅"}</div>
            <div><span className="text-muted-foreground">Actual:</span> {err.actual || "∅"}</div>
            {err.normalizedExpected !== err.expected && (
              <div><span className="text-muted-foreground">Norm. Expected:</span> {err.normalizedExpected || "∅"}</div>
            )}
            {err.normalizedActual !== err.actual && (
              <div><span className="text-muted-foreground">Norm. Actual:</span> {err.normalizedActual || "∅"}</div>
            )}
            <div><span className="text-muted-foreground">Similarity:</span> {err.similarityPct ?? "—"}%</div>
            <div><span className="text-muted-foreground">Penalty:</span> {err.penalty}</div>
          </div>
          {err.note && <div className="text-medium mt-1.5">{err.note}</div>}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function Legend() {
  return (
    <div className="hidden md:flex items-center gap-2 text-[10px] text-muted-foreground">
      <Swatch className="grid-cell-error" label="Mismatch" />
      <Swatch className="grid-cell-shift" label="Shift" />
      <Swatch className="grid-cell-header" label="Header" />
    </div>
  );
}
function Swatch({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={`inline-block w-3 h-3 rounded-sm ${className}`} />
      {label}
    </span>
  );
}
