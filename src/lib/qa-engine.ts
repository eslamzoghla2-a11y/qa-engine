// Quality Assurance Engine — Excel comparison
// Implements the full specification: normalization, classification, scoring.

import * as XLSX from "xlsx";

export type Severity = "CRITICAL" | "HIGH" | "HEADER" | "MEDIUM" | "LOW";
export type ErrorClass =
  | "Row Shift"
  | "Column Shift"
  | "Missing Row"
  | "Extra Row"
  | "Missing Column"
  | "Extra Column"
  | "Missing Cell"
  | "Extra Cell"
  | "Local Row Misalignment"
  | "Local Column Misalignment"
  | "Missing Value"
  | "Extra Value"
  | "Range Inversion"
  | "Range Boundary"
  | "Range Representation"
  | "Missing Digit"
  | "Extra Digit"
  | "Digit Transposition"
  | "Digit Substitution"
  | "Numeric Difference"
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
  note?: string;
} {
  // a = actual (worker), b = expected (reviewer)
  // Step 1: classify by typing-mistake pattern (digit-only strings)
  const da = a.replace(/\D/g, "");
  const db = b.replace(/\D/g, "");
  let cls: ErrorClass = "Numeric Difference";
  let severity: Severity = "MEDIUM";

  if (da && db) {
    if (da.length === db.length - 1 && db.includes(da)) {
      cls = "Missing Digit";
    } else if (da.length === db.length + 1 && da.includes(db)) {
      cls = "Extra Digit";
    } else if (da.length === db.length) {
      const diffIdx: number[] = [];
      for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) diffIdx.push(i);
      if (
        diffIdx.length === 2 && diffIdx[1] === diffIdx[0] + 1 &&
        da[diffIdx[0]] === db[diffIdx[1]] && da[diffIdx[1]] === db[diffIdx[0]]
      ) {
        cls = "Digit Transposition";
      } else if (diffIdx.length === 1) {
        cls = "Digit Substitution";
      } else if (diffIdx.length > 1) {
        cls = "Digit Substitution";
      }
    }
  }

  // Step 2: variance / absolute thresholds only escalate severity
  let note: string | undefined;
  const an = tryParseNumber(a);
  const bn = tryParseNumber(b);
  if (an !== null && bn !== null) {
    const diff = Math.abs(an - bn);
    const variance = bn !== 0 ? diff / Math.abs(bn) : diff > 0 ? 1 : 0;
    if (variance > cfg.numericMajorVariance || diff > cfg.numericMajorAbsolute) {
      severity = "HIGH";
      note = `Variance exceeds configured threshold (Δ=${diff}, ${(variance * 100).toFixed(1)}%)`;
    }
  }

  return { cls, severity, note };
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
  // Column shifts only — row shifts are now handled by alignRows()
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

// ---------- Row alignment recovery ----------
// Computes a row-by-row alignment between employee (A) and reviewer (B) grids
// using LCS over normalized row signatures. Inserted/deleted rows are then
// classified as Missing Row / Extra Row instead of cascading into a Row Shift.

type AlignOp = { a?: number; b?: number };

function rowSignature(row: string[]): string {
  if (!row || row.length === 0) return "";
  const parts = row.map((v) => normalizeText(v));
  if (parts.every((p) => p === "")) return "";
  return parts.join("\u0001");
}

