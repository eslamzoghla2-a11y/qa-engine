import { useQA } from "@/lib/qa-store";
import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Search, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

const SEV_BADGE: Record<string, string> = {
  CRITICAL: "bg-critical text-white",
  HIGH: "bg-high text-white",
  HEADER: "bg-info text-white",
  MEDIUM: "bg-medium text-black",
  LOW: "bg-low text-black",
};

export function ErrorTable() {
  const { report } = useQA();
  const [q, setQ] = useState("");
  const [sev, setSev] = useState<string>("ALL");

  const all = useMemo(() => report?.sheets.flatMap((s) => s.errors) ?? [], [report]);
  const filtered = useMemo(() => {
    return all.filter((e) => {
      if (sev !== "ALL" && e.severity !== sev) return false;
      if (q) {
        const t = q.toLowerCase();
        return e.sheet.toLowerCase().includes(t) || e.cellRef.toLowerCase().includes(t)
          || e.errorClass.toLowerCase().includes(t)
          || e.expected.toLowerCase().includes(t) || e.actual.toLowerCase().includes(t);
      }
      return true;
    });
  }, [all, q, sev]);

  if (!report) return null;

  function downloadCSV() {
    const headers = ["Sheet", "Cell", "Row", "Col", "Severity", "Class", "Penalty", "Expected", "Actual", "IsHeader"];
    const rows = filtered.map((e) => [
      e.sheet, e.cellRef, e.row + 1, e.col + 1, e.severity, e.errorClass, e.penalty,
      JSON.stringify(e.expected), JSON.stringify(e.actual), e.isHeader ? "Y" : "",
    ].join(","));
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `qa-defects-${Date.now()}.csv`; a.click();
  }

  return (
    <div className="rounded-2xl bg-surface border border-border shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 p-4 border-b border-border">
        <h3 className="text-sm font-semibold">Defect Ledger</h3>
        <span className="text-xs text-muted-foreground">{filtered.length} of {all.length}</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input className="pl-7 h-8 w-56 text-xs" placeholder="Search cell, value, sheet…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select value={sev} onChange={(e) => setSev(e.target.value)}
            className="h-8 px-2 rounded-md border border-border bg-surface text-xs">
            <option value="ALL">All severities</option>
            <option>CRITICAL</option><option>HIGH</option><option>HEADER</option>
            <option>MEDIUM</option><option>LOW</option>
          </select>
          <Button size="sm" variant="outline" onClick={downloadCSV} className="h-8">
            <Download className="h-3.5 w-3.5 mr-1" /> CSV
          </Button>
        </div>
      </div>
      <div className="overflow-auto max-h-96">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 sticky top-0">
            <tr className="text-left">
              <Th>Sheet</Th><Th>Cell</Th><Th>Severity</Th><Th>Class</Th>
              <Th>Expected</Th><Th>Actual</Th><Th className="text-right">Pen</Th>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, 500).map((e, i) => (
              <tr key={i} className="border-t border-border hover:bg-surface-2/60">
                <Td className="font-medium">{e.sheet}</Td>
                <Td className="font-mono text-muted-foreground">{e.cellRef}</Td>
                <Td>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${SEV_BADGE[e.severity]}`}>
                    {e.severity}
                  </span>
                </Td>
                <Td>{e.errorClass}</Td>
                <Td className="font-mono max-w-[200px] truncate" title={e.expected}>{e.expected || "∅"}</Td>
                <Td className="font-mono max-w-[200px] truncate text-critical" title={e.actual}>{e.actual || "∅"}</Td>
                <Td className="text-right tabular-nums font-semibold">{e.penalty}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 500 && (
          <div className="p-2 text-center text-xs text-muted-foreground border-t border-border bg-surface-2">
            Showing first 500 of {filtered.length} — export CSV for full list.
          </div>
        )}
        {filtered.length === 0 && (
          <div className="p-6 text-center text-sm text-muted-foreground">No defects match the current filter.</div>
        )}
      </div>
    </div>
  );
}

function Th({ children, className = "" }: { children: any; className?: string }) {
  return <th className={`px-3 py-2 font-medium text-muted-foreground ${className}`}>{children}</th>;
}
function Td({ children, className = "" }: { children: any; className?: string }) {
  return <td className={`px-3 py-2 ${className}`}>{children}</td>;
}
