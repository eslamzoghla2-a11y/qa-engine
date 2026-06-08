// Quality Assurance Engine — Excel comparison
// Implements the full specification: normalization, classification, scoring.

import * as XLSX from "xlsx";

export type Severity = "CRITICAL" | "HIGH" | "HEADER" | "MEDIUM" | "LOW";
export type ErrorClass =
  | "Row Shift"
  | "Column Shift"
  | "Missing Value"
  | "Extra Value"
  | "Range Inversion"
  | "Range Boundary"
  | "Range Representation"
  | "Missing Digit"
  | "Extra Digit"
  | "Digit Transposition"
  | "Digit Substitution"
  | "Major Numeric Error"
  | "Text Typo"
  | "Major Text Difference"
  | "Header Mismatch"
  | "Minor Variation";

export interface ErrorRecord {
  sheet: string;
  row: number;
  col: number;
  cellRef: string;
  expected: string;
  actual: string;
  errorClass: ErrorClass;
  severity: Severity;
  penalty: number;
  isHeader: boolean;
  note?: string;
}

export interface SheetReport {
  name: string;
  rowCount: number;
  colCount: number;
  comparedCells: number;
  headerRows: number;
  errors: ErrorRecord[];
  shiftCells: Set<string>; // "r,c"
  excluded?: { reason: string };
  gridA: string[][];
  gridB: string[][];
}

export interface QAConfig {
  numericMajorVariance: number; // 0.2
  numericMajorAbsolute: number; // 100
  numericTolerance: number; // 0.01
  numericToleranceMode: "PERCENTAGE" | "ABSOLUTE";
  minimumShiftCells: number; // 20
  shiftDetectionThreshold: number; // 0.8
  headerPenalty: number; // 3
  strictMode: "AUTO" | "ON" | "OFF";
}

export const DEFAULT_CONFIG: QAConfig = {
  numericMajorVariance: 0.2,
  numericMajorAbsolute: 100,
  numericTolerance: 0.01,
  numericToleranceMode: "PERCENTAGE",
  minimumShiftCells: 20,
  shiftDetectionThreshold: 0.8,
  headerPenalty: 3,
  strictMode: "AUTO",
};

export const SEVERITY_PENALTY: Record<Severity, number> = {
  CRITICAL: 10,
  HIGH: 5,
  HEADER: 3,
  MEDIUM: 2,
  LOW: 1,
};

// ---------- Normalization ----------

const ARABIC_DIACRITICS = /[\u064B-\u0652\u0670\u0640]/g;
const EASTERN_ARABIC = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN_DIGITS = "۰۱۲۳۴۵۶۷۸۹";

export function normalizeArabic(s: string): string {
  return s
    .replace(/[أإآ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .replace(ARABIC_DIACRITICS, "");
}

export function normalizeDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => {
    const e = EASTERN_ARABIC.indexOf(d);
    if (e >= 0) return String(e);
    const p = PERSIAN_DIGITS.indexOf(d);
    if (p >= 0) return String(p);
    return d;
  });
}

export function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  let s = String(v);
  s = s.replace(/[\u00A0\u200B-\u200D\uFEFF]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  s = normalizeDigits(s);
  s = normalizeArabic(s);
  return s;
}

export function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || String(v).trim() === "";
}

