/**
 * Heuristic mapping slot → field (spec §5 order: autocomplete → type → name/id/aria/placeholder/
 * label regexes (multilingual, Chromium-style) → single textarea = body; short text near
 * "subject" = subject). Pure; the content script supplies FieldInfo[]. Confidence is computed
 * HERE, never by a model (ADR 0011 p.6).
 *
 * Fields are grouped by form (`formId`): the page's login / newsletter / search boxes must not be
 * stitched together with the contact form's textarea. One form wins — the one whose mapping
 * scores highest (a body field counts double).
 */
import type { FieldInfo } from './fields';
import type { ColumnDef, RecipeField, Slot } from './model';

export const CORE_SLOTS: Slot[] = [
  'profile.name',
  'profile.email',
  'profile.site',
  'profile.phone',
  'output.subject',
  'output.body',
];

/** `\b` is ASCII-only in JS regexes; use Unicode-aware boundaries so Cyrillic labels match. */
const words = (list: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])(?:${list})(?![\\p{L}\\p{N}])`, 'iu');

const RX: Record<Exclude<Slot, `row.${string}`>, RegExp> = {
  'profile.name': words(
    'first.?name|full.?name|your.?name|name|contact.?name|имя|фио|ваше.?имя|vorname|nachname|nombre|nom|prénom|nome|ad[ıi]|isim',
  ),
  'profile.email': /(e-?mail|почта|эл\.?\s*почта|correo|courriel|e-?posta)/iu,
  'profile.site': words('website|web.?site|site|url|homepage|сайт|веб-?сайт|ссылка|página|seite|web'),
  'profile.phone': words('phone|tel(?:ephone)?|mobile|телефон|тел|teléfono|téléphone|telefon|handy|celular'),
  'output.subject': words('subject|topic|title|тема|заголовок|betreff|asunto|sujet|objet|assunto|konu'),
  'output.body': words(
    'message|msg|body|comments?|question|enquiry|inquiry|text|сообщение|текст|вопрос|комментарий|nachricht|mensaje|mensagem|mesaj|details|description',
  ),
};

/** Anti-signals: a field that matches these is NOT the sender's name/site/etc. */
const NEGATIVE: Partial<Record<Slot, RegExp>> = {
  'profile.name': words(
    'company|organi[sz]ation|business|user.?name|login|nick|product|project|item|app|title|компани[яи]?|организаци[яи]?|логин|last.?name|surname|фамилия|название',
  ),
  'profile.site': words('linkedin|twitter|facebook|instagram|social'),
  'profile.email': words('confirm|repeat|verify|again|повтор|подтверд'),
};

/** Fields that belong to other flows on the same page (login, search, newsletter, password). */
const FOREIGN = words(
  'password|passwd|pwd|search|поиск|suche|buscar|recherche|newsletter|subscribe|подписк|login|signin|sign-in',
);

const AUTOCOMPLETE: Record<string, Slot> = {
  name: 'profile.name',
  'given-name': 'profile.name',
  email: 'profile.email',
  url: 'profile.site',
  tel: 'profile.phone',
  'tel-national': 'profile.phone',
};

export interface SlotGuess {
  slot: Slot;
  field: FieldInfo;
  confidence: number;
  reason: string;
}

function textOf(f: FieldInfo): string {
  return [f.name, f.id, f.ariaLabel, f.placeholder, f.label].filter(Boolean).join(' ');
}

/** Column headers become patterns for `row.<id>` slots (scenario E: "Logo", "Short description"). */
export interface RowSlotSpec {
  slot: Slot;
  header: string;
  type: ColumnDef['type'];
}

function headerTokens(header: string): RegExp[] {
  return header
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3)
    .map((t) => words(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
}

function scoreCore(slot: Slot, f: FieldInfo): { score: number; reason: string } | null {
  const rx = RX[slot as keyof typeof RX];
  if (!rx) return null;
  const text = textOf(f);
  if (NEGATIVE[slot]?.test(text)) return null;
  if (FOREIGN.test(text)) return null;
  const type = (f.type ?? '').toLowerCase();
  if (type === 'file') return null;

  const ac = (f.autocomplete ?? '')
    .toLowerCase()
    .split(/\s+/)
    .find((t) => AUTOCOMPLETE[t]);
  if (ac && AUTOCOMPLETE[ac] === slot) return { score: 0.98, reason: `autocomplete=${ac}` };
  if (ac && AUTOCOMPLETE[ac] !== slot) return null;

  if (slot === 'profile.email' && type === 'email') return { score: 0.97, reason: 'type=email' };
  if (slot === 'profile.phone' && type === 'tel') return { score: 0.95, reason: 'type=tel' };
  if (slot === 'profile.site' && type === 'url') return { score: 0.95, reason: 'type=url' };
  if (['email', 'tel', 'url', 'password', 'number', 'date', 'checkbox', 'radio', 'hidden', 'submit'].includes(type))
    return null;

  if (slot === 'output.body') {
    if (f.tag === 'textarea' || f.tag === 'contenteditable') {
      const named = rx.test(text);
      return { score: named ? 0.95 : 0.8, reason: named ? 'textarea + name' : 'textarea' };
    }
    return null;
  }
  if (f.tag === 'textarea' || f.tag === 'contenteditable' || f.tag === 'select') return null;

  if (rx.test(text)) {
    const byLabel = f.label && rx.test(f.label);
    return { score: byLabel ? 0.9 : 0.8, reason: byLabel ? 'label' : 'name/placeholder' };
  }
  return null;
}

/**
 * Row columns match by header-token COVERAGE, so "Short description" prefers the field whose text
 * has both tokens over one that has only "description" (review 2026-08-23 #9).
 */
function scoreRow(spec: RowSlotSpec, f: FieldInfo): { score: number; reason: string } | null {
  const isFile = (f.type ?? '') === 'file';
  if ((spec.type === 'file') !== isFile) return null;
  const tokens = headerTokens(spec.header);
  if (tokens.length === 0) return null;
  const text = textOf(f);
  const matched = tokens.filter((rx) => rx.test(text)).length;
  if (matched === 0) return null;
  const coverage = matched / tokens.length;
  const byLabel = !!f.label && tokens.every((rx) => rx.test(f.label ?? ''));
  return {
    score: 0.55 + 0.3 * coverage + (byLabel ? 0.05 : 0),
    reason: `column header (${matched}/${tokens.length} words)`,
  };
}

function groupByForm(fields: FieldInfo[]): Map<string, FieldInfo[]> {
  const groups = new Map<string, FieldInfo[]>();
  for (const f of fields) {
    if (!f.visible || f.honeypot) continue;
    const key = f.formId ?? 'root';
    const list = groups.get(key) ?? [];
    list.push(f);
    groups.set(key, list);
  }
  return groups;
}

function mapGroup(fields: FieldInfo[], slots: Slot[], rowSpecs: RowSlotSpec[]): SlotGuess[] {
  const candidates: SlotGuess[] = [];
  for (const slot of slots) {
    const spec = rowSpecs.find((s) => s.slot === slot);
    for (const f of fields) {
      const s = spec ? scoreRow(spec, f) : scoreCore(slot, f);
      if (s) candidates.push({ slot, field: f, confidence: s.score, reason: s.reason });
    }
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  const usedSlots = new Set<Slot>();
  const usedFields = new Set<string>();
  const mapped: SlotGuess[] = [];
  for (const c of candidates) {
    if (usedSlots.has(c.slot) || usedFields.has(c.field.fieldId)) continue;
    usedSlots.add(c.slot);
    usedFields.add(c.field.fieldId);
    mapped.push(c);
  }
  // A lone unnamed textarea in THIS form is still the body (two-field contact forms).
  if (!usedSlots.has('output.body') && slots.includes('output.body')) {
    const areas = fields.filter(
      (f) =>
        (f.tag === 'textarea' || f.tag === 'contenteditable') && !usedFields.has(f.fieldId) && !FOREIGN.test(textOf(f)),
    );
    if (areas.length === 1 && areas[0])
      mapped.push({ slot: 'output.body', field: areas[0], confidence: 0.7, reason: 'only textarea' });
  }
  return mapped;
}

export interface MapResult {
  mapped: SlotGuess[];
  unmapped: Slot[];
  /** The form (formId) the mapping was taken from; 'root' for fields outside any form. */
  formId: string;
}

/**
 * Map each slot to at most one field (and each field to at most one slot), highest confidence
 * first, within ONE form. Unmapped slots are returned so the panel can offer "Point at field".
 */
export function mapSlots(fields: FieldInfo[], slots: Slot[] = CORE_SLOTS, rowSpecs: RowSlotSpec[] = []): MapResult {
  const groups = groupByForm(fields);
  let best: MapResult | null = null;
  let bestScore = -1;
  for (const [formId, group] of groups) {
    const mapped = mapGroup(group, slots, rowSpecs);
    const hasBody = mapped.some((m) => m.slot === 'output.body');
    const score = mapped.reduce((s, m) => s + m.confidence, 0) + (hasBody ? 2 : 0);
    if (score > bestScore) {
      bestScore = score;
      const usedSlots = new Set(mapped.map((m) => m.slot));
      best = { mapped, unmapped: slots.filter((s) => !usedSlots.has(s)), formId };
    }
  }
  return best ?? { mapped: [], unmapped: [...slots], formId: 'root' };
}

/** "Store icon (128×128 PNG)", "1280 x 800" → expected image size from a field's label/placeholder. */
export function imageSizeHint(text: string): { width: number; height: number } | null {
  const m = /(\d{2,4})\s*[x×X]\s*(\d{2,4})/u.exec(text);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  return width >= 16 && height >= 16 ? { width, height } : null;
}

/** Constraints a field declares about itself: maxlength, expected image size for file inputs. */
export function fieldConstraints(f: FieldInfo): RecipeField['constraints'] {
  const out: RecipeField['constraints'] = [];
  if (f.maxLength) out.push({ kind: 'maxLength', value: f.maxLength, level: 'blocking' });
  if ((f.type ?? '') === 'file') {
    const size = imageSizeHint(textOf(f));
    if (size) out.push({ kind: 'imageSize', ...size, level: 'warning' });
    const allow = (f.accept ?? '')
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    if (allow.length > 0) out.push({ kind: 'mime', allow, level: 'blocking' });
  }
  return out;
}

/** Convert guesses into recipe fields (manual=false); constraints from the field itself. */
export function toRecipeFields(guesses: SlotGuess[]): RecipeField[] {
  return guesses.map((g) => ({
    slot: g.slot,
    fingerprint: stripInfo(g.field),
    confidence: g.confidence,
    manual: false,
    fillPolicy: g.field.tag === 'select' ? 'replace' : 'skipIfFilled',
    constraints: fieldConstraints(g.field),
  }));
}

/** Persisted fingerprint part of a FieldInfo. */
export function stripInfo(f: FieldInfo): RecipeField['fingerprint'] {
  const { frame, tag, type, name, id, autocomplete, label, placeholder, ariaLabel, sameTypeIndex, maxLength } = f;
  return { frame, tag, type, name, id, autocomplete, label, placeholder, ariaLabel, sameTypeIndex, maxLength };
}
