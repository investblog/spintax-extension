import { describe, expect, it } from 'vitest';
import { type FieldInfo, formSignature, looksLikeHoneypotName, matchScore, resolveField, routePattern } from './fields';
import { imageSizeHint, mapSlots, toRecipeFields } from './mapping';

let n = 0;
const field = (p: Partial<FieldInfo> & { tag: FieldInfo['tag'] }): FieldInfo => ({
  fieldId: `f${n++}`,
  frame: '',
  sameTypeIndex: 0,
  visible: true,
  honeypot: false,
  filled: false,
  ...p,
});

describe('fields helpers', () => {
  it('routePattern masks ids and hashes', () => {
    expect(routePattern('https://a.com/contact/')).toBe('/contact');
    expect(routePattern('https://a.com/users/12345/edit')).toBe('/users/*/edit');
    expect(routePattern('https://a.com/x/3f2a9b8c1d2e/')).toBe('/x/*');
    expect(routePattern('not a url')).toBe('/');
  });
  it('formSignature ignores hidden/honeypot fields and is order-sensitive', () => {
    const a = field({ tag: 'input', type: 'email', name: 'email' });
    const b = field({ tag: 'textarea', name: 'message' });
    const hp = field({ tag: 'input', type: 'text', name: 'website', honeypot: true });
    expect(formSignature([a, b, hp])).toBe(formSignature([a, b]));
    expect(formSignature([a, b])).not.toBe(formSignature([b, a]));
  });
  it('honeypot names', () => {
    expect(looksLikeHoneypotName('hp', undefined, undefined)).toBe(true);
    expect(looksLikeHoneypotName('website', undefined, undefined)).toBe(true);
    expect(looksLikeHoneypotName(undefined, undefined, 'wpforms-field-hp')).toBe(true);
    expect(looksLikeHoneypotName('your-name', 'name-1', 'wpcf7-form-control')).toBe(false);
  });
  it('matchScore and resolveField re-resolve a stored fingerprint', () => {
    const stored = {
      frame: '',
      tag: 'input' as const,
      type: 'email',
      name: 'your-email',
      id: 'email-1',
      sameTypeIndex: 0,
    };
    const live = [
      field({ tag: 'input', type: 'email', name: 'your-email', id: 'email-42' }),
      field({ tag: 'input', type: 'text', name: 'your-name' }),
    ];
    expect(matchScore(stored, live[0] as FieldInfo)).toBeGreaterThan(0.6);
    expect(resolveField(stored, live)?.field.name).toBe('your-email');
    expect(resolveField({ ...stored, tag: 'select' }, live)).toBeNull();
  });
});

