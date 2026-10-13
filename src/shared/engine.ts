/**
 * Engine facade — @spintax/core wrapped with the campaign context (spec §3, §4, §14.2, §14.4).
 * Pure functions; no storage access. docs/data-model.md §9.
 */

import { analyze, type Diagnostic, extract, render, validate } from '@spintax/core';
import corePkg from '@spintax/core/package.json';
import { buildSeed } from './keys';
import type { Campaign, ColumnDef, Constraint, Profile, Row, Template } from './model';

export const ENGINE_VERSION: string = corePkg.version;

/** Names the host always supplies at render — derived + profile constants (spec §3). */
export const DERIVED_VARIABLES = ['key', 'domain', 'target', 'today'] as const;
export const PROFILE_VARIABLES = ['my_name', 'my_email', 'my_site', 'my_phone', 'my_intro', 'my_signature'] as const;

export function knownVariables(campaign: Campaign): string[] {
  return [
    ...campaign.columns.filter((c) => c.type === 'text').map((c) => c.variable),
    ...DERIVED_VARIABLES,
    ...PROFILE_VARIABLES,
  ];
}

/** Pick the profile for a row: first whose activation matches, else the first profile. */
export function pickProfile(campaign: Campaign, row: Row): Profile | undefined {
  for (const p of campaign.profiles) {
    const a = p.activation;
    if (a.kind === 'always') return p;
    if (a.kind === 'urlPattern') {
      try {
        if (new RegExp(a.pattern, 'i').test(row.target)) return p;
      } catch {
        // bad pattern: skip
      }
    }
    if (a.kind === 'column' && (row.values[a.columnId] ?? '').trim().toLowerCase() === a.equals.trim().toLowerCase())
      return p;
  }
  return campaign.profiles[0];
}

export function buildContext(
  campaign: Campaign,
  row: Row,
  profile?: Profile,
  today = new Date(),
): Record<string, string> {
  const ctx: Record<string, string> = {};
  for (const c of campaign.columns) {
    if (c.type !== 'text') continue;
    const raw = (row.values[c.id] ?? '').trim();
    ctx[c.variable] = raw !== '' ? raw : (c.defaultValue ?? '');
  }
  ctx.key = row.seedKey;
  ctx.domain = row.targetKind === 'url' ? (row.seedKey.split(':')[0] ?? row.seedKey) : '';
  ctx.target = row.target;
  ctx.today = today.toISOString().slice(0, 10);
  ctx.my_name = profile?.values.name ?? '';
  ctx.my_email = profile?.values.email ?? '';
  ctx.my_site = profile?.values.site ?? '';
  ctx.my_phone = profile?.values.phone ?? '';
  ctx.my_intro = profile?.values.intro ?? '';
  ctx.my_signature = profile?.values.signature ?? '';
  return ctx;
}

// ── Template analysis (spec §14.2: three chip groups) ──────────────────────────

export interface TemplateAnalysis {
  diagnostics: Diagnostic[];
  errors: number;
  warnings: number;
  refs: string[];
  /** Used in the template and present in the campaign (columns, derived, profile). */
  resolved: string[];
  /** Used in the template but unknown to the campaign — red chips. */
  missing: string[];
  /** Known to the campaign but not used — grey chips. */
  unused: string[];
  includes: string[];
  constructs: Record<string, number>;
}

export function analyzeTemplate(
  source: string,
  campaign: Campaign,
  locale: string,
  includes: Record<string, string> = {},
): TemplateAnalysis {
  const known = knownVariables(campaign).map((v) => v.toLowerCase());
  const result = analyze(source, { locale, knownVariables: known, knownIncludes: Object.keys(includes) });
  const refs = result.refs.map((r) => r.toLowerCase());
  const local = new Set([...result.sets, ...result.defs].map((r) => r.toLowerCase()));
  const knownSet = new Set(known);
  const resolved = refs.filter((r) => knownSet.has(r) || local.has(r));
  const missing = refs.filter((r) => !knownSet.has(r) && !local.has(r));
  const columnVars = campaign.columns
    .filter((c) => c.type === 'text' && !c.hidden)
    .map((c) => c.variable.toLowerCase());
  const used = new Set(refs);
  const unused = columnVars.filter((v) => !used.has(v));
  return {
    diagnostics: result.diagnostics,
    errors: result.diagnostics.filter((d) => d.severity === 'error').length,
    warnings: result.diagnostics.filter((d) => d.severity === 'warning').length,
    refs,
    resolved,
    missing,
    unused,
    includes: result.includes,
    constructs: result.constructs,
  };
}

