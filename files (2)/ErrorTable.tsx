import { useQA } from "@/lib/qa-store";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Download, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ErrorRecord } from "@/lib/qa-engine";

const SEV_BADGE: Record<string, string> = {
  CRITICAL: "bg-critical text-white",
  HIGH: "bg-high text-white",
  HEADER: "bg-info text-white",
  MEDIUM: "bg-medium text-black",
  LOW: "bg-low text-black",
};

const SEV_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, HEADER: 2, MEDIUM: 3, LOW: 4 };

type SortKey = "sheet" | "cellRef" | "severity" | "errorClass" | "similarityPct" | "penalty";
type SortDir = "asc" | "desc";

function DiffHighlight({ expected, actual }: { expected: string; actual: string }) {
  // Character-level diff highlight for short strings
  if (!expected || !actual || expected.length > 80 || actual.length > 80) {
    return <span className="text-critical font-mono">{actual || "∅"}</span>;
  }
  const maxLen = Math.max(expected.length, actual.length);
  const chars = Array.from({ length: maxLen }, (_, i) => ({
    ch: actual[i] ?? "",
    diff: actual[i] !== expected[i],
  }));
  return (
    <span className="font-mono">
      {chars.map((c, i) =>
        c.diff
          ? <mark key={i} className="bg-critical/25 text-critical rounded-sm px-px">{c.ch || "∅"}</mark>
          : <span key={i}>{c.ch}</span>
      )}
    </span>
  );
}

