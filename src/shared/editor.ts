/**
 * Template editor with an overlay — ported from the spintax.net playground (play.ts "Overlay
 * rendering"): a <pre> mirrors the textarea text and underlines the exact spans the engine's
 * diagnostics point at (wavy: error / warning), so problems are seen where they are, not in a
 * list below. Pure helpers are exported for tests; `mountEditor` wires the DOM.
 */
import type { Diagnostic } from '@spintax/core';
import { h } from './dom';
import { t } from './i18n';

export interface OverlayRange {
  start: number;
  end: number;
  code: string;
  severity: Diagnostic['severity'];
  message: string;
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function lineColToOffset(text: string, line: number, column: number): number {
  let i = 0;
  let cur = 1;
  while (cur < line && i < text.length) {
    if (text[i] === '\n') cur++;
    i++;
  }
  return Math.min(i + (column - 1), text.length);
}

/**
 * Character ranges to underline. `variable.undefined` is reported once by the engine; every
 * occurrence of that name is underlined (an editor, not a log).
 */
export function overlayRanges(text: string, diagnostics: readonly Diagnostic[]): OverlayRange[] {
  const ranges: OverlayRange[] = [];
  const undefinedNames = new Map<string, string>();
  for (const d of diagnostics) {
    if (d.code === 'variable.undefined') {
      const name = d.data?.name;
      if (typeof name === 'string') undefinedNames.set(name.toLowerCase(), d.message);
      continue;
    }
    const start = lineColToOffset(text, d.line, d.column);
    const end =
      d.endLine !== undefined && d.endColumn !== undefined ? lineColToOffset(text, d.endLine, d.endColumn) : start + 1;
    ranges.push({ start, end: Math.max(end, start + 1), code: d.code, severity: d.severity, message: d.message });
  }
  if (undefinedNames.size > 0) {
    for (const m of text.matchAll(/%(\w+)%/g)) {
      const msg = undefinedNames.get((m[1] ?? '').toLowerCase());
      if (m.index !== undefined && msg !== undefined)
        ranges.push({
          start: m.index,
          end: m.index + m[0].length,
          code: 'variable.undefined',
          severity: 'warning',
          message: msg,
        });
    }
  }
  return ranges;
}

/** HTML for the overlay: escaped text with <span class="err|warn" title="…"> around ranges. */
export function overlayHtml(text: string, ranges: readonly OverlayRange[]): string {
  if (ranges.length === 0) return `${escapeHtml(text)}\n`; // trailing \n keeps the heights equal
  const sorted = [...ranges].sort((a, b) => a.start - b.start || b.end - a.end);
  let out = '';
  let i = 0;
  for (const r of sorted) {
    if (r.start < i || r.end <= r.start) continue; // overlaps / empty
    if (r.start > i) out += escapeHtml(text.slice(i, r.start));
    out += `<span class="${r.severity === 'warning' ? 'warn' : 'err'}" title="${escapeHtml(r.message)}">${escapeHtml(text.slice(r.start, r.end))}</span>`;
    i = r.end;
  }
  if (i < text.length) out += escapeHtml(text.slice(i));
  return `${out}\n`;
}

/** A rendered variant should be clean: a surviving %var% or a fullwidth brace is a template problem. */
const LEFTOVER_RE = /%[A-Za-z0-9_]+%|[｛｝]/g;

export function leftoverHtml(text: string, title = t('tplLeftover')): string {
  let out = '';
  let i = 0;
  for (const m of text.matchAll(LEFTOVER_RE)) {
    if (m.index === undefined) continue;
    out += escapeHtml(text.slice(i, m.index));
    out += `<span class="err" title="${escapeHtml(title)}">${escapeHtml(m[0])}</span>`;
    i = m.index + m[0].length;
  }
  return out + escapeHtml(text.slice(i));
}

export function hasLeftovers(text: string): boolean {
  return new RegExp(LEFTOVER_RE.source, 'u').test(text);
}

export interface Editor {
  root: HTMLElement;
  /** Redraw the overlay for the current text with these diagnostics (none → plain mirror). */
  refresh: (diagnostics?: readonly Diagnostic[]) => void;
}

/** Wrap a textarea in the playground's overlay editor. The caller keeps owning the textarea. */
export function mountEditor(textarea: HTMLTextAreaElement): Editor {
  textarea.classList.add('editor__textarea');
  textarea.spellcheck = false;
  const overlay = h('pre', { class: 'editor__overlay', 'aria-hidden': 'true' });
  const root = h('div', { class: 'editor' }, overlay, textarea);
  let last: readonly Diagnostic[] = [];
  const refresh = (diagnostics?: readonly Diagnostic[]): void => {
    if (diagnostics) last = diagnostics;
    const text = textarea.value;
    overlay.innerHTML = overlayHtml(text, overlayRanges(text, last));
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  };
  // While typing the diagnostics are stale: mirror the text plainly until the next analysis.
  textarea.addEventListener('input', () => refresh([]));
  textarea.addEventListener('scroll', () => {
    overlay.scrollTop = textarea.scrollTop;
    overlay.scrollLeft = textarea.scrollLeft;
  });
  refresh([]);
  return { root, refresh };
}
