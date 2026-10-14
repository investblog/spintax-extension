import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (p: string) => `chrome-extension://id${p}` } } }));

import type { FieldInfo } from '@/shared/fields';
import type { ScanResult } from '@/shared/protocol';
import { resolveMapping, saveMapping } from './queue';

const field = (over: Partial<FieldInfo>): FieldInfo => ({
  frame: '',
  tag: 'input',
  sameTypeIndex: 0,
  fieldId: over.name ?? 'f',
  formId: 'form1',
  visible: true,
  honeypot: false,
  filled: false,
  ...over,
});

// A form that carries both: profile fields and the message box (a profile page with a bio).
const scan = {
  url: 'https://site.test/profile/edit',
  origin: 'https://site.test',
  token: 't',
  links: [],
  fields: [
    field({ name: 'email', type: 'email', label: 'Email', sameTypeIndex: 0 }),
    field({ name: 'display_name', type: 'text', label: 'Display name', sameTypeIndex: 0 }),
    field({ name: 'bio', tag: 'textarea', label: 'About you', sameTypeIndex: 0 }),
  ],
} as unknown as ScanResult;

describe('resolveMapping', () => {
  it('a recipe saved by a sign-up fill does not hide the message slot from a submission (#6)', async () => {
    const signup = await resolveMapping(scan, ['profile.name', 'profile.email']);
    expect(signup.fields.map((f) => f.slot).sort()).toEqual(['profile.email', 'profile.name']);
    await saveMapping(scan, signup, 'heuristic');

    const submit = await resolveMapping(scan, ['profile.name', 'profile.email', 'output.body']);
    expect(submit.fields.find((f) => f.slot === 'output.body')?.field?.name).toBe('bio');
    expect(submit.source).toBe('heuristic'); // so the fill extends the stored recipe
    expect(submit.unmapped).toEqual([]);
  });

  it('the next step of a multi-step form is another form, not a stale recipe; a changed form still is', async () => {
    const at = (fields: FieldInfo[]) =>
      ({
        url: 'https://steps.test/join',
        origin: 'https://steps.test',
        token: 't',
        links: [],
        fields,
      }) as unknown as ScanResult;
    const step1 = at([field({ name: 'email', type: 'email', label: 'Email' })]);
    await saveMapping(step1, await resolveMapping(step1, ['profile.email']), 'heuristic');
    const step2 = at([field({ name: 'name', type: 'text', label: 'Your name' })]);
    expect((await resolveMapping(step2, ['profile.name'])).stale).toBe(false);
    const changed = at([
      field({ name: 'email', type: 'email', label: 'Email' }),
      field({ name: 'name', type: 'text', label: 'Your name' }),
    ]);
    expect((await resolveMapping(changed, ['profile.email', 'profile.name'])).stale).toBe(true);
  });
});