export function tryParseNumber(s: string): number | null {
  if (s === "") return null;
  const cleaned = s.replace(/,/g, "").replace(/^0+(?=\d)/, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

const RANGE_RE = /^(\d+)\s*[\/\-]\s*(\d+)$/;
export function parseRange(s: string): [string, string, string] | null {
  const m = s.match(RANGE_RE);
  if (!m) return null;
  const sep = s.includes("/") ? "/" : "-";
  return [m[1], m[2], sep];
}

// ---------- Similarity ----------

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (!maxLen) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ---------- Digit-level classifiers ----------

function classifyNumeric(a: string, b: string, cfg: QAConfig): {
  cls: ErrorClass;
  severity: Severity;
} {
  // a = actual (worker), b = expected (reviewer)
  const an = tryParseNumber(a);
  const bn = tryParseNumber(b);
  if (an !== null && bn !== null) {
    const diff = Math.abs(an - bn);
    const variance = bn !== 0 ? diff / Math.abs(bn) : diff > 0 ? 1 : 0;
    if (variance > cfg.numericMajorVariance || diff > cfg.numericMajorAbsolute) {
      return { cls: "Major Numeric Error", severity: "HIGH" };
    }
  }
  // Digit pattern checks operate on digit-only strings
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  if (da && db) {
    if (da.length === db.length - 1 && db.includes(da)) {
      return { cls: "Missing Digit", severity: "MEDIUM" };
    }
    if (da.length === db.length + 1 && da.includes(db)) {
      return { cls: "Extra Digit", severity: "MEDIUM" };
    }
    if (da.length === db.length) {
      // transposition: exactly two adjacent swaps
      let diffIdx: number[] = [];
      for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diffIdx.push(i);
      if (diffIdx.length === 2 && diffIdx[1] === diffIdx[0] + 1 &&
          da[diffIdx[0]] === db[diffIdx[1]] && da[diffIdx[1]] === db[diffIdx[0]]) {
        return { cls: "Digit Transposition", severity: "MEDIUM" };
      }
      if (diffIdx.length === 1) {
        return { cls: "Digit Substitution", severity: "MEDIUM" };
      }
    }
  }
  return { cls: "Major Numeric Error", severity: "HIGH" };
}

function classifyRange(a: string, b: string): {
  cls: ErrorClass; severity: Severity;
} | null {
  const ra = parseRange(a);
  const rb = parseRange(b);
  if (!rb) return null;
  if (!ra) {
    return { cls: "Range Representation", severity: "HIGH" };
  }
  if (ra[0] === rb[1] && ra[1] === rb[0]) {
    return { cls: "Range Inversion", severity: "MEDIUM" };
  }
  if (ra[0] === rb[0] || ra[1] === rb[1]) {
    return { cls: "Range Boundary", severity: "HIGH" };
  }
  if (ra[2] !== rb[2]) {
    return { cls: "Range Representation", severity: "HIGH" };
  }
  return { cls: "Range Boundary", severity: "HIGH" };
}

function classifyText(a: string, b: string): {
  cls: ErrorClass; severity: Severity;
} {
  const sim = similarity(a, b);
  if (sim >= 0.9) return { cls: "Text Typo", severity: "MEDIUM" };
  return { cls: "Major Text Difference", severity: "HIGH" };
}

// ---------- Sheet exclusion ----------

// Every sheet is audited — including تعريف / Def / فهرس / Index — because
// reviewers have flagged data-entry mistakes inside those auxiliary tabs too.
// We only skip sheets that are physically empty (no comparable cells).
export function shouldExcludeSheet(_name: string, rowCount: number): string | null {
  if (rowCount < 1) return "Sheet is empty";
  return null;
}

// ---------- Sheet loader ----------

export function loadWorkbook(buffer: ArrayBuffer): XLSX.WorkBook {
  return XLSX.read(buffer, { type: "array", cellDates: false });
}

export function sheetToGrid(ws: XLSX.WorkSheet): string[][] {
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, defval: "", blankrows: true, raw: true,
  });
  // Propagate merged cells
  const merges = ws["!merges"] ?? [];
  const grid: string[][] = aoa.map((row) => row.map((c) => (c === null || c === undefined ? "" : String(c))));
  for (const m of merges) {
    const root = grid[m.s.r]?.[m.s.c] ?? "";
    for (let r = m.s.r; r <= m.e.r; r++) {
      if (!grid[r]) grid[r] = [];
      for (let c = m.s.c; c <= m.e.c; c++) {
        grid[r][c] = root;
      }
    }
  }
  // Trim trailing empty rows
  while (grid.length && grid[grid.length - 1].every((v) => isEmpty(v))) grid.pop();
  return grid;
}

