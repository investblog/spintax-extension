import { describe, expect, it } from 'vitest';
import {
  analyzeTemplate,
  buildContext,
  checkConstraints,
  ENGINE_VERSION,
  emptyVariableWarnings,
  nearestVariable,
  pickProfile,
  renderRow,
  renderWithHighlights,
} from './engine';
import type { Campaign, Row, Template } from './model';

const campaign: Campaign = {
  id: 'c',
  schemaVersion: 1,
  name: 'T',
  scenario: 'outreach',
  columns: [
    { id: 'c1', header: 'Name', variable: 'name', role: 'none', type: 'text', fillable: false },
    {
      id: 'c2',
      header: 'Topic',
      variable: 'topic',
      role: 'none',
      type: 'text',
      fillable: false,
      defaultValue: 'your niche',
    },
    { id: 'c3', header: 'Site', variable: 'site', role: 'target', type: 'text', fillable: false },
  ],
  profiles: [
    {
      id: 'p1',
      name: 'RU',
      values: { name: 'Иван', email: 'i@301.st' },
      activation: { kind: 'column', columnId: 'c1', equals: 'Анна' },
    },
    {
      id: 'p2',
      name: 'EN',
      values: { name: 'Ivan', email: 'ivan@301.st', site: '301.st' },
      activation: { kind: 'always' },
    },
  ],
  steps: [{ step: 1, kind: 'initial' }],
  defaultLocale: 'en',
  wizardStep: 'done',
  createdAt: '',
  updatedAt: '',
};

const row: Row = {
  rowId: 'r1',
  campaignId: 'c',
  seedKey: 'a.com',
  target: 'https://a.com/contact',
  targetKind: 'url',
  values: { c1: 'Анна', c2: '', c3: 'https://a.com/contact' },
  deliveryStatus: 'not_started',
  reviewState: 'unreviewed',
  followupState: 'none',
  currentStep: 1,
  salt: 0,
  createdAt: '',
  updatedAt: '',
};

const tpl = (source: string): Template => ({
  id: 't',
  campaignId: 'c',
  channel: 'body',
  step: 1,
  locale: 'en',
  source,
  includes: {},
  engineVersion: ENGINE_VERSION,
});

describe('context and profiles', () => {
  it('builds variables from columns, defaults, derived and profile', () => {
    const profile = pickProfile(campaign, row);
    expect(profile?.id).toBe('p1');
    const ctx = buildContext(campaign, row, profile, new Date('2026-08-22T10:00:00Z'));
    expect(ctx).toMatchObject({
      name: 'Анна',
      topic: 'your niche',
      key: 'a.com',
      domain: 'a.com',
      today: '2026-08-22',
      my_name: 'Иван',
      my_site: '',
    });
  });
  it('falls back to the first profile when none matches', () => {
    expect(pickProfile(campaign, { ...row, values: { c1: 'Bob' } })?.id).toBe('p2');
  });
});

describe('analyzeTemplate (three chip groups)', () => {
  it('splits refs into resolved / missing / unused and counts diagnostics', () => {
    const a = analyzeTemplate('{Hi|Hello} %name%, about %topik% from %my_name%', campaign, 'en');
    expect(a.resolved).toEqual(['name', 'my_name']);
    expect(a.missing).toEqual(['topik']);
    expect(a.unused).toEqual(['topic', 'site']);
    expect(a.errors).toBe(0);
    expect(a.warnings).toBeGreaterThanOrEqual(1); // variable.undefined for topik
    expect(nearestVariable('topik', ['name', 'topic', 'site'])).toBe('topic');
    expect(nearestVariable('zzzzzz', ['name'])).toBeNull();
  });
  it('reports syntax errors with positions', () => {
    const a = analyzeTemplate('{Hi|Hello %name%', campaign, 'en');
    expect(a.errors).toBeGreaterThan(0);
    expect(a.diagnostics[0]?.line).toBe(1);
  });
});

describe('renderWithHighlights', () => {
  it('marks substituted values and keeps the plain text identical', () => {
    const r = renderWithHighlights(
      '{Hi|Hello} %name%, question about %topic%.',
      { name: 'Анна', topic: 'crypto' },
      { seed: 'a.com:1' },
    );
    expect(r.text).toMatch(/^(Hi|Hello) Анна, question about crypto\.$/);
    expect(r.highlights.map((h) => r.text.slice(h.start, h.end))).toEqual(['Анна', 'crypto']);
    expect(r.highlights.map((h) => h.variable)).toEqual(['name', 'topic']);
    expect(r.warnings).toEqual([]);
  });
  it('does not duplicate text when several variables share a value', () => {
    const ctx = { key: 'b.io', domain: 'b.io', target: 'b.io', site: 'b.io', my_name: '' };
    const r = renderWithHighlights('Hi! From %my_name% about %domain%.', ctx, { seed: 'b.io:1' });
    expect(r.text).toBe('Hi! From about b.io.');
    const spans = r.highlights.map((h) => [h.start, h.end]);
    expect(spans).toEqual([[15, 19]]);
  });
  it('is deterministic per seed and flags leaked markup', () => {
    const a = renderWithHighlights('{A|B|C|D} %x%', { x: '1' }, { seed: 'k:1' });
    const b = renderWithHighlights('{A|B|C|D} %x%', { x: '1' }, { seed: 'k:1' });
    expect(a.text).toBe(b.text);
    const leaked = renderWithHighlights('Hello %unknown% {', {}, { seed: 'k:1' });
    expect(leaked.warnings.some((w) => w.kind === 'leakedMarkup')).toBe(true);
  });
});

describe('warnings and constraints', () => {
  it('flags empty variables unless guarded by a conditional', () => {
    const ctx = { name: '', topic: '' };
    expect(emptyVariableWarnings('Hi %name%', ctx, campaign.columns)).toEqual([
      { kind: 'emptyVariable', variable: 'name' },
    ]);
    expect(emptyVariableWarnings('{?name?Hi %name%|Hello}', ctx, campaign.columns)).toEqual([]);
  });
  it('checks length / words / keyword repeat', () => {
    const w = checkConstraints('seo seo seo seo seo seo tools', [
      { kind: 'maxLength', value: 10, level: 'warning' },
      { kind: 'keywordRepeat', max: 5, level: 'blocking' },
      { kind: 'maxWords', value: 100, level: 'warning' },
    ]);
    expect(w.map((x) => (x.kind === 'constraint' ? `${x.constraint.kind}:${x.level}` : x.kind))).toEqual([
      'maxLength:warning',
      'keywordRepeat:blocking',
    ]);
  });
  it('renderRow uses overrides as the source of truth and derives the seed', () => {
    const r = renderRow(campaign, row, 1, { body: tpl('Hi %name%') });
    expect(r.seed).toBe('a.com:1');
    expect(r.body.text).toBe('Hi Анна');
    const edited = renderRow(
      campaign,
      { ...row, salt: 2, overrides: { body: { step: 1, text: 'Custom', source: 'edit' } } },
      1,
      { body: tpl('Hi %name%') },
    );
    expect(edited.body.text).toBe('Custom');
    expect(edited.seed).toBe('a.com:1:2');
  });
});
