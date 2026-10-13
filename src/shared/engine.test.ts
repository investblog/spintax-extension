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
  searchHighlights,
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
  // #3: the markers used to collide with the engine's neutralize() sentinels, so every render fell
  // back to search. A value that also occurs in the template text tells the two paths apart: only
  // the marker path knows which "Chrome" came from the variable.
  const spans = (r: { text: string; highlights: { start: number; end: number }[] }) =>
    r.highlights.map((h) => [h.start, r.text.slice(h.start, h.end)]);
  it('takes positions from the markers, not from a search (#3)', () => {
    const r = renderWithHighlights('Chrome users like %b%.', { b: 'Chrome' }, { seed: 'k:1' });
    expect(r.text).toBe('Chrome users like Chrome.');
    expect(spans(r)).toEqual([[18, 'Chrome']]);
  });
  it('keeps marker positions through the post-process (#3)', () => {
    const cap = renderWithHighlights('Chrome is out. %v% wrote it.', { v: 'chrome fan' }, { seed: 'k:1' });
    expect(cap.text).toBe('Chrome is out. Chrome fan wrote it.');
    expect(spans(cap)).toEqual([[15, 'Chrome fan']]);
    const punct = renderWithHighlights('Chrome or %v% .', { v: 'Chrome' }, { seed: 'k:1' });
    expect(punct.text).toBe('Chrome or Chrome.');
    expect(spans(punct)).toEqual([[10, 'Chrome']]);
    const perm = renderWithHighlights('[%v%|Chrome] end', { v: 'Chrome' }, { seed: 'k:1' });
    expect(spans(perm)).toHaveLength(1);
  });
  it('never highlights a short value inside a word or an unused variable (#3)', () => {
    const r = renderWithHighlights('The engine was written for %b%.', { lang: 'en', b: 'Chrome' }, { seed: 'k:1' });
    expect(spans(r)).toEqual([[27, 'Chrome']]);
    // Codex review of #3: a blank value must not flip a conditional in the marked render...
    const cond = renderWithHighlights('{?c?%x% A|A %x%}', { c: ' ', x: 'a' }, { seed: 'k:1' });
    expect(cond.text).toBe('A a');
    expect(spans(cond)).toEqual([[2, 'a']]);
    // ...a space slipped inside a marker must not stretch the span...
    const slipped = renderWithHighlights('%v%x', { v: 'hi!' }, { seed: 'k:1' });
    expect(slipped.text).toBe('Hi! X');
    expect(spans(slipped)).toEqual([[0, 'Hi!']]);
    const sameText = renderWithHighlights('%v%X', { v: 'Hi!' }, { seed: 'k:1' });
    expect(sameText.text).toBe('Hi! X');
    expect(spans(sameText)).toEqual([[0, 'Hi!']]);
    // ...and a value the capitalizer edits inside, not only at its start, is still found.
    const inner = renderWithHighlights('%v%', { v: 'hello. thanks' }, { seed: 'k:1' });
    expect(inner.text).toBe('Hello. Thanks');
    expect(spans(inner)).toEqual([[0, 'Hello. Thanks']]);
    // Case-insensitive the way the engine capitalizes (toUpperCase), not by lowercasing.
    const tr = renderWithHighlights('İyi. %v% geldi.', { v: 'ışık' }, { seed: 'k:1', locale: 'tr' });
    expect(spans(tr).map(([, s]) => s)).toEqual([tr.text.includes('Işık') ? 'Işık' : 'ışık']);
    const trSearch = searchHighlights('İyi. Işık geldi.', { v: 'ışık' }, new Set(['v']));
    expect(trSearch.map((h) => h.start)).toEqual([5]);
    // ...and, on the search path, an include the template never reaches contributes no variables.
    const inc = renderWithHighlights(
      'Chrome %v%x\n#include "a"',
      { brand: 'Chrome', v: 'hi!', w: 'Wolf' },
      {
        seed: 'k:1',
        includes: { a: 'by %w%', unused: '%brand%' },
      },
    );
    expect(inc.text).toBe('Chrome hi! X\nBy Wolf');
    expect(inc.highlights.map((h) => h.variable)).toEqual(['v', 'w']);
    // The search fallback, called directly: whole words, referenced variables only.
    const text = 'The engine runs en route on b.io and www.b.io.';
    const found = searchHighlights(text, { lang: 'en', domain: 'b.io', site: 'b.io' }, new Set(['lang', 'domain']));
    expect(found.map((h) => [text.slice(h.start, h.end), h.variable])).toEqual([
      ['en', 'lang'],
      ['b.io', 'domain'],
      ['b.io', 'domain'],
    ]);
    // Capitalized at a sentence start; a supplementary-plane letter is still a word character.
    const capText = 'Anna wrote. 𝐀anna is not her.';
    const capFound = searchHighlights(capText, { name: 'anna' }, new Set(['name']));
    expect(capFound.map((h) => [h.start, capText.slice(h.start, h.end)])).toEqual([[0, 'Anna']]);
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
