import { useRef, useState } from "react";
import { Upload, FileSpreadsheet, Sparkles, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { useQA } from "@/lib/qa-store";
import { loadWorkbook, compareWorkbooks } from "@/lib/qa-engine";
import { toast } from "sonner";

interface SlotProps {
  label: string;
  sublabel: string;
  file: File | null;
  onPick: (f: File) => void;
  accent: "indigo" | "emerald";
}

function Slot({ label, sublabel, file, onPick, accent }: SlotProps) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const accentClass = accent === "indigo"
    ? "from-primary/15 to-primary/0 border-primary/40 text-primary"
    : "from-success/15 to-success/0 border-success/40 text-success";
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-xl border-2 border-dashed bg-gradient-to-br p-6 transition ${accentClass} ${drag ? "scale-[1.01]" : ""}`}
      onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault(); setDrag(false);
        const f = e.dataTransfer.files[0];
        if (f) onPick(f);
      }}
    >
      <input
        ref={ref} type="file" accept=".xlsx,.xls,.xlsm" className="hidden"
        onChange={(e) => e.target.files?.[0] && onPick(e.target.files[0])}
      />
      <div className="flex items-start gap-3">
        <div className={`rounded-lg p-2 bg-${accent === "indigo" ? "primary" : "success"}/10`}>
          <FileSpreadsheet className="h-5 w-5" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">{label}</div>
          <div className="text-xs text-muted-foreground">{sublabel}</div>
        </div>
      </div>
      <div className="mt-4">
        {file ? (
          <div className="rounded-md bg-surface-2 px-3 py-2 text-sm font-mono truncate">{file.name}</div>
        ) : (
          <div className="text-xs text-muted-foreground">Drop .xlsx here or click below</div>
        )}
      </div>
      <Button
        size="sm" variant="outline" className="mt-3 w-full"
        onClick={() => ref.current?.click()}
      >
        <Upload className="h-3.5 w-3.5 mr-1" />
        {file ? "Replace file" : "Choose file"}
      </Button>
    </motion.div>
  );
}

export function UploadCard() {
  const { setReport, config, setActiveSheet, employeeName, setEmployeeName } = useQA();
  const [fileA, setFileA] = useState<File | null>(null);
  const [fileB, setFileB] = useState<File | null>(null);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  async function run() {
    if (!fileA || !fileB) {
      toast.error("Upload both Employee and Reviewer workbooks");
      return;
    }
    setRunning(true);
    setProgress("Reading files…");
    try {
      const [bufA, bufB] = await Promise.all([fileA.arrayBuffer(), fileB.arrayBuffer()]);
      setProgress("Parsing workbooks…");
      await new Promise((r) => setTimeout(r, 10));
      const wbA = loadWorkbook(bufA);
      const wbB = loadWorkbook(bufB);
      setProgress(`Comparing ${wbA.SheetNames.length} sheet(s)…`);
      await new Promise((r) => setTimeout(r, 20));
      const report = compareWorkbooks(
        { name: fileA.name, wb: wbA },
        { name: fileB.name, wb: wbB },
        config,
      );
      setReport(report);
      setActiveSheet(report.sheets[0]?.name ?? null);
      toast.success(`Evaluated ${report.sheets.length} sheet(s) — ${report.totals.totalErrors} defect(s)`);
    } catch (err) {
      console.error(err);
      toast.error("Failed to parse workbook. Ensure both are valid Excel files.");
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="h-4 w-4 text-primary" />
        <h2 className="text-base font-semibold">New Evaluation</h2>
      </div>
      <div className="mb-4">
        <label className="text-[11px] uppercase tracking-wide text-muted-foreground font-medium block mb-1.5">
          Employee Name
        </label>
        <input
          type="text"
          value={employeeName}
          onChange={(e) => setEmployeeName(e.target.value)}
          placeholder="e.g. Ahmed Hassan"
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
      </div>
      <div className="grid md:grid-cols-2 gap-4">
        <Slot accent="indigo" label="File A — Employee Submission" sublabel="Worker / participant workbook"
              file={fileA} onPick={setFileA} />
        <Slot accent="emerald" label="File B — Reviewer Reference" sublabel="Auditor / ground-truth workbook"
              file={fileB} onPick={setFileB} />
      </div>
      <Button onClick={run} disabled={running || !fileA || !fileB} className="w-full mt-5">
        {running
          ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{progress ?? "Evaluating…"}</>
          : <><Sparkles className="h-4 w-4 mr-2" /> Run Quality Assurance</>}
      </Button>
      {running && (
        <div className="mt-3">
          <div className="h-1 w-full bg-border rounded-full overflow-hidden">
            <div className="h-1 bg-primary rounded-full animate-pulse w-1/2" />
          </div>
          <p className="text-[11px] text-muted-foreground mt-1.5 text-center">{progress}</p>
        </div>
      )}
    </div>
  );
}
