import type { Diagnostic } from '@spintax/core';
import { describe, expect, it } from 'vitest';
import { hasLeftovers, leftoverHtml, overlayHtml, overlayRanges } from './editor';

describe('editor overlay (ported from the playground)', () => {
  it('underlines the exact span of a positioned diagnostic', () => {
    const text = 'Hi {a|b\nsecond line';
    const d: Diagnostic = {
      severity: 'error',
      code: 'brace.unclosed',
      message: 'Unclosed {',
      line: 1,
      column: 4,
      endLine: 1,
      endColumn: 9,
    };
    const ranges = overlayRanges(text, [d]);
    expect(ranges).toEqual([{ start: 3, end: 8, code: 'brace.unclosed', severity: 'error', message: 'Unclosed {' }]);
    expect(overlayHtml(text, ranges)).toBe('Hi <span class="err" title="Unclosed {">{a|b\n</span>second line\n');
  });
  it('underlines every occurrence of an undefined variable, escaping HTML', () => {
    const text = '<b>%nope%</b> and %NOPE% again %ok%';
    const d: Diagnostic = {
      severity: 'warning',
      code: 'variable.undefined',
      message: 'Unknown %nope%',
      line: 1,
      column: 4,
      data: { name: 'nope' },
    };
    const html = overlayHtml(text, overlayRanges(text, [d]));
    expect(html).toBe(
      '&lt;b&gt;<span class="warn" title="Unknown %nope%">%nope%</span>&lt;/b&gt; and <span class="warn" title="Unknown %nope%">%NOPE%</span> again %ok%\n',
    );
  });
  it('plain mirror keeps a trailing newline so the overlay height matches', () => {
    expect(overlayHtml('abc', [])).toBe('abc\n');
  });
  it('leftovers in a rendered variant are underlined', () => {
    expect(hasLeftovers('Hi %name%')).toBe(true);
    expect(hasLeftovers('Hi Anna')).toBe(false);
    expect(leftoverHtml('Hi %name% ｛x｝', 't')).toBe(
      'Hi <span class="err" title="t">%name%</span> <span class="err" title="t">｛</span>x<span class="err" title="t">｝</span>',
    );
  });
});