/** Nearest known variable for a "rename %x% → %y%" suggestion (spec §14.2). */
export function nearestVariable(name: string, candidates: string[]): string | null {
  let best: string | null = null;
  let bestScore = Number.POSITIVE_INFINITY;
  for (const c of candidates) {
    const d = levenshtein(name.toLowerCase(), c.toLowerCase());
    if (d < bestScore && d <= Math.max(2, Math.floor(c.length / 3))) {
      bestScore = d;
      best = c;
    }
  }
  return best;
}

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0] as number;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const tmp = dp[j] as number;
      dp[j] = Math.min((dp[j] as number) + 1, (dp[j - 1] as number) + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[n] as number;
}

// ── Rendering a row (spec §14.4: highlights + warnings) ────────────────────────

export type RenderWarning =
  | { kind: 'emptyVariable'; variable: string }
  | { kind: 'leakedMarkup'; sample: string }
  | { kind: 'constraint'; constraint: Constraint; actual: number; level: 'warning' | 'blocking' }
  | { kind: 'renderError'; message: string };

export interface Highlight {
  start: number;
  end: number;
  variable: string;
}

export interface RenderedText {
  text: string;
  highlights: Highlight[];
  warnings: RenderWarning[];
}

// Private-use markers, kept far from U+E000: @spintax/core's neutralize() sentinels start there and its
// output pass turns them back into `{ } [ ] % #`, which silently broke every marker (#3).
const M_START = '\uF8F0';
const M_SEP = '\uF8F1';
const M_END = '\uF8F2';

