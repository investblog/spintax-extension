/**
 * DOM side of mapping and filling — runs inside the target page (content script). Pure DOM apart
 * from the read-back notes, which go through the message catalogue (`t()`) like every other string
 * the user sees. Spec §5 (skeleton, honeypots), §6 (insertion ladder with read-back, non-empty
 * policy, rollback), ADR 0011 p.1/5.
 *
 * R0 contract: <input>/<textarea>/<select>/<input type=file> are filled directly (with a settle
 * tick before read-back, so a controlled input that reverts is caught and rolled back);
 * contenteditable editors get focus + clipboard — direct insertion is an R1 experiment.
 */
import { type FieldInfo, looksLikeHoneypotName, resolveField } from '@/shared/fields';
import { t } from '@/shared/i18n';
import type { FillOutcome } from '@/shared/model';
import type { FillInstruction, FillReportItem, ScanResult } from '@/shared/protocol';

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | HTMLElement;

const TEXT_TYPES = new Set(['', 'text', 'email', 'tel', 'url', 'search', 'file']);
/** Scan payload limits — the page is untrusted input (review 2026-08-23). */
const MAX_FIELDS = 200;
const MAX_OPTIONS = 100;
const MAX_ATTR = 200;
const MAX_LINKS = 20;

const registry = new Map<string, Editable>();
let scanCounter = 0;
/** Per-document token: field ids and fill requests are scoped to it (review 2026-08-23 #1). */
const DOC_TOKEN = Math.random().toString(36).slice(2, 10);
export const docToken = (): string => DOC_TOKEN;

export function elementFor(fieldId: string): Editable | undefined {
  return registry.get(fieldId);
}

const clip = (s: string | null | undefined): string | undefined => (s ? s.slice(0, MAX_ATTR) : undefined);

// ── Scan ───────────────────────────────────────────────────────────────────────

/** jsdom (tests) has no layout: fall back to computed style only; real browsers also check geometry. */
const hasLayout = (doc: Document): boolean => doc.documentElement.getBoundingClientRect().width > 0;

function isVisible(el: HTMLElement): boolean {
  const layout = hasLayout(el.ownerDocument);
  if (layout && el.getClientRects().length === 0) return false;
  if (el.hidden) return false;
  let node: HTMLElement | null = el;
  while (node) {
    const cs = getComputedStyle(node);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    if (layout) {
      const rect = node.getBoundingClientRect();
      if (rect.right < -50 || rect.bottom < -50) return false;
    }
    if (node.getAttribute('aria-hidden') === 'true') return false;
    node = node.parentElement;
  }
  if (!layout) return true;
  const r = el.getBoundingClientRect();
  return r.width > 1 && r.height > 1;
}

function rootOf(el: Element): Document | ShadowRoot {
  const root = el.getRootNode();
  return root instanceof ShadowRoot ? root : el.ownerDocument;
}

function labelText(el: HTMLElement): string | undefined {
  const labelled = (el as HTMLInputElement).labels;
  const fromLabels =
    labelled && labelled.length > 0 ? Array.from(labelled, (l) => l.textContent?.trim() ?? '').join(' ') : '';
  if (fromLabels) return fromLabels.slice(0, 120);
  const byId = el.getAttribute('aria-labelledby');
  if (byId) {
    const root = rootOf(el);
    const t = byId
      .split(/\s+/)
      .map((id) => root.getElementById(id)?.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (t) return t.slice(0, 120);
  }
  const wrap = el.closest('label');
  if (wrap) return (wrap.textContent ?? '').trim().slice(0, 120) || undefined;
  const row = el.closest('div, p, li, td, fieldset');
  if (row) {
    const text = Array.from(row.childNodes)
      .filter((n) => n !== el && !(n instanceof HTMLElement && n.contains(el)))
      .map((n) => n.textContent?.trim() ?? '')
      .join(' ')
      .trim();
    if (text && text.length <= 80) return text;
  }
  return undefined;
}

function currentValue(el: Editable): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)
    return el.value;
  return el.innerText ?? el.textContent ?? '';
}