function alignRows(
  gridA: string[][], gridB: string[][], headerRows: number,
): { ops: AlignOp[]; recovered: boolean; insertedRows: number; deletedRows: number; rowShift: boolean } {
  const ops: AlignOp[] = [];
  // Header rows always align 1:1
  const headerMax = Math.max(headerRows, 0);
  for (let i = 0; i < headerMax; i++) {
    ops.push({ a: i < gridA.length ? i : undefined, b: i < gridB.length ? i : undefined });
  }

  const sigA: string[] = [];
  const sigB: string[] = [];
  for (let i = headerMax; i < gridA.length; i++) sigA.push(rowSignature(gridA[i]));
  for (let i = headerMax; i < gridB.length; i++) sigB.push(rowSignature(gridB[i]));

  const n = sigA.length, m = sigB.length;

  // Fallback for very large sheets — identity alignment, lets old shift detector handle it
  if (n * m > 2_000_000) {
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      ops.push({
        a: i < n ? i + headerMax : undefined,
        b: i < m ? i + headerMax : undefined,
      });
    }
    return { ops, recovered: false, insertedRows: 0, deletedRows: 0, rowShift: false };
  }

  // LCS — only non-empty signatures can match (prevents pairing two blank rows)
  const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (sigA[i - 1] !== "" && sigA[i - 1] === sigB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  // Backtrack
  const raw: Array<{ kind: "M" | "A" | "B"; a?: number; b?: number }> = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (sigA[i - 1] !== "" && sigA[i - 1] === sigB[j - 1]) {
      raw.push({ kind: "M", a: i - 1 + headerMax, b: j - 1 + headerMax });
      i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      raw.push({ kind: "A", a: i - 1 + headerMax });
      i--;
    } else {
      raw.push({ kind: "B", b: j - 1 + headerMax });
      j--;
    }
  }
  while (i > 0) { raw.push({ kind: "A", a: --i + headerMax }); }
  while (j > 0) { raw.push({ kind: "B", b: --j + headerMax }); }
  raw.reverse();

  // Merge consecutive unmatched A/B runs into modified pairs (per-cell diffable).
  // Excess overflow becomes Extra Row / Missing Row.
  const merged: AlignOp[] = [];
  let k = 0;
  let insertedRows = 0, deletedRows = 0;
  while (k < raw.length) {
    if (raw[k].kind === "M") {
      merged.push({ a: raw[k].a, b: raw[k].b });
      k++;
    } else {
      const groupAs: number[] = [];
      const groupBs: number[] = [];
      while (k < raw.length && raw[k].kind !== "M") {
        if (raw[k].kind === "A") groupAs.push(raw[k].a!);
        else groupBs.push(raw[k].b!);
        k++;
      }
      const pairCount = Math.min(groupAs.length, groupBs.length);
      // Pair by positional order — these are "modified" rows
      for (let p = 0; p < pairCount; p++) {
        merged.push({ a: groupAs[p], b: groupBs[p] });
      }
      // Excess A → Extra Row (employee inserted), excess B → Missing Row (employee omitted)
      if (groupAs.length > pairCount) {
        for (let p = pairCount; p < groupAs.length; p++) {
          merged.push({ a: groupAs[p] });
          insertedRows++;
        }
      } else if (groupBs.length > pairCount) {
        for (let p = pairCount; p < groupBs.length; p++) {
          merged.push({ b: groupBs[p] });
          deletedRows++;
        }
      }
    }
  }

  const out = [...ops, ...merged];
  const totalBody = Math.max(n, m, 1);
  const unmatched = insertedRows + deletedRows;
  // If unmatched fraction is small, alignment is reliable.
  // Otherwise treat as Row Shift (cannot be explained by a few insertions/deletions).
  const recovered = unmatched / totalBody <= 0.4;
  return {
    ops: out,
    recovered,
    insertedRows,
    deletedRows,
    rowShift: !recovered && unmatched > 0,
  };
}

// ---------- Column alignment recovery ----------
// Detects single missing/extra columns the same way alignRows handles rows.

function colSignature(grid: string[][], c: number, headerRows: number): string {
  const parts: string[] = [];
  // Include header for stronger signal, then sample body
  for (let r = 0; r < Math.min(grid.length, headerRows + 40); r++) {
    parts.push(normalizeText(grid[r]?.[c] ?? ""));
  }
  if (parts.every((p) => p === "")) return "";
  return parts.join("\u0001");
}