// ---------- Header detection ----------

function detectHeaderRows(grid: string[][]): number {
  // Look at first 5 rows; count which contain mostly text (non-numeric)
  let headerRows = 0;
  for (let r = 0; r < Math.min(5, grid.length); r++) {
    const row = grid[r] ?? [];
    const cells = row.filter((v) => !isEmpty(v));
    if (cells.length === 0) continue;
    const textCount = cells.filter((v) => tryParseNumber(normalizeText(v)) === null).length;
    if (textCount / cells.length >= 0.6) headerRows = r + 1;
    else break;
  }
  return Math.max(headerRows, 1);
}

// ---------- Shift detection (light heuristic) ----------

function detectShifts(
  gridA: string[][], gridB: string[][], cfg: QAConfig,
): Set<string> {
  const shiftCells = new Set<string>();
  const rows = Math.max(gridA.length, gridB.length);
  // Detect ROW shifts: compare row r of A vs row r-1, r+1 of B
  for (let r = 0; r < rows; r++) {
    const rowA = gridA[r] ?? [];
    for (const offset of [-1, 1, -2, 2]) {
      const rowB = gridB[r + offset];
      if (!rowB) continue;
      const len = Math.min(rowA.length, rowB.length);
      if (len < cfg.minimumShiftCells) continue;
      let matches = 0, compared = 0;
      for (let c = 0; c < len; c++) {
        if (isEmpty(rowA[c]) && isEmpty(rowB[c])) continue;
        compared++;
        if (normalizeText(rowA[c]) === normalizeText(rowB[c])) matches++;
      }
      if (compared >= cfg.minimumShiftCells && matches / compared >= cfg.shiftDetectionThreshold) {
        for (let c = 0; c < len; c++) shiftCells.add(`${r},${c}`);
      }
    }
  }
  // Detect COLUMN shifts
  const cols = Math.max(...gridA.map((r) => r.length), ...gridB.map((r) => r.length), 0);
  for (let c = 0; c < cols; c++) {
    for (const offset of [-1, 1, -2, 2]) {
      const c2 = c + offset;
      if (c2 < 0) continue;
      let matches = 0, compared = 0;
      const len = Math.min(gridA.length, gridB.length);
      for (let r = 0; r < len; r++) {
        const a = gridA[r]?.[c] ?? "";
        const b = gridB[r]?.[c2] ?? "";
        if (isEmpty(a) && isEmpty(b)) continue;
        compared++;
        if (normalizeText(a) === normalizeText(b)) matches++;
      }
      if (compared >= cfg.minimumShiftCells && matches / compared >= cfg.shiftDetectionThreshold) {
        for (let r = 0; r < len; r++) shiftCells.add(`${r},${c}`);
      }
    }
  }
  return shiftCells;
}

// ---------- Core comparison ----------

