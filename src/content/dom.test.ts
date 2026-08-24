// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { fillAll, scanPage } from './dom';

function page(html: string): void {
  document.body.innerHTML = html;
}

describe('scanPage', () => {
  it('builds fingerprints, labels, honeypots and select options', () => {
    page(`
      <form>
        <label for="n">Your name</label><input id="n" name="your-name" type="text" maxlength="40">
        <input name="your-email" type="email" placeholder="E-mail">
        <input name="website" type="text" style="display:none">
        <input type="hidden" name="_token" value="x">
        <select name="topic"><option value="a">Ads</option><option value="b">Bugs</option></select>
        <textarea name="your-message" aria-label="Message"></textarea>
        <a href="mailto:hi@a.com">hi@a.com</a><a href="/contact">Contact us</a>
      </form>`);
    const scan = scanPage();
    const by = Object.fromEntries(scan.fields.map((f) => [f.name, f]));
    expect(by['your-name']).toMatchObject({
      tag: 'input',
      type: 'text',
      label: 'Your name',
      maxLength: 40,
      visible: true,
      honeypot: false,
    });
    expect(by['your-email']).toMatchObject({ placeholder: 'E-mail' });
    expect(by.website?.honeypot).toBe(true); // hidden by style
    expect(by._token?.honeypot).toBe(true);
    expect(by['your-name']?.formId).toBe('form1');
    expect(by.topic?.options).toEqual([
      { value: 'a', label: 'Ads' },
      { value: 'b', label: 'Bugs' },
    ]);
    expect(by['your-message']).toMatchObject({ tag: 'textarea', ariaLabel: 'Message' });
    expect(scan.links.map((l) => l.kind)).toEqual(['mailto', 'contact']);
  });
});

describe('scanPage — visible "website" and "comments" are real fields, forms are grouped', () => {
  it('does not flag visible real fields as honeypots; separate forms get separate ids', () => {
    page(`
      <form id="login"><input type="text" name="username"><input type="password" name="password"></form>
      <form id="contact"><input type="url" name="website"><textarea name="comments"></textarea></form>
      <input type="search" name="q">`);
    const scan = scanPage();
    const by = Object.fromEntries(scan.fields.map((f) => [f.name, f]));
    expect(by.website?.honeypot).toBe(false);
    expect(by.comments?.honeypot).toBe(false);
    expect(by.username?.formId).toBe('form1');
    expect(by.website?.formId).toBe('form2');
    expect(by.q?.formId).toBe('root');
  });
});

describe('scanPage — trap-like name next to a real field of the same kind', () => {
  it('marks the visible "website" url input as a honeypot when the form has another url field', () => {
    page(
      `<form><input type="url" name="website"><input type="url" name="your-url"><textarea name="message"></textarea></form>`,
    );
    const by = Object.fromEntries(scanPage().fields.map((f) => [f.name, f]));
    expect(by.website?.honeypot).toBe(true);
    expect(by['your-url']?.honeypot).toBe(false);
    expect(by.message?.honeypot).toBe(false);
  });
});

describe('fillAll (spec §6 ladder)', () => {
  it('sets inputs/textareas natively with events, skips non-empty by default, replaces on request', async () => {
    page(`<input name="n" type="text" value="Existing"><textarea name="m"></textarea>`);
    const scan = scanPage();
    const [n, m] = scan.fields;
    if (!n || !m) throw new Error('fields');
    let inputEvents = 0;
    document.querySelector('textarea')?.addEventListener('input', () => inputEvents++);
    const report = await fillAll(
      [
        { slot: 'profile.name', fingerprint: n, fieldId: n.fieldId, value: 'Anna', policy: 'skipIfFilled' },
        { slot: 'output.body', fingerprint: m, fieldId: m.fieldId, value: 'Hello\nthere', policy: 'skipIfFilled' },
      ],
      scan.fields,
    );
    expect(report.map((r) => r.outcome)).toEqual(['skippedNonEmpty', 'exact']);
    expect((document.querySelector('textarea') as HTMLTextAreaElement).value).toBe('Hello\nthere');
    expect(inputEvents).toBe(1);
    const again = await fillAll(
      [{ slot: 'profile.name', fingerprint: n, fieldId: n.fieldId, value: 'Anna', policy: 'replace' }],
      scan.fields,
    );
    expect(again[0]?.outcome).toBe('exact');
    expect((document.querySelector('input') as HTMLInputElement).value).toBe('Anna');
  });
  it('selects options by value or label, reports clipboard when nothing matches', async () => {
    page(`<select name="cat"><option value="1">Marketing</option><option value="2">Support</option></select>`);
    const scan = scanPage();
    const f = scan.fields[0];
    if (!f) throw new Error('field');
    const r = await fillAll(
      [{ slot: 'row.c1', fingerprint: f, fieldId: f.fieldId, value: 'support', policy: 'replace' }],
      scan.fields,
    );
    expect(r[0]).toMatchObject({ outcome: 'exact', method: 'select' });
    expect((document.querySelector('select') as HTMLSelectElement).value).toBe('2');
    const miss = await fillAll(
      [{ slot: 'row.c1', fingerprint: f, fieldId: f.fieldId, value: 'Sales', policy: 'replace' }],
      scan.fields,
    );
    expect(miss[0]?.outcome).toBe('clipboard');
  });
  it('re-resolves by fingerprint when the fieldId is stale', async () => {
    page(`<input name="email" type="email">`);
    const scan = scanPage();
    const f = scan.fields[0];
    if (!f) throw new Error('field');
    const r = await fillAll(
      [{ slot: 'profile.email', fingerprint: f, fieldId: 'stale-id', value: 'a@b.c', policy: 'replace' }],
      scanPage().fields,
    );
    expect(r[0]?.outcome).toBe('exact');
  });
  it('contenteditable: R0 contract is focus + clipboard, DOM untouched', async () => {
    page(`<div contenteditable="true" aria-label="Message"></div>`);
    const scan = scanPage();
    const f = scan.fields[0];
    if (!f) throw new Error('field');
    const r = await fillAll(
      [{ slot: 'output.body', fingerprint: f, fieldId: f.fieldId, value: 'Hi', policy: 'replace' }],
      scan.fields,
    );
    expect(r[0]?.outcome).toBe('clipboard');
    expect(document.querySelector('[contenteditable]')?.textContent).toBe('');
  });
});
