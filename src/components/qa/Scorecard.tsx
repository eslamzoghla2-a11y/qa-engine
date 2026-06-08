import { useQA } from "@/lib/qa-store";
import { motion } from "framer-motion";
import { TrendingUp, AlertOctagon, Clock, Layers, FileWarning } from "lucide-react";

function Stat({ icon: Icon, label, value, sub, tone = "default" }: {
  icon: any; label: string; value: string; sub?: string;
  tone?: "default" | "good" | "warn" | "bad";
}) {
  const toneCls = {
    default: "text-foreground",
    good: "text-success",
    warn: "text-medium",
    bad: "text-critical",
  }[tone];
  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      className="rounded-xl bg-surface border border-border p-4 shadow-sm"
    >
      <div className="flex items-center justify-between">
        <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className={`h-4 w-4 ${toneCls}`} />
      </div>
      <div className={`mt-2 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      {sub && <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>}
    </motion.div>
  );
}

const GRADE_TONE: Record<string, "good" | "warn" | "bad" | "default"> = {
  Outstanding: "good", Excellent: "good", "Very Good": "good", Good: "good",
  Fair: "warn", "Needs Improvement": "warn", Poor: "bad",
};

export function Scorecard() {
  const { report, employeeName } = useQA();
  if (!report) return null;
  const t = report.totals;
  const grade = report.grade;
  const tone = GRADE_TONE[grade.label] ?? "default";

  return (
    <div className="space-y-4">
      <div className="rounded-2xl bg-gradient-to-br from-primary/10 via-surface to-surface border border-border p-6 shadow-sm">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            {employeeName && (
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Employee</div>
            )}
            {employeeName && (
              <div className="text-lg font-semibold text-foreground mb-2">{employeeName}</div>
            )}
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">Performance Grade</div>
            <div className={`text-4xl font-bold tracking-tight mt-1 ${
              tone === "good" ? "text-success" : tone === "warn" ? "text-medium" : tone === "bad" ? "text-critical" : ""
            }`}>{grade.label}</div>
            <div className="text-sm text-muted-foreground mt-1">
              Tier {grade.tier} of 7 · {report.sheets.length} sheets evaluated
              {report.strictMode && <span className="ml-2 inline-flex items-center rounded-full bg-medium/15 text-medium px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">Strict Mode</span>}
            </div>
          </div>
          <div className="flex items-baseline gap-2">
            <div className="text-5xl font-bold tabular-nums tracking-tight">{t.baseAccuracy.toFixed(2)}</div>
            <div className="text-lg text-muted-foreground">%</div>
            <div className="ml-2 text-xs text-muted-foreground">accuracy</div>
          </div>
        </div>
        {grade.rationale.length > 1 && (
          <ul className="mt-4 space-y-1 text-xs text-muted-foreground">
            {grade.rationale.slice(1).map((r, i) => (
              <li key={i} className="flex items-center gap-1.5">
                <AlertOctagon className="h-3 w-3 text-medium" /> {r}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <Stat icon={Layers} label="Compared Cells" value={t.comparedCells.toLocaleString()} />
        <Stat icon={FileWarning} label="Total Errors" value={t.totalErrors.toLocaleString()}
              tone={t.totalErrors > 0 ? "warn" : "good"} />
        <Stat icon={TrendingUp} label="Penalty Points" value={t.totalPenalty.toLocaleString()}
              tone={t.totalPenalty > 50 ? "bad" : t.totalPenalty > 10 ? "warn" : "good"} />
        <Stat icon={AlertOctagon} label="Error / 10k" value={t.errorRatePer10k.toFixed(1)} />
        <Stat icon={Clock} label="Workload" value={`${t.workloadHours.toFixed(1)}h`}
              sub="reviewer remediation" />
      </div>
    </div>
  );
}
