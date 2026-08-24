import { describe, expect, it } from 'vitest';
import type { Campaign, Row } from './model';
import {
  buildHandoff,
  chatGptUrl,
  claudeDesktopUrl,
  cleanPasted,
  columnNamingPrompt,
  describeVariables,
  handoffText,
  parseColumnNames,
  repairHandoff,
} from './prompts';

const campaign: Campaign = {
  id: 'c',
  schemaVersion: 1,
  name: 'T',
  scenario: 'outreach',
  columns: [
    {
      id: 'c1',
      header: 'Имя',
      variable: 'imya',
      role: 'none',
      type: 'text',
      fillable: false,
      grammaticalCase: 'nominative',
    },
    {
      id: 'c2',
      header: 'Topic',
      variable: 'topic',
      role: 'none',
      type: 'text',
      fillable: false,
      defaultValue: 'your niche',
    },
    {
      id: 'c3',
      header: 'Site',
      variable: 'site',
      role: 'target',
      type: 'text',
      fillable: false,
      promptNote: 'brand name — do not inflect',
    },
    { id: 'c4', header: 'Logo', variable: 'logo', role: 'none', type: 'file', fillable: true },
  ],
  profiles: [],
  steps: [{ step: 1, kind: 'initial' }],
  defaultLocale: 'ru',
  wizardStep: 3,
  createdAt: '',
  updatedAt: '',
};

const row = (values: Record<string, string>): Row => ({
  rowId: crypto.randomUUID(),
  campaignId: 'c',
  seedKey: 'x',
  target: 'x.com',
  targetKind: 'url',
  values,
  deliveryStatus: 'not_started',
  reviewState: 'unreviewed',
  followupState: 'none',
  currentStep: 1,
  salt: 0,
  createdAt: '',
  updatedAt: '',
});

const rows = [row({ c1: 'Анна', c2: 'crypto', c3: 'a.com' }), row({ c1: '', c2: 'slots', c3: 'b.io' })];

describe('describeVariables', () => {
  it('adds samples, emptiness guard, default and notes; skips file columns', () => {
    const vars = describeVariables(campaign, rows);
    const byName: Record<string, { note?: string; case?: string }> = Object.fromEntries(
      vars.map((v) => (typeof v === 'string' ? [v, {}] : [v.name, v])),
    );
    expect(byName.imya).toMatchObject({ case: 'nominative' });
    expect(String(byName.imya?.note)).toContain('may be empty (50% of rows)');
    expect(String(byName.imya?.note)).toContain('{?imya?');
    expect(String(byName.topic?.note)).toContain('fall back to "your niche"');
    expect(String(byName.site?.note)).toContain('brand name');
    expect(String(byName.site?.note)).toContain('e.g. "a.com", "b.io"');
    expect(byName.logo).toBeUndefined();
    expect(byName.my_name).toBeDefined();
  });
  it('omits samples when asked (pre-screen privacy switch)', () => {
    const vars = describeVariables(campaign, rows, { samples: false });
    const site = vars.find((v) => typeof v !== 'string' && v.name === 'site');
    expect(String((site as { note?: string }).note)).not.toContain('e.g.');
  });
});

describe('handoff', () => {
  it('builds a prompt that lists only allowed variables and carries the version', () => {
    const built = buildHandoff(campaign, rows, {
      brief: 'Short outreach note',
      locale: 'ru',
      channel: 'email',
      variationLevel: 'balanced',
      samples: true,
    });
    expect(built.promptVersion).toBe('2');
    expect(built.allowedVariables).toContain('imya');
    expect(built.allowedVariables).not.toContain('logo');
    const text = handoffText(built);
    expect(text).toContain('Short outreach note');
    expect(text).toContain('%imya%');
  });
  it('prefill URLs respect length limits', () => {
    expect(chatGptUrl('hi')).toMatch(/^https:\/\/chatgpt\.com\/\?q=hi$/);
    expect(chatGptUrl('x'.repeat(9_000))).toBeNull();
    expect(claudeDesktopUrl('x'.repeat(9_000))).toMatch(/^claude:\/\/claude\.ai\/new\?q=/);
    expect(claudeDesktopUrl('x'.repeat(15_000))).toBeNull();
  });
  it('repair prompt carries the diagnostics and the allow-list', () => {
    const built = repairHandoff(
      '{Hi|Hello %name%',
      [{ severity: 'error', code: 'bracket.unclosed', message: 'Unclosed {', line: 1, column: 1 }],
      'en',
      ['name'],
    );
    expect(built.userPrompt).toContain('bracket.unclosed');
    expect(built.allowedVariables).toEqual(['name']);
  });
  it('cleanPasted strips fences and whole-answer emphasis, keeps inner quotes', () => {
    expect(cleanPasted('```spintax\n{Hi|Hello} %name%\n```')).toBe('{Hi|Hello} %name%');
    expect(cleanPasted('**{Hi|Hello} «%name%»**')).toBe('{Hi|Hello} «%name%»');
  });
});

describe('column naming handoff', () => {
  it('builds a one-line-answer prompt and parses the reply', () => {
    const p = columnNamingPrompt(['col_1', 'col_2'], [['265712', 'a@b.c']]);
    expect(p).toContain('col_1\tcol_2');
    expect(p).toContain('265712\ta@b.c');
    expect(parseColumnNames('Sure!\nid; email', 2)).toEqual(['id', 'email']);
    expect(parseColumnNames('`id, email, phone`', 3)).toEqual(['id', 'email', 'phone']);
    expect(parseColumnNames('id; email', 3)).toBeNull();
  });
});