function alignColumns(
  gridA: string[][], gridB: string[][], headerRows: number,
): { ops: AlignOp[]; recovered: boolean; missingCols: number[]; extraCols: number[]; colShift: boolean } {
  const colsA = gridA.reduce((m, r) => Math.max(m, r.length), 0);
  const colsB = gridB.reduce((m, r) => Math.max(m, r.length), 0);
  const sigA: string[] = [];
  const sigB: string[] = [];
  for (let c = 0; c < colsA; c++) sigA.push(colSignature(gridA, c, headerRows));
  for (let c = 0; c < colsB; c++) sigB.push(colSignature(gridB, c, headerRows));

  const n = sigA.length, m = sigB.length;
  const ops: AlignOp[] = [];

  if (n === 0 || m === 0 || n * m > 200_000) {
    const max = Math.max(n, m);
    for (let i = 0; i < max; i++) {
      ops.push({ a: i < n ? i : undefined, b: i < m ? i : undefined });
    }
    return { ops, recovered: false, missingCols: [], extraCols: [], colShift: false };
  }

  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (sigA[i - 1] !== "" && sigA[i - 1] === sigB[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = dp[i - 1][j] >= dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
      }
    }
  }

  const raw: Array<{ kind: "M" | "A" | "B"; a?: number; b?: number }> = [];
  let i = n, j = m;
  while (i > 0 && j > 0) {
    if (sigA[i - 1] !== "" && sigA[i - 1] === sigB[j - 1]) {
      raw.push({ kind: "M", a: i - 1, b: j - 1 }); i--; j--;
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      raw.push({ kind: "A", a: i - 1 }); i--;
    } else {
      raw.push({ kind: "B", b: j - 1 }); j--;
    }
  }
  while (i > 0) { raw.push({ kind: "A", a: --i }); }
  while (j > 0) { raw.push({ kind: "B", b: --j }); }
  raw.reverse();

  const merged: AlignOp[] = [];
  const missingCols: number[] = [];
  const extraCols: number[] = [];
  let k = 0;
  while (k < raw.length) {
    if (raw[k].kind === "M") {
      merged.push({ a: raw[k].a, b: raw[k].b });
      k++;
    } else {
      const groupAs: number[] = [];
      const groupBs: number[] = [];
      while (k < raw.length && raw[k].kind !== "M") {
        if (raw[k].kind === "A") groupAs.push(raw[k].a!);
        else groupBs.push(raw[k].b!);
        k++;
      }
      const pairCount = Math.min(groupAs.length, groupBs.length);
      for (let p = 0; p < pairCount; p++) {
        merged.push({ a: groupAs[p], b: groupBs[p] });
      }
      if (groupAs.length > pairCount) {
        for (let p = pairCount; p < groupAs.length; p++) {
          merged.push({ a: groupAs[p] });
          extraCols.push(groupAs[p]);
        }
      } else if (groupBs.length > pairCount) {
        for (let p = pairCount; p < groupBs.length; p++) {
          merged.push({ b: groupBs[p] });
          missingCols.push(groupBs[p]);
        }
      }
    }
  }

  const totalCols = Math.max(n, m, 1);
  const unmatched = missingCols.length + extraCols.length;
  const recovered = unmatched > 0 && unmatched / totalCols <= 0.4;
  return {
    ops: merged,
    recovered,
    missingCols,
    extraCols,
    colShift: !recovered && unmatched > 0,
  };
}

// ---------- Local within-row cell alignment ----------
// For a matched row pair, detect single missing/extra cells that would
// otherwise cascade into several Text/Numeric errors.