export function colLetter(n: number): string {
  let s = "";
  n = n + 1;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function compareSheet(
  name: string, gridA: string[][], gridB: string[][], cfg: QAConfig, strict: boolean,
): SheetReport {
  const headerRows = detectHeaderRows(gridB.length ? gridB : gridA);
  const shiftCells = detectShifts(gridA, gridB, cfg);
  const rows = Math.max(gridA.length, gridB.length);
  const cols = Math.max(
    ...gridA.map((r) => r.length), ...gridB.map((r) => r.length), 0,
  );
  let compared = 0;
  const errors: ErrorRecord[] = [];

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const rawA = gridA[r]?.[c] ?? "";
      const rawB = gridB[r]?.[c] ?? "";
      const ea = isEmpty(rawA), eb = isEmpty(rawB);
      if (ea && eb) continue;
      compared++;
      const isHeader = r < headerRows;
      const key = `${r},${c}`;

      // Priority 1: shift
      if (shiftCells.has(key)) {
        // Don't add to error list (shift is reported separately as cell tint)
        // But represent as a single placeholder record for severity tally:
        continue;
      }

      const a = normalizeText(rawA);
      const b = normalizeText(rawB);
      if (a === b) continue;

      // Numeric tolerance check before classifying as defect
      const an = tryParseNumber(a), bn = tryParseNumber(b);
      if (an !== null && bn !== null && !strict) {
        const diff = Math.abs(an - bn);
        const tol = cfg.numericToleranceMode === "PERCENTAGE"
          ? Math.abs(bn) * cfg.numericTolerance
          : cfg.numericTolerance;
        if (diff <= tol) continue;
      }

      let rec: { cls: ErrorClass; severity: Severity; note?: string };

      // Priority 2: missing/extra
      if (ea && !eb) rec = { cls: "Missing Value", severity: "HIGH" };
      else if (!ea && eb) rec = { cls: "Extra Value", severity: "HIGH" };
      else {
        // Priority 3: range
        const rangeR = (parseRange(a) || parseRange(b)) ? classifyRange(a, b) : null;
        if (rangeR) rec = rangeR;
        else if (an !== null || bn !== null) {
          // Priority 4: numeric
          rec = classifyNumeric(a, b, cfg);
        } else {
          // Priority 5: text
          rec = classifyText(a, b);
        }
      }

      // Header override
      if (isHeader) {
        rec = {
          cls: "Header Mismatch",
          severity: "HEADER",
          note: "Header error — may affect interpretation of entire column",
        };
      }

      const penalty = isHeader ? cfg.headerPenalty : SEVERITY_PENALTY[rec.severity];

      errors.push({
        sheet: name, row: r, col: c,
        cellRef: `${colLetter(c)}${r + 1}`,
        expected: String(rawB), actual: String(rawA),
        errorClass: rec.cls, severity: rec.severity, penalty,
        isHeader, note: rec.note,
      });
    }
  }

  // Add shift count as CRITICAL aggregate (one error per shifted block — simplified to one per shift cell group)
  if (shiftCells.size > 0) {
    // Group contiguous shift coords into blocks for cleaner counting
    const blocks = groupShiftBlocks(shiftCells);
    for (const blk of blocks) {
      errors.push({
        sheet: name, row: blk.row, col: blk.col,
        cellRef: `${colLetter(blk.col)}${blk.row + 1}`,
        expected: `(${blk.size} cells)`, actual: `${blk.kind} shift block`,
        errorClass: blk.kind === "row" ? "Row Shift" : "Column Shift",
        severity: "CRITICAL",
        penalty: SEVERITY_PENALTY.CRITICAL,
        isHeader: false,
      });
    }
  }

  return {
    name, rowCount: rows, colCount: cols, comparedCells: compared,
    headerRows, errors, shiftCells, gridA, gridB,
  };
}

function groupShiftBlocks(cells: Set<string>): Array<{ row: number; col: number; size: number; kind: "row" | "col" }> {
  // Simple: group by row, then by col — emit one block per row containing shifts
  const byRow = new Map<number, number[]>();
  for (const k of cells) {
    const [r, c] = k.split(",").map(Number);
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(c);
  }
  const blocks: Array<{ row: number; col: number; size: number; kind: "row" | "col" }> = [];
  for (const [r, cs] of byRow) {
    blocks.push({ row: r, col: Math.min(...cs), size: cs.length, kind: "row" });
  }
  // Dedup: at most a few blocks
  return blocks.slice(0, 50);
}

// ---------- Workbook orchestrator ----------