/** Render with private-use markers around variable values, then strip them to get positions. */
export function renderWithHighlights(
  source: string,
  context: Record<string, string>,
  opts: { seed: string; locale?: string; includes?: Record<string, string> },
): RenderedText {
  const includeResolver = opts.includes ? (ref: string): string | null => opts.includes?.[ref] ?? null : undefined;
  const warnings: RenderWarning[] = [];
  let plain: string;
  try {
    plain = render(source, { context, seed: opts.seed, locale: opts.locale, includeResolver });
  } catch (err) {
    return { text: '', highlights: [], warnings: [{ kind: 'renderError', message: (err as Error).message }] };
  }
  const names = Object.keys(context);
  const marked: Record<string, string> = {};
  names.forEach((n, i) => {
    const v = context[n] ?? '';
    // A blank value stays as is: wrapped in markers it would turn truthy for `{?var?…}` and send the
    // marked render down another branch (Codex review of #3).
    marked[n] = v.trim() === '' ? v : `${M_START}${i}${M_SEP}${v}${M_END}`;
  });
  let highlights: Highlight[] = [];
  try {
    const withMarkers = render(source, { context: marked, seed: opts.seed, locale: opts.locale, includeResolver });
    const out = stripMarkers(withMarkers, names);
    highlights = markersHold(out, plain, context)
      ? dedupeHighlights(out.highlights)
      : searchHighlights(plain, context, referencedVariables(source, opts.includes));
  } catch {
    highlights = searchHighlights(plain, context, referencedVariables(source, opts.includes));
  }
  const leaked = plain.match(/[{}]|%[a-z_]\w*%|#(set|def|include)\b/i);
  if (leaked) warnings.push({ kind: 'leakedMarkup', sample: leaked[0] });
  return { text: plain, highlights, warnings };
}

/**
 * Same text up to letter case (the capitalizer's only edit). Per code point through toUpperCase(), as
 * the engine capitalizes: "ışık" vs "Işık" and "ς" vs "Σ" agree, which lowercasing gets wrong.
 */
function sameUpToCase(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  if (a === b) return true;
  for (let i = 0; i < a.length; ) {
    const ca = String.fromCodePoint(a.codePointAt(i) ?? 0);
    const cb = String.fromCodePoint(b.codePointAt(i) ?? 0);
    if (ca !== cb && ca.toUpperCase() !== cb.toUpperCase()) return false;
    i += ca.length;
  }
  return true;
}

/**
 * Marker positions are trusted when the marked render matches the plain one up to case — a marker
 * hides a value from the sentence capitalizer — and every span still holds its value up to case, so a
 * space the post-process slipped inside a marker is caught even when the two texts agree.
 */
function markersHold(
  out: { text: string; highlights: Highlight[] },
  plain: string,
  context: Record<string, string>,
): boolean {
  if (!sameUpToCase(out.text, plain)) return false;
  return out.highlights.every((h) => sameUpToCase(plain.slice(h.start, h.end), context[h.variable] ?? ''));
}

function stripMarkers(s: string, names: string[]): { text: string; highlights: Highlight[] } {
  let text = '';
  const highlights: Highlight[] = [];
  const re = new RegExp(`${M_START}(\\d+)${M_SEP}([\\s\\S]*?)${M_END}`, 'g');
  let last = 0;
  for (const m of s.matchAll(re)) {
    text += s.slice(last, m.index);
    const start = text.length;
    text += m[2] ?? '';
    highlights.push({ start, end: text.length, variable: names[Number(m[1])] ?? '' });
    last = (m.index ?? 0) + m[0].length;
  }
  text += s.slice(last);
  return { text, highlights };
}

/** extract() per template text, memoized: the Review screen renders every row of the list. */
const extractCache = new Map<string, ReturnType<typeof extract> | null>();
function extractCached(src: string): ReturnType<typeof extract> | null {
  let hit = extractCache.get(src);
  if (hit === undefined) {
    try {
      hit = extract(src);
    } catch {
      hit = null; // a source that does not parse contributes nothing
    }
    if (extractCache.size > 64) extractCache.clear();
    extractCache.set(src, hit);
  }
  return hit;
}

/** Variables the template references, following only the includes it actually reaches. */
function referencedVariables(source: string, includes: Record<string, string> = {}): Set<string> {
  const refs = new Set<string>();
  const seen = new Set<string>();
  const queue: string[] = [source];
  while (queue.length > 0) {
    const found = extractCached(queue.pop() as string);
    if (!found) continue;
    for (const r of found.refs) refs.add(r.toLowerCase());
    for (const inc of found.includes) {
      const body = includes[inc];
      if (body === undefined || seen.has(inc)) continue;
      seen.add(inc);
      queue.push(body);
    }
  }
  return refs;
}

/** The engine's word class: letters, digits, combining marks, connectors. */
const WORD_CHAR = /^[\p{L}\p{N}\p{Mn}\p{Pc}]$/u;

/** Code point ending right before `i` / starting at `i` — never half of a surrogate pair. */
function charBefore(text: string, i: number): string {
  if (i <= 0) return '';
  const low = text.charCodeAt(i - 1);
  const pair = low >= 0xdc00 && low <= 0xdfff && i >= 2;
  return text.slice(pair ? i - 2 : i - 1, i);
}
function charAt(text: string, i: number): string {
  const cp = text.codePointAt(i);
  return cp === undefined ? '' : String.fromCodePoint(cp);
}

/**
 * Fallback when post-processing moved markers: find the values of the variables the template uses.
 * Whole words only — "en" from %lang% must not light up inside "engine" (#3); letter case is ignored,
 * since the capitalizer may have touched the value. Longer values first; overlapping spans are dropped
 * (several variables often share a value, e.g. key/domain/target).
 */
export function searchHighlights(text: string, context: Record<string, string>, used: Set<string>): Highlight[] {
  const candidates: Highlight[] = [];
  const entries = Object.entries(context)
    .filter(([name, value]) => used.has(name.toLowerCase()) && [...value.trim()].length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  // Uppercased code point at each offset, computed once: a cheap first-letter filter, so the slice and
  // the full comparison run only where a value can start (the Review screen renders every row).
  const upperAt: string[] = [];
  for (let i = 0; i < text.length; ) {
    const c = charAt(text, i);
    upperAt[i] = c.toUpperCase();
    i += c.length;
  }
  for (const [variable, value] of entries) {
    const firstUpper = charAt(value, 0).toUpperCase();
    const wordStart = WORD_CHAR.test(charAt(value, 0));
    const wordEnd = WORD_CHAR.test(charBefore(value, value.length));
    for (let i = 0; i + value.length <= text.length; i++) {
      if (upperAt[i] !== firstUpper) continue;
      const end = i + value.length;
      if (!sameUpToCase(text.slice(i, end), value)) continue;
      const glued =
        (wordStart && WORD_CHAR.test(charBefore(text, i))) || (wordEnd && WORD_CHAR.test(charAt(text, end)));
      if (!glued) candidates.push({ start: i, end, variable });
    }
  }
  return dedupeHighlights(candidates);
}

/** Sort by start and drop spans that overlap an already-kept span. */
export function dedupeHighlights(list: Highlight[]): Highlight[] {
  const out: Highlight[] = [];
  for (const hl of [...list].sort((a, b) => a.start - b.start || b.end - a.end)) {
    const last = out.at(-1);
    if (last && hl.start < last.end) continue;
    out.push(hl);
  }
  return out;
}

/** Variables referenced by the template whose value is empty and not guarded by `{?var?…}`. */
export function emptyVariableWarnings(
  source: string,
  context: Record<string, string>,
  columns: ColumnDef[],
): RenderWarning[] {
  const refs = extract(source).refs.map((r) => r.toLowerCase());
  const required = new Set(columns.filter((c) => c.required).map((c) => c.variable.toLowerCase()));
  const out: RenderWarning[] = [];
  for (const ref of refs) {
    const value = context[ref];
    if (value === undefined || value.trim() !== '') continue;
    const guarded = new RegExp(`\\{\\?!?${ref}\\?`, 'i').test(source);
    if (!guarded || required.has(ref)) out.push({ kind: 'emptyVariable', variable: ref });
  }
  return out;
}

export interface RowRender {
  rowId: string;
  step: number;
  seed: string;
  salt: number;
  subject?: RenderedText;
  body: RenderedText;
  profile?: Profile;
  context: Record<string, string>;
  warnings: RenderWarning[];
}

/** Render body (+ subject) for a row, honoring row overrides (edits) as the source of truth. */
export function renderRow(
  campaign: Campaign,
  row: Row,
  step: number,
  templates: { body: Template; subject?: Template },
  opts: { today?: Date } = {},
): RowRender {
  const profile = pickProfile(campaign, row);
  const context = buildContext(campaign, row, profile, opts.today);
  const seed = buildSeed(row.seedKey, step, row.salt);
  const locale = row.lang ?? templates.body.locale ?? campaign.defaultLocale;
  const body =
    row.overrides?.body?.step === step
      ? { text: row.overrides.body.text, highlights: [], warnings: [] as RenderWarning[] }
      : renderWithHighlights(templates.body.source, context, { seed, locale, includes: templates.body.includes });
  const subject = templates.subject
    ? row.overrides?.subject?.step === step
      ? { text: row.overrides.subject.text, highlights: [], warnings: [] as RenderWarning[] }
      : renderWithHighlights(templates.subject.source, context, {
          seed: `${seed}:subject`,
          locale,
          includes: templates.subject.includes,
        })
    : undefined;
  const warnings: RenderWarning[] = [
    ...body.warnings,
    ...(subject?.warnings ?? []),
    ...emptyVariableWarnings(templates.body.source, context, campaign.columns),
  ];
  return { rowId: row.rowId, step, seed, salt: row.salt, subject, body, profile, context, warnings };
}

/** Check a rendered text against constraints (ADR 0011 p.7). */
export function checkConstraints(text: string, constraints: Constraint[]): RenderWarning[] {
  const out: RenderWarning[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  for (const c of constraints) {
    if (c.kind === 'maxLength' && text.length > c.value)
      out.push({ kind: 'constraint', constraint: c, actual: text.length, level: c.level });
    if (c.kind === 'minLength' && text.length < c.value)
      out.push({ kind: 'constraint', constraint: c, actual: text.length, level: c.level });
    if (c.kind === 'maxWords' && words.length > c.value)
      out.push({ kind: 'constraint', constraint: c, actual: words.length, level: c.level });
    if (c.kind === 'keywordRepeat') {
      const counts = new Map<string, number>();
      for (const w of words) {
        const k = w.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
        if (k.length < 3) continue;
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
      const max = Math.max(0, ...counts.values());
      if (max > c.max) out.push({ kind: 'constraint', constraint: c, actual: max, level: c.level });
    }
  }
  return out;
}

export type { Diagnostic };
export { validate };
