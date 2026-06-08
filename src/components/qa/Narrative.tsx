import { useQA } from "@/lib/qa-store";
import { buildNarrative, buildCoaching } from "@/lib/qa-engine";
import { GraduationCap, BookOpen, Zap, Copy, MapPin, Repeat } from "lucide-react";

const PRIORITY_TONE: Record<string, string> = {
  CRITICAL: "border-critical/40 bg-critical/5 text-critical",
  HIGH: "border-high/40 bg-high/5 text-high",
  HEADER: "border-info/40 bg-info/5 text-info",
  MEDIUM: "border-medium/40 bg-medium/5 text-medium",
  LOW: "border-low/40 bg-low/5 text-low",
};

export function Narrative() {
  const { report } = useQA();
  if (!report) return null;
  const md = buildNarrative(report);
  // Simple markdown render (paragraphs + headers + bold + list)
  const html = md
    .split("\n\n").map((block) => {
      if (block.startsWith("## ")) return `<h2 class="text-lg font-semibold mt-1">${esc(block.slice(3))}</h2>`;
      if (block.startsWith("### ")) return `<h3 class="text-sm font-semibold mt-3 uppercase tracking-wide text-muted-foreground">${esc(block.slice(4))}</h3>`;
      if (block.startsWith("> ")) return `<blockquote class="border-l-2 border-medium pl-3 italic text-medium">${inline(block.slice(2))}</blockquote>`;
      if (block.startsWith("- ")) return `<ul class="space-y-1 list-disc pl-5">${block.split("\n").map(l => `<li>${inline(l.slice(2))}</li>`).join("")}</ul>`;
      return `<p class="leading-relaxed">${inline(block)}</p>`;
    }).join("");
  return (
    <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <BookOpen className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">AI Auditor Evaluation</h3>
      </div>
      <div className="prose prose-sm max-w-none text-sm space-y-3" dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}
function esc(s: string) { return s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]!)); }
function inline(s: string) { return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>"); }

export function Coaching() {
  const { report } = useQA();
  if (!report) return null;
  const recs = buildCoaching(report);
  if (!recs.length) {
    return (
      <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <GraduationCap className="h-4 w-4 text-success" />
          <h3 className="text-sm font-semibold">Coaching Recommendations</h3>
        </div>
        <div className="text-sm text-muted-foreground">No targeted coaching needed — submission is clean.</div>
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <GraduationCap className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Coaching Recommendations</h3>
        <span className="text-xs text-muted-foreground ml-1">· Auto-generated from dominant error patterns</span>
      </div>
      <div className="grid md:grid-cols-2 gap-3">
        {recs.map((r, i) => (
          <div key={i} className={`rounded-xl border p-4 ${PRIORITY_TONE[r.priority] ?? ""}`}>
            <div className="flex items-center gap-2 mb-1.5">
              <Zap className="h-3.5 w-3.5" />
              <div className="font-semibold text-sm">{r.title}</div>
              <span className="ml-auto text-[10px] font-bold uppercase tracking-wider">{r.priority}</span>
            </div>
            <p className="text-xs text-foreground/80 leading-relaxed">{r.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Patterns() {
  const { report } = useQA();
  if (!report) return null;
  const p = report.patterns;
  const empty = !p.copyPaste.length && !p.clusters.length && !p.digitSwaps.length;
  if (empty) return null;
  return (
    <div className="rounded-2xl bg-surface border border-border p-6 shadow-sm">
      <div className="flex items-center gap-2 mb-4">
        <Repeat className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Systematic Patterns</h3>
      </div>
      <div className="grid md:grid-cols-3 gap-4">
        <PatternBlock icon={Copy} label="Copy-Paste Errors" items={p.copyPaste.map((c) => ({
          primary: `"${c.value}"`, secondary: `${c.count}×`,
        }))} />
        <PatternBlock icon={MapPin} label="Error Clusters" items={p.clusters.map((c) => ({
          primary: `${c.sheet} · rows ${c.rowStart + 1}–${c.rowEnd + 1}`, secondary: `${c.count} errs`,
        }))} />
        <PatternBlock icon={Repeat} label="Digit Swap Trends" items={p.digitSwaps.map((s) => ({
          primary: `${s.from} → ${s.to}`, secondary: `${s.count}×`,
        }))} />
      </div>
    </div>
  );
}

function PatternBlock({ icon: Icon, label, items }: { icon: any; label: string; items: { primary: string; secondary: string }[] }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
        <Icon className="h-3 w-3" /> {label}
      </div>
      {items.length === 0 ? (
        <div className="text-xs text-muted-foreground">None detected</div>
      ) : (
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex items-center justify-between gap-2 text-xs bg-surface-2 rounded-md px-2.5 py-1.5">
              <span className="font-mono truncate">{it.primary}</span>
              <span className="text-muted-foreground tabular-nums">{it.secondary}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