export interface WorkbookReport {
  config: QAConfig;
  strictMode: boolean;
  sheets: SheetReport[];
  excludedSheets: Array<{ name: string; reason: string }>;
  totals: {
    comparedCells: number;
    totalErrors: number;
    totalPenalty: number;
    baseAccuracy: number;
    weightedAccuracy: number;
    errorRatePer10k: number;
    workloadHours: number;
    bySeverity: Record<Severity, number>;
    byClass: Record<string, number>;
  };
  grade: { label: string; tier: number; rationale: string[] };
  patterns: {
    copyPaste: Array<{ value: string; count: number }>;
    clusters: Array<{ sheet: string; rowStart: number; rowEnd: number; count: number }>;
    digitSwaps: Array<{ from: string; to: string; count: number }>;
  };
  metadata: {
    fileAName: string;
    fileBName: string;
    timestamp: string;
  };
}

export function detectStrict(name: string, mode: QAConfig["strictMode"]): boolean {
  if (mode === "ON") return true;
  if (mode === "OFF") return false;
  return /census|financial|budget|survey|stat|tax/i.test(name);
}

export function compareWorkbooks(
  fileA: { name: string; wb: XLSX.WorkBook },
  fileB: { name: string; wb: XLSX.WorkBook },
  config: QAConfig,
): WorkbookReport {
  const sheets: SheetReport[] = [];
  const excluded: Array<{ name: string; reason: string }> = [];
  const strict = detectStrict(`${fileA.name} ${fileB.name}`, config.strictMode);

  const names = Array.from(new Set([...fileA.wb.SheetNames, ...fileB.wb.SheetNames]));
  for (const name of names) {
    const wsA = fileA.wb.Sheets[name];
    const wsB = fileB.wb.Sheets[name];
    if (!wsA || !wsB) {
      excluded.push({ name, reason: `Missing in ${!wsA ? "Employee" : "Reviewer"} workbook` });
      continue;
    }
    const gridA = sheetToGrid(wsA);
    const gridB = sheetToGrid(wsB);
    const reason = shouldExcludeSheet(name, Math.max(gridA.length, gridB.length));
    if (reason) {
      excluded.push({ name, reason });
      continue;
    }
    sheets.push(compareSheet(name, gridA, gridB, config, strict));
  }

  // Aggregate
  let comparedCells = 0, totalPenalty = 0;
  const bySeverity: Record<Severity, number> = { CRITICAL: 0, HIGH: 0, HEADER: 0, MEDIUM: 0, LOW: 0 };
  const byClass: Record<string, number> = {};
  const allErrors: ErrorRecord[] = [];
  for (const s of sheets) {
    comparedCells += s.comparedCells;
    for (const e of s.errors) {
      totalPenalty += e.penalty;
      bySeverity[e.severity]++;
      byClass[e.errorClass] = (byClass[e.errorClass] ?? 0) + 1;
      allErrors.push(e);
    }
  }
  const totalErrors = allErrors.length;
  const baseAccuracy = comparedCells ? ((comparedCells - totalErrors) / comparedCells) * 100 : 100;
  const weightedAccuracy = comparedCells
    ? (1 - totalPenalty / (comparedCells * 10)) * 100
    : 100;
  const errorRatePer10k = comparedCells ? (totalErrors / comparedCells) * 10000 : 0;
  const workloadHours =
    bySeverity.CRITICAL * 4 + (bySeverity.HIGH + bySeverity.HEADER) * 1 +
    bySeverity.MEDIUM * 0.25 + bySeverity.LOW * 0.05;

  // Grade
  const grade = computeGrade(weightedAccuracy, bySeverity);

  // Patterns
  const patterns = detectPatterns(allErrors);

  return {
    config, strictMode: strict, sheets, excludedSheets: excluded,
    totals: {
      comparedCells, totalErrors, totalPenalty,
      baseAccuracy: Math.max(0, baseAccuracy),
      weightedAccuracy: Math.max(0, weightedAccuracy),
      errorRatePer10k, workloadHours, bySeverity, byClass,
    },
    grade, patterns,
    metadata: {
      fileAName: fileA.name, fileBName: fileB.name,
      timestamp: new Date().toISOString(),
    },
  };
}