function candidates(root: Document | ShadowRoot): Editable[] {
  const out: Editable[] = [];
  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>(
      'input, textarea, select, [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]',
    ),
  )) {
    if (el instanceof HTMLInputElement) {
      const t = (el.type || 'text').toLowerCase();
      if (!TEXT_TYPES.has(t) && t !== 'hidden') continue;
    }
    if (el.getAttribute('role') === 'combobox' && !(el instanceof HTMLInputElement)) continue;
    out.push(el);
    if (out.length >= MAX_FIELDS) return out;
  }
  for (const host of Array.from(root.querySelectorAll<HTMLElement>('*'))) {
    if (host.shadowRoot) out.push(...candidates(host.shadowRoot));
    if (out.length >= MAX_FIELDS) break;
  }
  return out.slice(0, MAX_FIELDS);
}

/** Honeypot: hidden input, an invisible input, or a trap-like name/class that is not visible / aria-hidden. */
function isHoneypot(el: HTMLElement, type: string | undefined, visible: boolean, name?: string, id?: string): boolean {
  if (type === 'hidden') return true;
  if (!visible && el instanceof HTMLInputElement) return true;
  const ariaHidden = el.getAttribute('aria-hidden') === 'true' || el.closest('[aria-hidden="true"]') !== null;
  if (ariaHidden && el.getAttribute('tabindex') === '-1') return true;
  if (looksLikeHoneypotName(name, id, el.className) && (ariaHidden || !visible)) return true;
  return false;
}

