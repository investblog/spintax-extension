/** Options-page state: the selected campaign, persisted in settings. */
import { browser } from 'wxt/browser';
import { t } from '@/shared/i18n';
import type { Campaign } from '@/shared/model';
import { createCampaign, getCampaign, getSetting, listCampaigns, setSetting } from '@/shared/repo';

const KEY = 'currentCampaignId';

export async function currentCampaign(): Promise<Campaign | null> {
  const id = await getSetting<string | null>(KEY, null);
  if (id) {
    const c = await getCampaign(id);
    if (c) return c;
  }
  const all = await listCampaigns();
  const first = all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
  if (first) {
    await setSetting(KEY, first.id);
    return first;
  }
  return null;
}

export async function selectCampaign(id: string): Promise<void> {
  await setSetting(KEY, id);
}

export async function ensureCampaign(name = t('optDefaultCampaign')): Promise<Campaign> {
  const existing = await currentCampaign();
  if (existing) return existing;
  const created = await createCampaign({ name });
  await setSetting(KEY, created.id);
  return created;
}

/** Simple pub/sub so views re-render after writes. */
type Listener = () => void;
const listeners = new Set<Listener>();
export function onChange(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
export function notify(): void {
  for (const fn of listeners) fn();
  notifyPanel();
}

/**
 * Tell the side panel only. A setting changed here is already on screen in the control the user
 * just clicked, so re-rendering the options view would just wipe the "Saved." it is about to show
 * — but the panel reads these once, at load, and would otherwise ignore the change until reopened
 * (pre-release review #4).
 */
export function notifyPanel(): void {
  // No listener open → the promise rejects, harmless.
  void browser.runtime.sendMessage({ type: 'data-changed' }).catch(() => undefined);
}