function computeGrade(weighted: number, sev: Record<Severity, number>): WorkbookReport["grade"] {
  const tiers: Array<{ label: string; tier: number; min: number }> = [
    { label: "Outstanding", tier: 7, min: 99.9 },
    { label: "Excellent", tier: 6, min: 99 },
    { label: "Very Good", tier: 5, min: 97 },
    { label: "Good", tier: 4, min: 95 },
    { label: "Fair", tier: 3, min: 90 },
    { label: "Needs Improvement", tier: 2, min: 80 },
    { label: "Poor", tier: 1, min: 0 },
  ];
  let pick = tiers[tiers.length - 1];
  for (const t of tiers) if (weighted >= t.min) { pick = t; break; }
  const rationale: string[] = [`Weighted accuracy ${weighted.toFixed(2)}%`];
  const hasShift = sev.CRITICAL > 0;
  if (hasShift && pick.tier > 2) {
    rationale.push("Override: structural shift detected — capped at Needs Improvement");
    pick = tiers.find((t) => t.tier === 2)!;
  }
  if (sev.CRITICAL > 5 && pick.tier > 3) {
    rationale.push(`Override: ${sev.CRITICAL} critical errors > 5 — capped at Fair`);
    pick = tiers.find((t) => t.tier === 3)!;
  }
  return { label: pick.label, tier: pick.tier, rationale };
}

function detectPatterns(errors: ErrorRecord[]): WorkbookReport["patterns"] {
  // Copy-paste: same actual value repeated
  const valCount = new Map<string, number>();
  for (const e of errors) {
    if (!e.actual) continue;
    valCount.set(e.actual, (valCount.get(e.actual) ?? 0) + 1);
  }
  const copyPaste = [...valCount.entries()]
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([value, count]) => ({ value, count }));

  // Clusters: per-sheet, 5+ within 10 consecutive rows
  const clusters: WorkbookReport["patterns"]["clusters"] = [];
  const bySheet = new Map<string, ErrorRecord[]>();
  for (const e of errors) {
    if (!bySheet.has(e.sheet)) bySheet.set(e.sheet, []);
    bySheet.get(e.sheet)!.push(e);
  }
  for (const [sheet, errs] of bySheet) {
    const rows = errs.map((e) => e.row).sort((a, b) => a - b);
    let i = 0;
    while (i < rows.length) {
      let j = i;
      while (j < rows.length && rows[j] - rows[i] <= 10) j++;
      if (j - i >= 5) {
        clusters.push({ sheet, rowStart: rows[i], rowEnd: rows[j - 1], count: j - i });
        i = j;
      } else i++;
    }
  }

  // Digit swaps
  const swaps = new Map<string, number>();
  for (const e of errors) {
    if (e.errorClass !== "Digit Substitution") continue;
    const da = e.actual.replace(/\D/g, "");
    const db = e.expected.replace(/\D/g, "");
    if (da.length !== db.length) continue;
    for (let i = 0; i < da.length; i++) {
      if (da[i] !== db[i]) {
        const key = `${db[i]}→${da[i]}`;
        swaps.set(key, (swaps.get(key) ?? 0) + 1);
      }
    }
  }
  const digitSwaps = [...swaps.entries()]
    .filter(([, c]) => c >= 2)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, count]) => {
      const [from, to] = k.split("→");
      return { from, to, count };
    });

  return { copyPaste, clusters, digitSwaps };
}

// ---------- Narrative + coaching ----------

