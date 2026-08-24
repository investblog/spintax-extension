/**
 * Field constraints checked BEFORE a value is inserted (spec §16.3, ADR 0011 p.7): a blocking
 * violation keeps the value out of the page and tells the user; a warning fills and tells.
 * Pure — the panel's fillTab applies it per mapped slot.
 */
import { t } from './i18n';
import type { Constraint } from './model';

export interface Violation {
  level: Constraint['level'];
  message: string;
}

const words = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;

export function checkConstraints(value: string, constraints: Constraint[]): Violation[] {
  const out: Violation[] = [];
  const len = [...value].length;
  for (const c of constraints) {
    switch (c.kind) {
      case 'maxLength':
        if (len > c.value) out.push({ level: c.level, message: t('warnMaxLength', String(len), String(c.value)) });
        break;
      case 'minLength':
        if (len < c.value) out.push({ level: c.level, message: t('warnMinLength', String(len), String(c.value)) });
        break;
      case 'maxWords':
        if (words(value) > c.value)
          out.push({ level: c.level, message: t('warnMaxWords', String(words(value)), String(c.value)) });
        break;
      default:
        break;
    }
  }
  return out;
}

/** <input accept> semantics: "image/*", "image/png" or ".png" entries; empty list = anything. */
export function mimeAllowed(mime: string, name: string, allow: string[]): boolean {
  if (allow.length === 0) return true;
  const ext = name.toLowerCase().replace(/^.*\./, '.');
  const type = mime.toLowerCase();
  return allow.some((raw) => {
    const a = raw.trim().toLowerCase();
    if (!a) return false;
    if (a.startsWith('.')) return ext === a;
    if (a.endsWith('/*')) return type.startsWith(a.slice(0, -1));
    return type === a;
  });
}

/** A field's maxlength from the DOM is treated as blocking: a truncated message is never wanted. */
export function isBlocking(violations: Violation[]): boolean {
  return violations.some((v) => v.level === 'blocking');
}