export function scanPage(doc: Document = document): ScanResult {
  registry.clear();
  scanCounter++;
  const fields: FieldInfo[] = [];
  const byType = new Map<string, number>();
  const forms = new Map<Element, string>();
  for (const el of candidates(doc)) {
    const tag: FieldInfo['tag'] =
      el instanceof HTMLInputElement
        ? 'input'
        : el instanceof HTMLTextAreaElement
          ? 'textarea'
          : el instanceof HTMLSelectElement
            ? 'select'
            : 'contenteditable';
    const type = el instanceof HTMLInputElement ? (el.type || 'text').toLowerCase() : undefined;
    const key = `${tag}:${type ?? ''}`;
    const idx = byType.get(key) ?? 0;
    byType.set(key, idx + 1);
    const visible = isVisible(el) && type !== 'hidden';
    const name = clip(el.getAttribute('name'));
    const id = clip(el.id);
    const form = el.closest('form');
    let formId = 'root';
    if (form) {
      formId = forms.get(form) ?? `form${forms.size + 1}`;
      forms.set(form, formId);
    }
    const fieldId = `${DOC_TOKEN}-s${scanCounter}-${fields.length}`;
    registry.set(fieldId, el);
    const info: FieldInfo = {
      fieldId,
      formId,
      frame: '',
      tag,
      type,
      name,
      id,
      autocomplete: clip(el.getAttribute('autocomplete')),
      accept: type === 'file' ? clip(el.getAttribute('accept')) : undefined,
      label: clip(labelText(el)),
      placeholder: clip(el.getAttribute('placeholder')),
      ariaLabel: clip(el.getAttribute('aria-label')),
      sameTypeIndex: idx,
      maxLength:
        el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement
          ? el.maxLength > 0
            ? el.maxLength
            : undefined
          : undefined,
      visible,
      honeypot: isHoneypot(el, type, visible, name, id),
      required: (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true' || undefined,
      filled: currentValue(el).trim() !== '',
    };
    if (el instanceof HTMLSelectElement)
      info.options = Array.from(el.options)
        .slice(0, MAX_OPTIONS)
        .map((o) => ({ value: o.value.slice(0, MAX_ATTR), label: (o.textContent?.trim() ?? '').slice(0, MAX_ATTR) }));
    fields.push(info);
  }
  // Second pass (spec §5): a visible field with a trap-like name/class is a honeypot when another
  // visible field of the same kind exists in the same form (the real one); alone, it is real.
  for (const f of fields) {
    if (f.honeypot || !f.visible) continue;
    const el = registry.get(f.fieldId);
    if (!el) continue;
    const trapByAncestor = el.closest('[class*="honeypot"], [class*="-hp"], [class*="_hp"], [class*="hp-"]') !== null;
    if (!looksLikeHoneypotName(f.name, f.id, el.className) && !trapByAncestor) continue;
    const hasRealSibling = fields.some(
      (o) =>
        o !== f &&
        o.visible &&
        !o.honeypot &&
        o.formId === f.formId &&
        o.tag === f.tag &&
        o.type === f.type &&
        !looksLikeHoneypotName(o.name, o.id, undefined),
    );
    if (hasRealSibling) f.honeypot = true;
  }
  const links: ScanResult['links'] = [];
  for (const a of Array.from(doc.querySelectorAll<HTMLAnchorElement>('a[href]'))) {
    const href = a.getAttribute('href') ?? '';
    const text = (a.textContent ?? '').trim().slice(0, 80);
    if (/^mailto:/i.test(href)) links.push({ href: href.slice(0, MAX_ATTR), text, kind: 'mailto' });
    else if (/contact|контакт|связ|kontakt|contacto|about|press|impressum/i.test(`${href} ${text}`))
      links.push({ href: a.href.slice(0, MAX_ATTR), text, kind: 'contact' });
    if (links.length >= MAX_LINKS) break;
  }
  return {
    token: DOC_TOKEN,
    url: doc.location.href,
    origin: doc.location.origin,
    title: doc.title.slice(0, MAX_ATTR),
    fields,
    links,
  };
}

// ── Fill (spec §6 ladder with read-back) ───────────────────────────────────────

/** Only width-less characters that never carry meaning; U+200C/U+200D (joiners) are kept. */
const normalize = (s: string): string =>
  s
    .replace(/ /g, ' ')
    .replace(/​|﻿/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();

/** Let framework re-renders run before we trust what we read back. */
const settle = (): Promise<void> =>
  new Promise((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(resolve, 30));
    else setTimeout(resolve, 30);
  });

function setNative(el: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

function readBack(el: Editable, expected: string, before: string): FillOutcome {
  const now = normalize(currentValue(el));
  const want = normalize(expected);
  if (now === want) return 'exact';
  if (now.replace(/\s+/g, '') === want.replace(/\s+/g, '')) return 'equivalent';
  if (now === normalize(before)) return 'partial';
  if (now.includes(want)) return 'changedBySite';
  return 'partial';
}

/** ADR 0010 E3 rung 1: File → DataTransfer → input.files + change; read-back by file name. */
async function fillFile(el: HTMLInputElement, item: FillInstruction): Promise<FillReportItem> {
  const f = item.file;
  if (!f) return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagNoFilePayload') };
  if (item.policy === 'skipIfFilled' && el.files && el.files.length > 0)
    return { slot: item.slot, outcome: 'skippedNonEmpty', method: 'none' };
  if (typeof DataTransfer === 'undefined')
    return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagNoDataTransfer') };
  try {
    const bin = atob(f.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], f.name, { type: f.mime });
    const dt = new DataTransfer();
    dt.items.add(file);
    el.files = dt.files;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    const ok = el.files?.[0]?.name === f.name;
    return ok
      ? { slot: item.slot, outcome: 'exact', method: 'native' }
      : { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagFilesRejected') };
  } catch (err) {
    return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: (err as Error).message };
  }
}

async function fillSelect(el: HTMLSelectElement, item: FillInstruction): Promise<FillReportItem> {
  const v = item.value.trim().toLowerCase();
  const options = Array.from(el.options);
  const opt =
    options.find((o) => o.value.toLowerCase() === v) ??
    options.find((o) => (o.textContent ?? '').trim().toLowerCase() === v) ??
    options.find((o) => (o.textContent ?? '').trim().toLowerCase().includes(v));
  if (!opt) return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagNoOption') };
  // "Skip if filled": a select with a real choice (not the placeholder first option) is left alone.
  if (item.policy === 'skipIfFilled' && el.selectedIndex > 0 && el.value !== '')
    return { slot: item.slot, outcome: 'skippedNonEmpty', method: 'none' };
  const before = el.value;
  el.value = opt.value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
  if (el.value === opt.value) return { slot: item.slot, outcome: 'exact', method: 'select' };
  el.value = before;
  return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagSelectReverted') };
}

export async function fillOne(item: FillInstruction, fields: FieldInfo[]): Promise<FillReportItem> {
  const byId = item.fieldId ? elementFor(item.fieldId) : undefined;
  const resolved = byId ? undefined : resolveField(item.fingerprint, fields);
  const el = byId ?? (resolved ? elementFor(resolved.field.fieldId) : undefined);
  if (!el) return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagFieldNotFound') };

  if (el instanceof HTMLInputElement && el.type === 'file') return fillFile(el, item);
  if (el instanceof HTMLSelectElement) return fillSelect(el, item);

  const before = currentValue(el);
  if (item.policy === 'skipIfFilled' && before.trim() !== '')
    return { slot: item.slot, outcome: 'skippedNonEmpty', method: 'none' };

  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    const start = el.selectionStart ?? before.length;
    const end = el.selectionEnd ?? before.length;
    const value =
      item.policy === 'insertAtCursor' ? before.slice(0, start) + item.value + before.slice(end) : item.value;
    setNative(el, value);
    await settle();
    const outcome = readBack(el, value, before);
    if (outcome === 'exact' || outcome === 'equivalent' || outcome === 'changedBySite')
      return { slot: item.slot, outcome, method: 'native' };
    setNative(el, before);
    return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagValueReverted') };
  }

  // contenteditable (Gmail, LinkedIn, Telegram Web…): R0 contract = focus + clipboard (ADR 0011 p.1).
  el.focus();
  return { slot: item.slot, outcome: 'clipboard', method: 'none', detail: t('flagRichEditor') };
}