export function ErrorTable() {
  const { report } = useQA();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<string>("ALL");
  const [errType, setErrType] = useState<string>("ALL");
  const [sortKey, setSortKey] = useState<SortKey>("severity");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [showNorm, setShowNorm] = useState(false);

  const all = useMemo(() => report?.sheets.flatMap((s) => s.errors) ?? [], [report]);

  const errorTypes = useMemo(() => {
    const types = new Set(all.map((e) => e.errorClass));
    return Array.from(types).sort();
  }, [all]);

  const filtered = useMemo(() => {
    let rows = all.filter((e) => {
      if (sev !== "ALL" && e.severity !== sev) return false;
      if (errType !== "ALL" && e.errorClass !== errType) return false;
      if (q) {
        const t = q.toLowerCase();
        return e.sheet.toLowerCase().includes(t) || e.cellRef.toLowerCase().includes(t)
          || e.errorClass.toLowerCase().includes(t)
          || e.expected.toLowerCase().includes(t) || e.actual.toLowerCase().includes(t);
      }
      return true;
    });

    rows = [...rows].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "severity") cmp = (SEV_ORDER[a.severity] ?? 9) - (SEV_ORDER[b.severity] ?? 9);
      else if (sortKey === "penalty") cmp = a.penalty - b.penalty;
      else if (sortKey === "similarityPct") cmp = (a.similarityPct ?? 100) - (b.similarityPct ?? 100);
      else cmp = String(a[sortKey]).localeCompare(String(b[sortKey]));
      return sortDir === "asc" ? cmp : -cmp;
    });

    return rows;
  }, [all, q, sev, errType, sortKey, sortDir]);

  if (!report) return null;

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
  }

  function SortIcon({ k }: { k: SortKey }) {
    if (sortKey !== k) return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 text-primary" />
      : <ChevronDown className="h-3 w-3 text-primary" />;
  }

  function downloadCSV() {
    // spec: Detailed Error Log fields
    const headers = [
      "Sheet", "Cell", "Employee Value", "Reviewer Value",
      "Normalized Employee", "Normalized Reviewer",
      "Similarity %", "Error Type", "Severity", "Penalty", "Notes",
    ];
    const rows = all.map((e: ErrorRecord) => [
      e.sheet, e.cellRef,
      JSON.stringify(e.actual), JSON.stringify(e.expected),
      JSON.stringify(e.normalizedActual ?? ""), JSON.stringify(e.normalizedExpected ?? ""),
      e.similarityPct ?? "",
      e.errorClass, e.severity, e.penalty,
      JSON.stringify(e.note ?? ""),
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qa-defects-${Date.now()}.csv`; a.click();
  }

  const TRUNCATE = 50;
  const displayed = filtered.slice(0, 500);
  const truncated = all.length > TRUNCATE && filtered.length > TRUNCATE;

  return (
    <div className="rounded-2xl bg-surface border border-border shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
        <h3 className="text-sm font-semibold">Defect Ledger</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} of {all.length}</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7 h-8 w-44 text-xs" placeholder="Search…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={sev} onChange={(e) => setSev(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-surface text-xs">
            <option value="ALL">All severities</option>
            <option>CRITICAL</option><option>HIGH</option><option>HEADER</option>
            <option>MEDIUM</option><option>LOW</option>
          </select>
          <select value={errType} onChange={(e) => setErrType(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-surface text-xs max-w-[160px]">
            <option value="ALL">All types</option>
            {errorTypes.map((t) => <option key={t}>{t}</option>)}
          </select>
          <Button size="sm" variant="outline" className="h-8 text-xs"
            onClick={() => setShowNorm((v) => !v)}>
            {showNorm ? "Hide" : "Show"} Normalized
          </Button>
          <Button size="sm" variant="outline" onClick={downloadCSV} className="h-8">
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>
      </div>

      {truncated && (
        <div className="px-4 py-2 bg-medium/10 border-b border-medium/20 text-xs text-medium">
          [Truncated: showing first {TRUNCATE} of {filtered.length} errors — export CSV for full list. Metrics use all {all.length} errors.]
        </div>
      )}

      <div className="overflow-auto max-h-[480px]">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 sticky top-0 z-10">
            <tr className="text-left">
              <Th sortable onClick={() => toggleSort("sheet")}>Sheet <SortIcon k="sheet" /></Th>
              <Th sortable onClick={() => toggleSort("cellRef")}>Cell <SortIcon k="cellRef" /></Th>
              <Th sortable onClick={() => toggleSort("severity")}>Severity <SortIcon k="severity" /></Th>
              <Th sortable onClick={() => toggleSort("errorClass")}>Type <SortIcon k="errorClass" /></Th>
              <Th>Reviewer (Expected)</Th>
              <Th>Employee (Actual)</Th>
              {showNorm && <><Th>Norm. Expected</Th><Th>Norm. Actual</Th></>}
              <Th sortable onClick={() => toggleSort("similarityPct")}>Sim% <SortIcon k="similarityPct" /></Th>
              <Th sortable onClick={() => toggleSort("penalty")} className="text-right">Pen <SortIcon k="penalty" /></Th>
            </tr>
          </thead>
          <tbody>
            {displayed.map((e, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2/60">
                <Td className="font-medium max-w-[120px] truncate" title={e.sheet}>{e.sheet}</Td>
                <Td className="font-mono text-muted-foreground">{e.cellRef}</Td>
                <Td>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEV_BADGE[e.severity]}`}>
                    {e.severity}
                  </span>
                </Td>
                <Td className="max-w-[140px] truncate" title={e.errorClass}>{e.errorClass}</Td>
                <Td className="font-mono max-w-[180px] truncate text-muted-foreground" title={e.expected}>
                  {e.expected || "∅"}
                </Td>
                <Td className="max-w-[180px] truncate" title={e.actual}>
                  <DiffHighlight expected={e.expected} actual={e.actual} />
                </Td>
                {showNorm && (
                  <>
                    <Td className="font-mono max-w-[140px] truncate text-muted-foreground" title={e.normalizedExpected}>
                      {e.normalizedExpected || "∅"}
                    </Td>
                    <Td className="font-mono max-w-[140px] truncate text-muted-foreground" title={e.normalizedActual}>
                      {e.normalizedActual || "∅"}
                    </Td>
                  </>
                )}
                <Td className="tabular-nums text-center">
                  <span className={`text-[11px] font-semibold ${
                    (e.similarityPct ?? 100) >= 80 ? "text-medium" : "text-critical"
                  }`}>{e.similarityPct ?? "—"}%</span>
                </Td>
                <Td className="text-right tabular-nums font-semibold">{e.penalty}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No defects match the current filter.</div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = "", sortable, onClick }: {
  children: any; className?: string; sortable?: boolean; onClick?: () => void;
}) {
  return (
    <th
      className={`px-3 py-2 font-medium text-muted-foreground whitespace-nowrap ${
        sortable ? "cursor-pointer select-none hover:text-foreground" : ""
      } ${className}`}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">{children}</span>
    </th>
  );
}
function Td({ children, className = "", title }: { children: any; className?: string; title?: string }) {
  return <td className={`px-3 py-2 ${className}`} title={title}>{children}</td>;
}