function localRowAlign(
  rowA: string[], rowB: string[],
): { kind: "ok" | "missing" | "extra" | "shift"; offset: number; matches: number; total: number } | null {
  const a = rowA.map((v) => normalizeText(v ?? ""));
  const b = rowB.map((v) => normalizeText(v ?? ""));
  const len = Math.max(a.length, b.length);
  if (len < 4) return null;

  // Count direct mismatches first
  let direct = 0, compared = 0;
  for (let c = 0; c < len; c++) {
    const av = a[c] ?? "", bv = b[c] ?? "";
    if (av === "" && bv === "") continue;
    compared++;
    if (av !== bv) direct++;
  }
  if (compared === 0 || direct < 2) return null;

  // Try offsets ±1, ±2 — employee column N matches reviewer column N+offset
  let best: { offset: number; matches: number; total: number } | null = null;
  for (const offset of [1, -1, 2, -2]) {
    let matches = 0, total = 0;
    for (let c = 0; c < len; c++) {
      const av = a[c] ?? "";
      const bv = b[c + offset] ?? "";
      if (av === "" && bv === "") continue;
      total++;
      if (av !== "" && av === bv) matches++;
    }
    if (total > 0 && (!best || matches / total > best.matches / best.total)) {
      best = { offset, matches, total };
    }
  }
  if (!best || best.total === 0) return null;
  if (best.matches / best.total < 0.8) return null;

  // Recovery succeeded
  const kind = best.offset > 0 ? "missing" : "extra";
  return { kind, offset: best.offset, matches: best.matches, total: best.total };
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
  const cols = Math.max(
    ...gridA.map((r) => r.length), ...gridB.map((r) => r.length), 0,
  );
  const rows = Math.max(gridA.length, gridB.length);

  // Step 1: Row alignment recovery
  const rowAlign = alignRows(gridA, gridB, headerRows);
  // Step 2: Column alignment recovery
  const colAlign = alignColumns(gridA, gridB, headerRows);

  // Build column lookup: when col alignment recovers, map reviewer col → employee col
  const useColAlign = colAlign.recovered;
  const colPairs: Array<{ a?: number; b?: number }> = useColAlign
    ? colAlign.ops
    : Array.from({ length: cols }, (_, c) => ({ a: c, b: c }));

  // Step 3: Shift detection (only as last resort, and skip columns recovered by alignment)
  const shiftCells = useColAlign ? new Set<string>() : detectShifts(gridA, gridB, cfg);

  let compared = 0;
  const errors: ErrorRecord[] = [];

  // Emit Missing Column / Extra Column events (once per column)
  if (useColAlign) {
    for (const op of colAlign.ops) {
      if (op.a === undefined && op.b !== undefined) {
        errors.push({
          sheet: name, row: 0, col: op.b,
          cellRef: `${colLetter(op.b)}1`,
          expected: `(column ${colLetter(op.b)})`,
          actual: "(column omitted)",
          errorClass: "Missing Column",
          severity: "CRITICAL",
          penalty: SEVERITY_PENALTY.CRITICAL,
          isHeader: true,
          note: "Structural defect — entire column omitted. Downstream cell comparisons suppressed for this column.",
        });
      } else if (op.b === undefined && op.a !== undefined) {
        errors.push({
          sheet: name, row: 0, col: op.a,
          cellRef: `${colLetter(op.a)}1`,
          expected: "(no such column)",
          actual: `(column ${colLetter(op.a)})`,
          errorClass: "Extra Column",
          severity: "CRITICAL",
          penalty: SEVERITY_PENALTY.CRITICAL,
          isHeader: true,
          note: "Structural defect — extra column inserted. Downstream cell comparisons suppressed for this column.",
        });
      }
    }
  }

  const useRowAlign = rowAlign.recovered;
  const rowOps = useRowAlign
    ? rowAlign.ops
    : Array.from({ length: rows }, (_, r) => ({ a: r, b: r }));

  const compareRowPair = (rA: number, rB: number) => {
    // Step 3.5: per-row local cell alignment — single missing/extra cell within row
    if (rA >= headerRows && !useColAlign) {
      const rowA = gridA[rA] ?? [];
      const rowB = gridB[rB] ?? [];
      const local = localRowAlign(rowA, rowB);
      if (local) {
        const cls: ErrorClass = local.kind === "missing" ? "Missing Cell"
                              : local.kind === "extra" ? "Extra Cell"
                              : "Local Row Misalignment";
        errors.push({
          sheet: name, row: rA, col: 0,
          cellRef: `${colLetter(0)}${rA + 1}`,
          expected: rowB.map((v) => String(v ?? "")).join(" | ").slice(0, 160),
          actual: rowA.map((v) => String(v ?? "")).join(" | ").slice(0, 160),
          errorClass: cls,
          severity: "MEDIUM",
          penalty: SEVERITY_PENALTY.MEDIUM,
          isHeader: false,
          note: `Local cell shift (offset ${local.offset}) recovered ${local.matches}/${local.total} subsequent cells.`,
        });
        // Count cells as compared but do not cascade individual errors
        compared += Math.max(rowA.length, rowB.length);
        return;
      }
    }
    for (const cop of colPairs) {
      const cA = cop.a, cB = cop.b;
      if (cA === undefined || cB === undefined) continue; // covered by Missing/Extra Column
      const rawA = gridA[rA]?.[cA] ?? "";
      const rawB = gridB[rB]?.[cB] ?? "";
      const cellErr = classifyCell(name, rA, cA, rawA, rawB, rA < headerRows, shiftCells, cfg, strict);
      if (cellErr === "skip-empty") continue;
      compared++;
      if (cellErr === "match" || cellErr === "shift") continue;
      errors.push(cellErr);
    }
  };

  for (const op of rowOps) {
    if (op.a === undefined && op.b !== undefined) {
      const rowB = gridB[op.b] ?? [];
      const nonEmpty = rowB.filter((v) => !isEmpty(v)).length;
      if (nonEmpty === 0) continue;
      compared += nonEmpty;
      errors.push({
        sheet: name, row: op.b, col: 0,
        cellRef: `${colLetter(0)}${op.b + 1}`,
        expected: rowB.map((v) => String(v ?? "")).join(" | ").slice(0, 200),
        actual: "(row omitted)",
        errorClass: "Missing Row",
        severity: "CRITICAL",
        penalty: SEVERITY_PENALTY.CRITICAL,
        isHeader: false,
        note: "Structural defect — entire row omitted. Downstream cell comparisons suppressed for this row.",
      });
      continue;
    }
    if (op.b === undefined && op.a !== undefined) {
      const rowA = gridA[op.a] ?? [];
      const nonEmpty = rowA.filter((v) => !isEmpty(v)).length;
      if (nonEmpty === 0) continue;
      compared += nonEmpty;
      errors.push({
        sheet: name, row: op.a, col: 0,
        cellRef: `${colLetter(0)}${op.a + 1}`,
        expected: "(no such row)",
        actual: rowA.map((v) => String(v ?? "")).join(" | ").slice(0, 200),
        errorClass: "Extra Row",
        severity: "CRITICAL",
        penalty: SEVERITY_PENALTY.CRITICAL,
        isHeader: false,
        note: "Structural defect — extra row inserted. Downstream cell comparisons suppressed for this row.",
      });
      continue;
    }
    if (op.a !== undefined && op.b !== undefined) compareRowPair(op.a, op.b);
  }

  // Row Shift fallback only when recovery failed
  if (!useRowAlign && rowAlign.rowShift) {
    errors.push({
      sheet: name, row: headerRows, col: 0,
      cellRef: `${colLetter(0)}${headerRows + 1}`,
      expected: `(${rowAlign.deletedRows} missing, ${rowAlign.insertedRows} extra)`,
      actual: "row block shift",
      errorClass: "Row Shift",
      severity: "CRITICAL",
      penalty: SEVERITY_PENALTY.CRITICAL,
      isHeader: false,
      note: "Row alignment could not be recovered — block-level structural shift.",
    });
  }

  // Column Shift fallback only when column alignment failed
  if (!useColAlign && shiftCells.size > 0) {
    const byCol = new Map<number, number>();
    for (const k of shiftCells) {
      const c = Number(k.split(",")[1]);
      byCol.set(c, (byCol.get(c) ?? 0) + 1);
    }
    for (const [c, size] of byCol) {
      errors.push({
        sheet: name, row: 0, col: c,
        cellRef: `${colLetter(c)}1`,
        expected: `(${size} cells)`, actual: `column shift block`,
        errorClass: "Column Shift",
        severity: "CRITICAL",
        penalty: SEVERITY_PENALTY.CRITICAL,
        isHeader: false,
        note: "Column alignment could not be recovered — block-level structural shift.",
      });
    }
  }


  return {
    name, rowCount: rows, colCount: cols, comparedCells: compared,
    headerRows, errors, shiftCells, gridA, gridB,
  };
}

