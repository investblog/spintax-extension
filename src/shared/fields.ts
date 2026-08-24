/**
 * Field fingerprints, form signature, route pattern, honeypot rules — pure data helpers shared
 * by the content script (which builds them from the DOM) and the panel (which matches recipes).
 * Spec §5, ADR 0011 p.6, docs/data-model.md §3.
 */
import type { FieldFingerprint } from './model';

/** What the content script reports per candidate field (fingerprint + facts the DOM knows). */
export interface FieldInfo extends FieldFingerprint {
  /** Stable per-scan id used to address the element for filling (not persisted). */
  fieldId: string;
  /** Which <form> the field belongs to ('root' outside forms) — mapping never mixes forms. */
  formId?: string;
  /** <input type=file accept> — becomes a mime constraint (not part of the fingerprint). */
  accept?: string;
  visible: boolean;
  honeypot: boolean;
  required?: boolean;
  /** <select>: option labels and values. */
  options?: { value: string; label: string }[];
  /** Non-empty current value. */
  filled: boolean;
}

/** Path with numeric / uuid / hash-like segments replaced by `*` — the recipe's route key. */
export function routePattern(url: string): string {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return '/';
  }
  const segments = path
    .split('/')
    .filter(Boolean)
    .map((s) => (/^(\d+|[0-9a-f]{8,}|[0-9a-f-]{32,})$/i.test(s) ? '*' : s));
  return `/${segments.join('/')}`;
}

export function originOf(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return '';
  }
}

/** FNV-1a 32-bit hex — small, sync, good enough for a form signature. */
export function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

const sigPart = (f: FieldFingerprint): string =>
  [f.tag, f.type ?? '', f.name ?? '', f.id ?? '', f.autocomplete ?? ''].join('|');

/** Signature of the visible, non-honeypot fields in DOM order. */
export function formSignature(fields: FieldInfo[]): string {
  return fnv1a(
    fields
      .filter((f) => f.visible && !f.honeypot)
      .map(sigPart)
      .join('\n'),
  );
}

// ── Honeypots (spec §5) ────────────────────────────────────────────────────────

/** Names that only mean "trap" together with invisibility (website/url/fax are real fields when visible). */
const HONEYPOT_NAMES =
  /^(hp|honeypot|honey|bot|botcheck|trap|website|url|fax|email2|email_confirm|confirm_email|_gotcha|leave_blank|do_not_fill)$/i;
const HONEYPOT_CLASS = /(honeypot|wpforms-field-hp|hp-field|ohnohoney|botcheck|visually-hidden-field)/i;

/**
 * Name-based honeypot verdict; visibility is decided by the content script (it has the DOM).
 * A hidden name-match with a visible sibling of the same role is the classic shape.
 */
export function looksLikeHoneypotName(
  name: string | undefined,
  id: string | undefined,
  className: string | undefined,
): boolean {
  const n = (name ?? '').trim();
  const i = (id ?? '').trim();
  if (HONEYPOT_NAMES.test(n) || HONEYPOT_NAMES.test(i)) return true;
  return HONEYPOT_CLASS.test(className ?? '');
}

// ── Fingerprint matching (recipe re-resolution, ADR 0011 p.6) ──────────────────

function eq(a?: string, b?: string): boolean {
  return !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
}

/** 0..1 similarity between a stored fingerprint and a live field. */
export function matchScore(stored: FieldFingerprint, live: FieldFingerprint): number {
  if (stored.tag !== live.tag) return 0;
  let score = 0;
  let weight = 0;
  const add = (w: number, hit: boolean, present: boolean): void => {
    if (!present) return;
    weight += w;
    if (hit) score += w;
  };
  add(3, eq(stored.id, live.id), !!stored.id);
  add(3, eq(stored.name, live.name), !!stored.name);
  add(2, eq(stored.autocomplete, live.autocomplete), !!stored.autocomplete);
  add(1, eq(stored.type, live.type), !!stored.type);
  add(2, eq(stored.label, live.label), !!stored.label);
  add(1, eq(stored.placeholder, live.placeholder), !!stored.placeholder);
  add(1, eq(stored.ariaLabel, live.ariaLabel), !!stored.ariaLabel);
  add(1, stored.sameTypeIndex === live.sameTypeIndex, true);
  if (weight === 0) return 0;
  return score / weight;
}

export const MATCH_THRESHOLD = 0.6;

/** Best live field for a stored fingerprint, or null below threshold. */
export function resolveField(stored: FieldFingerprint, live: FieldInfo[]): { field: FieldInfo; score: number } | null {
  let best: { field: FieldInfo; score: number } | null = null;
  for (const f of live) {
    if (!f.visible || f.honeypot) continue;
    const s = matchScore(stored, f);
    if (s >= MATCH_THRESHOLD && (!best || s > best.score)) best = { field: f, score: s };
  }
  return best;
}
