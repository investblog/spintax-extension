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
  it('a value from the list reaches the text as written — data, not spintax (#2)', () => {
    const ctx = {
      company: 'Acme [Beta]',
      offer: 'save {50|60}% today',
      link: 'see [docs](https://a.io)',
      v: '%x% #set',
    };
    for (const seed of ['k:1', 'k:2', 'k:3']) {
      const r = renderWithHighlights('{Hi|Hello} %company% team, %offer%. %link%. %v%', ctx, { seed });
      expect(r.text).toMatch(
        /^(Hi|Hello) Acme \[Beta\] team, save \{50\|60\}% today\. See \[docs\]\(https:\/\/a\.io\)\. %x% #set$/,
      );
      expect(r.warnings).toEqual([]); // braces from data are not "leftover markup"
      expect(r.highlights.map((h) => r.text.slice(h.start, h.end))).toEqual([
        'Acme [Beta]',
        'save {50|60}% today',
        'See [docs](https://a.io)', // sentence start: capitalized like any word
        '%x% #set',
      ]);
    }
    // inside an enumeration or a permutation a pipe in the value does not split it (Codex review of #2)
    for (const seed of ['k:1', 'k:2', 'k:3', 'k:4']) {
      const e = renderWithHighlights('{%v%|%v%}', { v: 'a|b' }, { seed });
      expect(e.text).toBe('A|b');
      const p = renderWithHighlights('[%v%|%v%]', { v: 'a|b' }, { seed });
      expect(p.text).toMatch(/^A\|b a\|b$/);
    }
    // `?` and `:` in a value are text, not a conditional or a plural re-read inside braces (the
    // typographer may still space a sentence `?`, as it would in the template's own words)
    for (const seed of ['k:1', 'k:2', 'k:3']) {
      const cond = renderWithHighlights('{%v%|%v%}', { v: '?c?then' }, { seed }).text;
      expect(cond.replace(/\s/g, '').toLowerCase()).toBe('?c?then');
      expect(renderWithHighlights('{%v%|%v%}', { v: 'plural 1:one' }, { seed }).text).toBe('Plural 1:one');
    }
    const bang = renderWithHighlights('{%v%|%v%}', { v: '!c?a=b /#x#/ "q"' }, { seed: 'k:1' }).text;
    expect(bang.replace(/\s/g, '').toLowerCase()).toBe('!c?a=b/#x#/"q"');
    // a macro body is re-read where the macro is used: its variables are shielded too
    for (const seed of ['k:1', 'k:2', 'k:3', 'k:4'])
      expect(renderWithHighlights('#def %d% = %v%\n{%d%|%d%}', { v: 'a|b' }, { seed }).text).toBe('A|b');
    // in plain text a value is typeset exactly like the same words written in the template: quotes,
    // tags and sentence ends stay visible to the typographer
    for (const v of ['he said "wow!"', '<p>hello.</p>', '?really? yes', 'plural:next', 'a = b']) {
      const asValue = renderWithHighlights('%v% next', { v }, { seed: 'k:1' }).text;
      const asText = renderWithHighlights(`${v} next`, {}, { seed: 'k:1' }).text;
      expect(asValue).toBe(asText);
    }
    // sentence punctuation in a value still ends a sentence for the typographer
    expect(renderWithHighlights('%v% next', { v: 'Wow!' }, { seed: 'k:1' }).text).toBe('Wow! Next');
    // ...and a URL keeps every character, in and around a sentence
    const url = 'https://spintax.net/play/?a=1&b=two:three';
    expect(renderWithHighlights('see %u% now. next one', { u: url }, { seed: 'k:1' }).text).toBe(
      `See ${url} now. Next one`,
    );
    // angle brackets in a value are text, not a permutation config or separator
    for (const seed of ['k:1', 'k:2', 'k:3', 'k:4']) {
      const cfg = renderWithHighlights('[%v%|%w%]', { v: '<maxsize=1>bad', w: 'x <sep=" + "> y' }, { seed });
      expect(cfg.text).toMatch(/^(<maxsize=1>bad x <sep=" \+ "> y|X <sep=" \+ "> y <maxsize=1>bad)$/);
    }
    // the engine's own sentinels and our marker glyphs in a cell come out as they went in
    const odd = '\uE000\uE005\uF8F2x';
    const oddR = renderWithHighlights('%v%', { v: odd }, { seed: 'k:1' });
    expect(oddR.text).toBe(odd);
    expect(oddR.warnings).toEqual([]);
    expect(renderWithHighlights('%v%', { v: '\uE005set' }, { seed: 'k:1' }).warnings).toEqual([]);
    // a value glued to the template's own `#set` does not hide it
    expect(
      renderWithHighlights('oops #set%v%', { v: '{' }, { seed: 'k:1' }).warnings.some((w) => w.kind === 'leakedMarkup'),
    ).toBe(true);
    // ...and data never completes markup across a variable's edge
    expect(renderWithHighlights('#%v% here', { v: 'set' }, { seed: 'k:1' }).warnings).toEqual([]);
    expect(renderWithHighlights('%%v%% here', { v: 'q' }, { seed: 'k:1' }).warnings).toEqual([]);
    // a value blank to the engine (U+0085) keeps the marked render on the same branch: no false leak
    const nel = renderWithHighlights('{?c?%z%|ok}', { c: '\u0085', z: 'zz' }, { seed: 'k:1' });
    expect(nel.text).toBe('Ok');
    expect(nel.warnings).toEqual([]);
    // the leak check knows where markup came from: a real `%q%` next to a value that reads `%q%` is
    // still reported, and a value that is a lone `{` is not (Codex review of #2)
    const plural = '{plural %n%: one|many} %x% %q%';
    expect(
      renderWithHighlights(plural, { n: '1', x: '%q%' }, { seed: 'k:1' }).warnings.some(
        (w) => w.kind === 'leakedMarkup',
      ),
    ).toBe(true);
    expect(renderWithHighlights('{plural %n%: one|many} %x%', { n: '1', x: '{' }, { seed: 'k:1' }).warnings).toEqual(
      [],
    );
    const mvs = renderWithHighlights('{?c?%x%|%q%}', { c: '᠎', x: '%q%' }, { seed: 'k:1' });
    expect(mvs.warnings.some((w) => w.kind === 'leakedMarkup')).toBe(true); // the blank branch prints the template's %q%
    // the template's own mistake is still reported, data or not
    const broken = renderWithHighlights('Hi %company% {', ctx, { seed: 'k:1' });
    expect(broken.warnings.some((w) => w.kind === 'leakedMarkup')).toBe(true);
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