function classifyCell(
  name: string, r: number, c: number, rawA: string, rawB: string,
  isHeader: boolean, shiftCells: Set<string>, cfg: QAConfig, strict: boolean,
): ErrorRecord | "match" | "shift" | "skip-empty" {
  const ea = isEmpty(rawA), eb = isEmpty(rawB);
  if (ea && eb) return "skip-empty";
  const key = `${r},${c}`;
  if (shiftCells.has(key)) return "shift";
  const a = normalizeText(rawA);
  const b = normalizeText(rawB);
  if (a === b) return "match";

  const an = tryParseNumber(a), bn = tryParseNumber(b);
  if (an !== null && bn !== null && !strict) {
    const diff = Math.abs(an - bn);
    const tol = cfg.numericToleranceMode === "PERCENTAGE"
      ? Math.abs(bn) * cfg.numericTolerance
      : cfg.numericTolerance;
    if (diff <= tol) return "match";
  }

  let rec: { cls: ErrorClass; severity: Severity; note?: string };
  if (ea && !eb) rec = { cls: "Missing Value", severity: "HIGH" };
  else if (!ea && eb) rec = { cls: "Extra Value", severity: "HIGH" };
  else {
    const rangeR = (parseRange(a) || parseRange(b)) ? classifyRange(a, b) : null;
    if (rangeR) rec = rangeR;
    else if (an !== null || bn !== null) rec = classifyNumeric(a, b, cfg);
    else rec = classifyText(a, b);
  }

  if (isHeader) {
    rec = {
      cls: "Header Mismatch",
      severity: "HEADER",
      note: "Header error — may affect interpretation of entire column",
    };
  }

  const penalty = isHeader ? cfg.headerPenalty : SEVERITY_PENALTY[rec.severity];
  return {
    sheet: name, row: r, col: c,
    cellRef: `${colLetter(c)}${r + 1}`,
    expected: String(rawB), actual: String(rawA),
    errorClass: rec.cls, severity: rec.severity, penalty,
    isHeader, note: rec.note,
  };
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
    `Across **${r.sheets.length} evaluated sheet(s)** and **${t.comparedCells.toLocaleString()} compared cells**, the submission produced **${t.totalErrors.toLocaleString()} classified defect(s)** carrying **${t.totalPenalty} penalty points**. Accuracy stands at **${t.baseAccuracy.toFixed(2)}%**, placing the worker in the **${r.grade.label}** band.`,
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