export async function fillAll(items: FillInstruction[], fields: FieldInfo[]): Promise<FillReportItem[]> {
  const out: FillReportItem[] = [];
  for (const i of items) out.push(await fillOne(i, fields));
  return out;
}

// ── Highlight / picker ─────────────────────────────────────────────────────────

const OUTLINE = '2px solid #4DA3FF';

export function highlight(fieldIds: string[], ms = 1200): void {
  for (const id of fieldIds) {
    const el = elementFor(id);
    if (!el) continue;
    const prev = el.style.outline;
    const prevOffset = el.style.outlineOffset;
    el.style.outline = OUTLINE;
    el.style.outlineOffset = '2px';
    window.setTimeout(() => {
      el.style.outline = prev;
      el.style.outlineOffset = prevOffset;
    }, ms);
  }
}

let pickCleanup: (() => void) | null = null;

const EDITABLE_SELECTOR = 'input, textarea, select, [contenteditable]';

function editableFromEvent(e: Event): HTMLElement | null {
  // composedPath() reaches into open shadow roots where event.target is retargeted to the host.
  for (const node of e.composedPath()) {
    if (node instanceof HTMLElement && node.matches(EDITABLE_SELECTOR)) return node;
  }
  return null;
}

/** Point-at-field: hover outline on candidates, click selects, Esc cancels (spec §14.5). */
export function startPick(onDone: (field: FieldInfo | null) => void): void {
  cancelPick();
  const scan = scanPage();
  const byEl = new Map<Editable, FieldInfo>();
  for (const f of scan.fields) {
    const el = elementFor(f.fieldId);
    if (el && f.visible && !f.honeypot) byEl.set(el, f);
  }
  let hovered: HTMLElement | null = null;
  let prevOutline = '';
  const over = (e: Event): void => {
    const el = editableFromEvent(e);
    if (hovered && hovered !== el) hovered.style.outline = prevOutline;
    if (el && byEl.has(el as Editable)) {
      hovered = el;
      prevOutline = el.style.outline;
      el.style.outline = OUTLINE;
    } else hovered = null;
  };
  const click = (e: MouseEvent): void => {
    const el = editableFromEvent(e);
    if (!el || !byEl.has(el as Editable)) return;
    e.preventDefault();
    e.stopPropagation();
    const f = byEl.get(el as Editable) ?? null;
    cancelPick();
    onDone(f);
  };
  const key = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') {
      cancelPick();
      onDone(null);
    }
  };
  document.addEventListener('mouseover', over, true);
  document.addEventListener('click', click, true);
  document.addEventListener('keydown', key, true);
  document.documentElement.style.cursor = 'crosshair';
  pickCleanup = () => {
    document.removeEventListener('mouseover', over, true);
    document.removeEventListener('click', click, true);
    document.removeEventListener('keydown', key, true);
    document.documentElement.style.cursor = '';
    if (hovered) hovered.style.outline = prevOutline;
  };
}

export function cancelPick(): void {
  pickCleanup?.();
  pickCleanup = null;
}
