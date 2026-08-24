import { describe, expect, it } from 'vitest';
import { checkConstraints, isBlocking, mimeAllowed } from './constraints';

describe('mimeAllowed (<input accept>)', () => {
  it('understands image/*, exact types and extensions', () => {
    expect(mimeAllowed('image/png', 'a.png', ['image/*'])).toBe(true);
    expect(mimeAllowed('image/jpeg', 'a.jpg', ['image/png'])).toBe(false);
    expect(mimeAllowed('image/jpeg', 'photo.JPG', ['.jpg', '.jpeg'])).toBe(true);
    expect(mimeAllowed('application/pdf', 'x.pdf', [])).toBe(true);
  });
});

describe('checkConstraints (spec §16.3)', () => {
  it('reports length and word violations with the constraint level', () => {
    const v = checkConstraints('hello world, this is long', [
      { kind: 'maxLength', value: 10, level: 'blocking' },
      { kind: 'minLength', value: 250, level: 'warning' },
      { kind: 'maxWords', value: 3, level: 'warning' },
    ]);
    expect(v.map((x) => x.level)).toEqual(['blocking', 'warning', 'warning']);
    expect(v[0]?.message).toMatch(/25 characters, the field takes 10/);
    expect(isBlocking(v)).toBe(true);
  });
  it('counts code points, not UTF-16 units, and passes when within limits', () => {
    expect(checkConstraints('héllo 😀', [{ kind: 'maxLength', value: 7, level: 'blocking' }])).toEqual([]);
    expect(isBlocking([])).toBe(false);
  });
});
