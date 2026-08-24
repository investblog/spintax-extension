/**
 * Messages between the side panel, the background and the on-demand content script.
 * Only JSON-serializable payloads (extension messaging is structured-clone in Firefox but JSON
 * in Chrome — keep to plain data). Spec §5, §6, §14.5.
 */
import type { FieldInfo } from './fields';
import type { FieldFingerprint, FillOutcome, FillPolicy, Slot } from './model';

export interface ScanResult {
  /** Random per-document token; a fill request carries it and is refused after a navigation. */
  token: string;
  url: string;
  origin: string;
  title: string;
  fields: FieldInfo[];
  /** mailto: and contact-ish links found on the page (spec §14.5 "no form" helper). */
  links: { href: string; text: string; kind: 'mailto' | 'contact' }[];
}

export interface FillInstruction {
  slot: Slot;
  fingerprint: FieldFingerprint;
  /** Per-scan id when the panel already holds a scan (fast path); fingerprint is the fallback. */
  fieldId?: string;
  value: string;
  policy: FillPolicy;
  /** For <input type=file>: the asset bytes (base64) — ADR 0010 E3 rung 1. */
  file?: { name: string; mime: string; base64: string };
}

export interface FillReportItem {
  slot: Slot;
  outcome: FillOutcome;
  /** Which rung of the ladder succeeded (spec §6). */
  method?: 'native' | 'execCommand' | 'synthetic' | 'select' | 'none';
  detail?: string;
}

export type ContentRequest =
  | { type: 'ping' }
  | { type: 'scan' }
  | { type: 'fill'; items: FillInstruction[]; token?: string }
  | { type: 'highlight'; fieldIds: string[] }
  | { type: 'pick' }
  | { type: 'cancelPick' };

export type ContentResponse =
  | { ok: true; type: 'pong'; version: number }
  | { ok: true; type: 'scan'; result: ScanResult }
  | { ok: true; type: 'fill'; report: FillReportItem[] }
  | { ok: true; type: 'highlight' }
  | { ok: true; type: 'pick'; field: FieldInfo | null }
  | { ok: true; type: 'cancelPick' }
  | { ok: false; error: string };

/** Background → panel (keyboard commands) and content → panel (picker result). */
export type RuntimeMessage =
  | { type: 'command'; command: string; tabId?: number; windowId?: number }
  | { type: 'picked'; field: FieldInfo | null; tabId?: number }
  /** Sent by the options page after any write: the side panel reloads its campaign and rows. */
  | { type: 'data-changed' };

export const CONTENT_SCRIPT_VERSION = 1;
