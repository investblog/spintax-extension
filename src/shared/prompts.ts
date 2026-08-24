/**
 * Prompt handoff (spec §14.3, ADR 0011 p.8): the canonical authoring prompt from
 * @spintax/authoring-prompt, fed with the campaign's variables, copied by the user into their
 * own chat; the answer is pasted back and validated. No keys, no network from the extension.
 */
import {
  type AllowedVariable,
  type BuiltPrompt,
  buildAuthoringPrompt,
  buildRepairPrompt,
  type Channel,
  cleanModelTemplate,
  PROMPT_VERSION,
  type VariationLevel,
} from '@spintax/authoring-prompt';
import type { Diagnostic } from '@spintax/core';
import { DERIVED_VARIABLES, PROFILE_VARIABLES } from './engine';
import type { Campaign, Row } from './model';

export type { Channel, VariationLevel };
export { PROMPT_VERSION };

/** One line per variable: samples, emptiness share, the author's hint (§14.3 step 1). */
export function describeVariables(
  campaign: Campaign,
  rows: Row[],
  opts: { samples?: boolean } = {},
): AllowedVariable[] {
  const includeSamples = opts.samples ?? true;
  const out: AllowedVariable[] = [];
  for (const c of campaign.columns) {
    if (c.type !== 'text' || c.hidden) continue;
    const values = rows.map((r) => (r.values[c.id] ?? '').trim());
    const filled = values.filter((v) => v !== '');
    const emptyShare = values.length ? Math.round(((values.length - filled.length) / values.length) * 100) : 0;
    const parts: string[] = [];
    if (c.promptNote) parts.push(c.promptNote);
    if (includeSamples && filled.length > 0) {
      const samples = Array.from(new Set(filled))
        .slice(0, 2)
        .map((v) => `"${v.length > 40 ? `${v.slice(0, 37)}…` : v}"`);
      parts.push(`e.g. ${samples.join(', ')}`);
    }
    if (emptyShare > 0 && !c.defaultValue)
      parts.push(`may be empty (${emptyShare}% of rows) — guard with {?${c.variable}?…|…}`);
    if (c.defaultValue) parts.push(`empty cells fall back to "${c.defaultValue}"`);
    out.push(
      parts.length || c.grammaticalCase
        ? { name: c.variable, case: c.grammaticalCase, note: parts.join('; ') || undefined }
        : c.variable,
    );
  }
  out.push(
    { name: 'my_name', note: 'sender name — do not inflect' },
    { name: 'my_site', note: 'sender site' },
    { name: 'domain', note: "recipient's domain" },
  );
  return out;
}

export interface HandoffOptions {
  brief: string;
  locale: string;
  channel: Channel;
  variationLevel: VariationLevel;
  samples: boolean;
}

export function buildHandoff(campaign: Campaign, rows: Row[], opts: HandoffOptions): BuiltPrompt {
  return buildAuthoringPrompt({
    brief: opts.brief,
    locale: opts.locale,
    channel: opts.channel,
    variationLevel: opts.variationLevel,
    allowedVariables: describeVariables(campaign, rows, { samples: opts.samples }),
  });
}

/** One text block for a chat window: system instructions first, then the request. */
export function handoffText(built: BuiltPrompt): string {
  return `${built.systemPrompt.trim()}\n\n---\n\n${built.userPrompt.trim()}`;
}

export const CHATGPT_URL_LIMIT = 8_000;
export const CLAUDE_DESKTOP_URL_LIMIT = 14_000;

/** chatgpt.com prefill (undocumented, prefill-only); null when the text is too long for a URL. */
export function chatGptUrl(text: string): string | null {
  if (text.length > CHATGPT_URL_LIMIT) return null;
  return `https://chatgpt.com/?q=${encodeURIComponent(text)}`;
}

/** Claude Desktop deep link (official, prefill-only, ~14k chars). */
export function claudeDesktopUrl(text: string): string | null {
  if (text.length > CLAUDE_DESKTOP_URL_LIMIT) return null;
  return `claude://claude.ai/new?q=${encodeURIComponent(text)}`;
}

export function repairHandoff(
  template: string,
  diagnostics: readonly Diagnostic[],
  locale: string,
  allowed: readonly AllowedVariable[],
): BuiltPrompt {
  return buildRepairPrompt(template, diagnostics, { locale, allowedVariables: allowed });
}

/**
 * Paste-back scrubber: the package strips fences/labels/wrapping quotes; on top, drop
 * markdown emphasis that chats add around the whole answer. Inner quotes are kept — they may be
 * the author's (e.g. «…» in Russian copy).
 */
export function cleanPasted(raw: string): string {
  let s = cleanModelTemplate(raw);
  s = s.replace(/^\*\*([\s\S]*)\*\*$/m, '$1').trim();
  return s;
}

/** The user's all-known allow-list for the repair prompt (columns + derived + profile). */
export function allKnownVariables(campaign: Campaign): string[] {
  return [
    ...campaign.columns.filter((c) => c.type === 'text' && !c.hidden).map((c) => c.variable),
    ...DERIVED_VARIABLES,
    ...PROFILE_VARIABLES,
  ];
}

/** Situational prompt (spec §14.3): ask an AI chat to name the columns of a header-less list. */
export function columnNamingPrompt(headers: string[], rows: string[][], sample = 5): string {
  const lines = rows.slice(0, sample).map((r) => r.map((c) => c.replace(/\t/g, ' ').slice(0, 60)).join('\t'));
  return [
    'Below are the first rows of a contact list (tab-separated) with the current column names in the first line.',
    'Propose a short English snake_case name for EVERY column, in the same order (e.g. id, email, phone, telegram_handle, channel, role).',
    'Reply with ONE line only: the names separated by ";" — nothing else.',
    '',
    headers.join('\t'),
    ...lines,
  ].join('\n');
}

/** Parse the one-line reply of columnNamingPrompt; null when the count does not match. */
export function parseColumnNames(reply: string, count: number): string[] | null {
  const line = reply
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .pop();
  if (!line) return null;
  const names = line
    .replace(/^[`'"]+|[`'"]+$/g, '')
    .split(/[;,\t|]/)
    .map((n) => n.trim())
    .filter(Boolean);
  return names.length === count ? names : null;
}