describe('mapSlots heuristics (spec §5)', () => {
  it('never mixes forms: newsletter email + search box vs the contact form', () => {
    const fields = [
      field({ tag: 'input', type: 'email', name: 'newsletter_email', formId: 'form1', label: 'Subscribe' }),
      field({ tag: 'input', type: 'search', name: 'q', formId: 'root', placeholder: 'Search' }),
      field({ tag: 'input', type: 'text', name: 'your-name', formId: 'form2', label: 'Name' }),
      field({ tag: 'input', type: 'email', name: 'your-email', formId: 'form2' }),
      field({ tag: 'textarea', name: 'your-message', formId: 'form2' }),
    ];
    const { mapped, formId } = mapSlots(fields);
    expect(formId).toBe('form2');
    const by = Object.fromEntries(mapped.map((m) => [m.slot, m.field.name]));
    expect(by['profile.email']).toBe('your-email');
    expect(by['output.body']).toBe('your-message');
  });
  it('unicode word boundaries: hostname is not a name field', () => {
    const fields = [
      field({ tag: 'input', type: 'text', name: 'hostname' }),
      field({ tag: 'input', type: 'text', name: 'name' }),
    ];
    const by = Object.fromEntries(mapSlots(fields).mapped.map((m) => [m.slot, m.field.name]));
    expect(by['profile.name']).toBe('name');
  });
  it('file inputs carry an imageSize constraint parsed from their text', () => {
    expect(imageSizeHint('Store icon (128×128 PNG)')).toEqual({ width: 128, height: 128 });
    expect(imageSizeHint('Screenshot 1280 x 800')).toEqual({ width: 1280, height: 800 });
    expect(imageSizeHint('Version 2x3 patch')).toBeNull();
    const f = field({ tag: 'input', type: 'file', name: 'shot', label: 'Screenshot (1280×800)' });
    const specs = [{ slot: 'row.c1' as const, header: 'Screenshot', type: 'file' as const }];
    const rf = toRecipeFields(mapSlots([f], ['row.c1'], specs).mapped);
    expect(rf[0]?.constraints).toEqual([{ kind: 'imageSize', width: 1280, height: 800, level: 'warning' }]);
  });
  it('a select matches a row column by header and is filled with policy replace', () => {
    const sel = field({ tag: 'select', name: 'category', label: 'Category' });
    const specs = [{ slot: 'row.c1' as const, header: 'Category', type: 'text' as const }];
    const { mapped } = mapSlots([sel, field({ tag: 'textarea', name: 'message' })], ['output.body', 'row.c1'], specs);
    expect(mapped.find((m) => m.slot === 'row.c1')?.field.name).toBe('category');
    expect(toRecipeFields(mapped).find((r) => r.slot === 'row.c1')?.fillPolicy).toBe('replace');
  });
  it('header token coverage: "Short description" beats a lone "description" match', () => {
    const fields = [
      field({ tag: 'textarea', name: 'long', label: 'Long description' }),
      field({ tag: 'input', type: 'text', name: 'summary', label: 'Short description' }),
    ];
    const specs = [
      { slot: 'row.c1' as const, header: 'Short description', type: 'text' as const },
      { slot: 'row.c2' as const, header: 'Long description', type: 'text' as const },
    ];
    const by = Object.fromEntries(
      mapSlots(fields, ['row.c1', 'row.c2'], specs).mapped.map((m) => [m.slot, m.field.name]),
    );
    expect(by['row.c1']).toBe('summary');
    expect(by['row.c2']).toBe('long');
  });
  it('file inputs carry a blocking mime constraint from accept', () => {
    const f = field({ tag: 'input', type: 'file', name: 'icon', label: 'Icon', accept: 'image/png, .jpg' });
    const specs = [{ slot: 'row.c1' as const, header: 'Icon', type: 'file' as const }];
    const rf = toRecipeFields(mapSlots([f], ['row.c1'], specs).mapped);
    expect(rf[0]?.constraints.find((c) => c.kind === 'mime')).toEqual({
      kind: 'mime',
      allow: ['image/png', '.jpg'],
      level: 'blocking',
    });
  });
  it('row.<col> slots match by column header; file columns only match file inputs', () => {
    const fields = [
      field({ tag: 'input', type: 'file', name: 'icon_upload', label: 'Store icon (128×128)' }),
      field({ tag: 'input', type: 'text', name: 'short_desc', label: 'Short description' }),
      field({ tag: 'textarea', name: 'message' }),
    ];
    const specs = [
      { slot: 'row.c1' as const, header: 'Icon', type: 'file' as const },
      { slot: 'row.c2' as const, header: 'Short description', type: 'text' as const },
    ];
    const { mapped } = mapSlots(fields, ['output.body', 'row.c1', 'row.c2'], specs);
    const by = Object.fromEntries(mapped.map((m) => [m.slot, m.field.name]));
    expect(by['row.c1']).toBe('icon_upload');
    expect(by['row.c2']).toBe('short_desc');
    expect(by['output.body']).toBe('message');
  });
  it('maps a Contact Form 7 shape with a honeypot', () => {
    const fields = [
      field({ tag: 'input', type: 'text', name: 'your-name', label: 'Your name' }),
      field({ tag: 'input', type: 'email', name: 'your-email', label: 'Your email' }),
      field({ tag: 'input', type: 'text', name: 'your-subject', label: 'Subject' }),
      field({ tag: 'textarea', name: 'your-message', label: 'Your message' }),
      field({ tag: 'input', type: 'text', name: 'website', honeypot: true, visible: false }),
    ];
    const { mapped, unmapped } = mapSlots(fields);
    const by = Object.fromEntries(mapped.map((m) => [m.slot, m.field.name]));
    expect(by).toEqual({
      'profile.name': 'your-name',
      'profile.email': 'your-email',
      'output.subject': 'your-subject',
      'output.body': 'your-message',
    });
    expect(unmapped).toEqual(['profile.site', 'profile.phone']);
    expect(mapped.find((m) => m.slot === 'profile.email')?.confidence).toBeGreaterThanOrEqual(0.95);
  });
  it('prefers autocomplete tokens, rejects company/username for name, lone textarea = body', () => {
    const fields = [
      field({ tag: 'input', type: 'text', name: 'company', label: 'Company name' }),
      field({ tag: 'input', type: 'text', name: 'fld_1', autocomplete: 'name' }),
      field({ tag: 'input', type: 'text', name: 'fld_2', autocomplete: 'url', label: 'Homepage' }),
      field({ tag: 'input', type: 'text', name: 'username', label: 'User name' }),
      field({ tag: 'textarea', name: 'fld_3' }),
    ];
    const { mapped } = mapSlots(fields);
    const by = Object.fromEntries(mapped.map((m) => [m.slot, m.field.name]));
    expect(by['profile.name']).toBe('fld_1');
    expect(by['profile.site']).toBe('fld_2');
    expect(by['output.body']).toBe('fld_3');
  });
  it('Russian labels and a contenteditable body', () => {
    const fields = [
      field({ tag: 'input', type: 'text', placeholder: 'Ваше имя' }),
      field({ tag: 'input', type: 'text', placeholder: 'Эл. почта' }),
      field({ tag: 'contenteditable', ariaLabel: 'Сообщение' }),
    ];
    const { mapped, unmapped } = mapSlots(fields);
    expect(mapped.map((m) => m.slot)).toEqual(expect.arrayContaining(['profile.name', 'profile.email', 'output.body']));
    expect(unmapped).not.toContain('output.body');
  });
  it('never maps two slots to one field; toRecipeFields carries maxlength as blocking', () => {
    const fields = [field({ tag: 'input', type: 'text', name: 'name', maxLength: 40 })];
    const { mapped } = mapSlots(fields);
    expect(mapped).toHaveLength(1);
    expect(toRecipeFields(mapped)[0]?.constraints).toEqual([{ kind: 'maxLength', value: 40, level: 'blocking' }]);
  });
});