export function buildNarrative(r: WorkbookReport): string {
  const t = r.totals;
  const top = Object.entries(t.byClass).sort((a, b) => b[1] - a[1]).slice(0, 3);
  const parts: string[] = [];
  parts.push(`## Executive Auditor Evaluation`);
  parts.push(
    `Across **${r.sheets.length} evaluated sheet(s)** and **${t.comparedCells.toLocaleString()} compared cells**, the submission produced **${t.totalErrors.toLocaleString()} classified defect(s)** carrying **${t.totalPenalty} penalty points**. Weighted accuracy stands at **${t.weightedAccuracy.toFixed(2)}%** (base ${t.baseAccuracy.toFixed(2)}%), placing the worker in the **${r.grade.label}** band.`,
  );
  if (top.length) {
    parts.push(`### Dominant failure modes`);
    parts.push(top.map(([k, v]) => `- **${k}** — ${v} occurrences`).join("\n"));
  }
  if (t.bySeverity.CRITICAL > 0) {
    parts.push(`### Structural risk`);
    parts.push(`Detected **${t.bySeverity.CRITICAL} critical shift event(s)**. Structural shifts cascade into every downstream coordinate and must be remediated before evaluating cell-level metrics.`);
  }
  if (r.strictMode) {
    parts.push(`> Strict mode is active — numeric tolerance is disabled because the dataset matches a high-stakes pattern (census/financial/budget/survey/stat/tax).`);
  }
  parts.push(`### Workload`);
  parts.push(`Estimated reviewer remediation burden: **${t.workloadHours.toFixed(2)} hours**.`);
  return parts.join("\n\n");
}

export function buildCoaching(r: WorkbookReport): Array<{ title: string; body: string; priority: Severity }> {
  const recs: Array<{ title: string; body: string; priority: Severity }> = [];
  const c = r.totals.byClass;
  if (r.totals.bySeverity.CRITICAL > 0) {
    recs.push({
      title: "Eliminate Structural Shifts",
      priority: "CRITICAL",
      body: "Detected row/column shift blocks. Practice anchoring the first key column and validating row alignment against the source template before transcribing additional data.",
    });
  }
  if ((c["Digit Substitution"] ?? 0) + (c["Digit Transposition"] ?? 0) >= 3) {
    recs.push({
      title: "Numeric Keystroke Drill",
      priority: "MEDIUM",
      body: `Frequent digit substitutions/transpositions detected${
        r.patterns.digitSwaps.length ? ` (top swap: ${r.patterns.digitSwaps[0].from}→${r.patterns.digitSwaps[0].to})` : ""
      }. Run paced 10-key drills and read-back-aloud verification on numeric fields.`,
    });
  }
  if ((c["Missing Value"] ?? 0) + (c["Extra Value"] ?? 0) >= 3) {
    recs.push({
      title: "Completeness Sweep",
      priority: "HIGH",
      body: "Adopt a top-to-bottom column sweep checklist after each sheet to catch omissions and stray entries before submission.",
    });
  }
  if ((c["Header Mismatch"] ?? 0) >= 1) {
    recs.push({
      title: "Header Label Discipline",
      priority: "HEADER",
      body: "Verify header rows verbatim against the template. Header errors propagate downstream interpretation across the entire column.",
    });
  }
  if ((c["Range Inversion"] ?? 0) + (c["Range Boundary"] ?? 0) + (c["Range Representation"] ?? 0) >= 2) {
    recs.push({
      title: "Range / Period Formatting",
      priority: "MEDIUM",
      body: "Treat ranges (e.g. 2000/01) as ordered, strict sequences. Always copy the year-range token exactly — do not normalize or re-format.",
    });
  }
  if ((c["Major Text Difference"] ?? 0) >= 2 || (c["Text Typo"] ?? 0) >= 5) {
    recs.push({
      title: "Arabic Text Accuracy",
      priority: "HIGH",
      body: "Re-read each long text cell once after entry. Watch for alef-hamza variants and teh-marbuta vs heh confusion which are silently normalized but still indicate keyboard discipline gaps.",
    });
  }
  if (r.patterns.copyPaste.length) {
    recs.push({
      title: "Avoid Duplicated Defect Values",
      priority: "HIGH",
      body: `Identical incorrect value "${r.patterns.copyPaste[0].value}" repeats ${r.patterns.copyPaste[0].count} times — suggests copy-paste propagation. Re-source the value at each occurrence.`,
    });
  }
  return recs.slice(0, 5);
}
