import { browser } from 'wxt/browser';
import { currentCampaign } from '@/options/state';
import { statusBadge } from '@/options/views/list';
import { highlighted, warningsList } from '@/options/views/template';
import {
  activeTab,
  fillTab,
  forgetRecipe,
  hasOriginPermission,
  highlightFields,
  isDue,
  isOwnOrigin,
  isWork,
  loadCursor,
  loadRows,
  type ResolvedMapping,
  recordFilled,
  renderFor,
  requestOriginPermission,
  resolveMapping,
  saveCursor,
  saveMapping,
  scanTab,
  slotsFor,
  slotValues,
  startPicker,
  type TabInfo,
  withManualField,
} from '@/panel/queue';
import {
  type AccountState,
  accountDomain,
  accountSettled,
  getAccount,
  type SiteAccount,
  saveAccount,
} from '@/shared/accounts';
import { PUBLISHER_URL, SPINTAX_URL, svg301Logo } from '@/shared/brand';
import { append, byId, clear, h } from '@/shared/dom';
import { ENGINE_VERSION, pickProfile, type RowRender } from '@/shared/engine';
import { extUrl } from '@/shared/ext-url';
import { originOf } from '@/shared/fields';
import { newsBellButton, themeToggleButton } from '@/shared/header-controls';
import { applyDocumentLanguage, type MessageKey, t, tn } from '@/shared/i18n';
import { injectIconSprite, svgIcon } from '@/shared/icons';
import {
  composeLink,
  MAIL_DEFAULTS,
  MAIL_SETTINGS_KEY,
  type MailSettings,
  OPEN_TARGET_DEFAULT,
  OPEN_TARGET_KEY,
  type OpenTargetIn,
} from '@/shared/mail';
import type { Campaign, FailureReason, FillOutcome, RecipeField, Row, Slot } from '@/shared/model';
import type { FillReportItem, RuntimeMessage, ScanResult } from '@/shared/protocol';
import { deferUntil } from '@/shared/queue-order';
import { appendEvent, getSetting, listEvents, updateRow } from '@/shared/repo';
import { getStoreInfo } from '@/shared/store-links';
import { targetLabel as labelFor, pathOf, samePage, shortPath } from '@/shared/target-label';

/**
 * Side panel — the queue (spec §14.5, wireframes 4–5, ADR 0011 p.3/4/10).
 * One primary button by state; status only by explicit outcome; never a silent failure.
 */
applyDocumentLanguage();
injectIconSprite();
// The <title> in index.html is the pre-JS fallback; the UI language wins once the module runs.
document.title = t('panelPageTitle');

/** Slots are codes; only their captions are messages (the recipe stores the code, never the word). */
const SLOT_LABEL: Record<string, MessageKey> = {
  'profile.name': 'slotProfileName',
  'profile.email': 'slotProfileEmail',
  'profile.site': 'slotProfileSite',
  'profile.phone': 'slotProfilePhone',
  'output.subject': 'slotSubject',
  'output.body': 'slotBody',
};

/** Read-back outcome of a fill, as the flag next to the slot shows it (the code stays a code). */
const FLAG_LABEL: Record<FillOutcome, MessageKey> = {
  exact: 'flagExact',
  equivalent: 'flagEquivalent',
  changedBySite: 'flagChangedBySite',
  partial: 'flagPartial',
  skippedNonEmpty: 'flagKept',
  clipboard: 'flagClipboard',
  refused: 'flagRefused',
};

/** The outcome a row was marked with, for the toast. */
const KIND_LABEL: Record<'sent' | 'deferred' | 'failed' | 'excluded' | 'replied' | 'declined', MessageKey> = {
  sent: 'panelKindSent',
  deferred: 'panelKindDeferred',
  failed: 'panelKindFailed',
  excluded: 'panelKindExcluded',
  replied: 'panelKindReplied',
  declined: 'panelKindDeclined',
};

interface State {
  campaign: Campaign | null;
  rows: Row[];
  index: number;
  render: RowRender | null;
  step: number;
  tab: TabInfo | null;
  permitted: boolean;
  scan: ScanResult | null;
  mapping: ResolvedMapping | null;
  fillNote: string;
  pickingSlot: Slot | null;
  toast: string;
  /** Per-slot read-back outcomes of the last fill (review: never collapse the report). */
  report: FillReportItem[];
  /** Unsaved edit of the message textarea, kept across redraws. */
  draft: string | null;
  /** A fill/scan in flight: primary is disabled and a stale result is dropped (race guard). */
  busy: number;
  windowId: number | null;
  /** The user saw the "form changed" mapping and pressed Fill again. */
  staleAck: boolean;
  /** Where e-mail targets open (Settings → E-mail). */
  mail: MailSettings;
  /** Origin of the web-mail compose page opened for the current row (the panel treats it as the target). */
  mailOrigin: string | null;
  /** The message left the panel by another road (mail app, clipboard, no-URL target): "Sent" is the next step. */
  handedOff: boolean;
  /** The last fill put the body in the clipboard (rich editor) and the row still waits for its paste. */
  pendingPaste: boolean;
  /** Why the last fill failed, as a code — the keyboard path branches on this, never on the text. */
  fillError: 'none' | 'no-access' | 'old-helper' | 'other';
  /** Where a site target opens (Settings → "Where a target opens"). */
  openTargetIn: OpenTargetIn;
  /** Submissions campaigns: the site account note of the current row (ADR 0014). */
  account: SiteAccount | null;
  /** Site + profile the note belongs to; null when the row has no site (or not a submissions campaign). */
  accountKey: { domain: string; profileId: string } | null;
  /** Which panel tab is open: sign-up first, submission once the account is settled. */
  panelTab: 'signup' | 'submit';
  /** The user picked the tab by hand: a same-row reload keeps it. */
  manualTab: boolean;
  /** Row the account fields above were read for. */
  accountRowId: string | null;
}

const state: State = {
  campaign: null,
  rows: [],
  index: 0,
  render: null,
  step: 1,
  tab: null,
  permitted: false,
  scan: null,
  mapping: null,
  fillNote: '',
  pickingSlot: null,
  toast: '',
  report: [],
  draft: null,
  busy: 0,
  windowId: null,
  staleAck: false,
  mail: MAIL_DEFAULTS,
  mailOrigin: null,
  handedOff: false,
  pendingPaste: false,
  fillError: 'none',
  openTargetIn: OPEN_TARGET_DEFAULT,
  account: null,
  accountKey: null,
  panelTab: 'submit',
  manualTab: false,
  accountRowId: null,
};
let opToken = 0;

const app = byId('app');

function slotLabel(slot: Slot): string {
  if (slot.startsWith('row.')) {
    const col = state.campaign?.columns.find((c) => c.id === slot.slice(4));
    return col ? col.header : slot;
  }
  const key = SLOT_LABEL[slot];
  return key ? t(key) : slot;
}

async function clearMapping(slot: Slot): Promise<void> {
  if (!state.mapping || !state.scan) return;
  state.mapping = {
    ...state.mapping,
    fields: state.mapping.fields.filter((f) => f.slot !== slot),
    unmapped: [...state.mapping.unmapped, slot],
  };
  state.mapping.recipe = await saveMapping(state.scan, state.mapping, 'manual');
  state.toast = t('panelCleared', slotLabel(slot));
  draw();
}

const POLICY_LABEL: Record<RecipeField['fillPolicy'], MessageKey> = {
  skipIfFilled: 'flagPolicySkipIfFilled',
  replace: 'flagPolicyReplace',
  insertAtCursor: 'flagPolicyAtCursor',
};
const POLICY_ORDER: RecipeField['fillPolicy'][] = ['skipIfFilled', 'replace', 'insertAtCursor'];

/** Change one slot's recipe field (policy, pin) and persist the recipe for this form. */
async function patchSlot(
  slot: Slot,
  patch: Partial<Pick<RecipeField, 'fillPolicy' | 'manual' | 'confidence'>>,
): Promise<void> {
  if (!state.mapping || !state.scan) return;
  state.mapping = {
    ...state.mapping,
    fields: state.mapping.fields.map((f) =>
      f.slot === slot ? { ...f, recipeField: { ...f.recipeField, ...patch } } : f,
    ),
  };
  state.mapping.recipe = await saveMapping(state.scan, state.mapping, 'manual');
  draw();
}

/** The saved recipe is wrong: forget it and map the current form by heuristics again. */
async function forgetMapping(): Promise<void> {
  if (!state.mapping || !state.scan || !state.campaign) return;
  await forgetRecipe(state.mapping);
  const { slots, specs } = slotsFor(state.campaign);
  // Heuristics only: another form's recipe on the same route must not become "previous".
  state.mapping = await resolveMapping(state.scan, slots, specs, { ignoreRecipes: true });
  state.staleAck = false;
  state.report = [];
  state.toast = t('panelRecipeForgotten');
  draw();
}

function row(): Row | null {
  return state.rows[state.index] ?? null;
}

// ── Data ───────────────────────────────────────────────────────────────────────

let reloadSeq = 0;

async function reload(): Promise<void> {
  // Everything is read into locals and committed at once by the newest call only: a quick A→B
  // campaign switch must not pair campaign B with A's rows or cursor (Codex review of #4).
  const seq = ++reloadSeq;
  const campaign = await currentCampaign();
  const mail = { ...MAIL_DEFAULTS, ...(await getSetting<Partial<MailSettings>>(MAIL_SETTINGS_KEY, {})) };
  const openTargetIn = await getSetting<OpenTargetIn>(OPEN_TARGET_KEY, OPEN_TARGET_DEFAULT);
  const rows = campaign ? await loadRows(campaign.id) : [];
  const cursor = campaign ? await loadCursor(campaign.id) : null;
  if (seq !== reloadSeq) return;
  const before = { campaignId: state.campaign?.id, rowId: row()?.rowId, target: row()?.target };
  state.campaign = campaign;
  state.mail = mail;
  state.openTargetIn = openTargetIn;
  state.rows = rows;
  if (!campaign) {
    state.render = null;
    draw();
    return;
  }
  performance.mark('panel:rows');
  const i = cursor ? rows.findIndex((r) => r.rowId === cursor) : -1;
  state.index = i >= 0 ? i : 0;
  // Same campaign, same row: something changed in options (a template, a profile). Re-render, but
  // keep what the user just did here — the fill note and mapping must not vanish under them.
  await refreshRow({
    keep: before.campaignId === campaign.id && row()?.rowId === before.rowId && row()?.target === before.target,
  });
}

async function refreshRow(opts: { keep?: boolean } = {}): Promise<void> {
  const r = row();
  state.render = null;
  if (!opts.keep) {
    state.scan = null;
    state.mapping = null;
    state.fillNote = '';
    state.report = [];
    state.draft = null;
    state.staleAck = false;
    state.mailOrigin = null;
    state.handedOff = false;
    state.pendingPaste = false;
    state.fillError = 'none';
    state.toast = '';
  }
  const campaign = state.campaign;
  // A newer reload or a row change while we awaited owns the state now: write nothing, save no
  // cursor (Codex review of #4 — row A must not become campaign B's cursor).
  const stale = (): boolean => state.campaign !== campaign || row()?.rowId !== r?.rowId;
  if (campaign && r) {
    const res = await renderFor(campaign, r);
    if (stale()) return;
    if (res) {
      state.render = res.render;
      state.step = res.step;
    }
    // A rich editor is filled through the clipboard; the instruction must survive a panel reload,
    // so it is read back from the journal instead of the in-memory report (Codex review #3).
    if (r.deliveryStatus === 'filled_unconfirmed') {
      const events = await listEvents(r.rowId);
      if (stale()) return;
      const last = [...events].reverse().find((e) => e.event === 'filled');
      state.pendingPaste = !!last?.fillReport?.some((x) => x.slot === 'output.body' && x.outcome === 'clipboard');
    }
    // Submissions: sign-up comes first on most sites (ADR 0014). The tab follows the account note.
    const domain = campaign.scenario === 'submit' ? accountDomain(r) : null;
    const key = domain ? { domain, profileId: pickProfile(campaign, r)?.id ?? '-' } : null;
    const account = key ? await getAccount(key.domain, key.profileId) : null;
    if (stale()) return;
    // The tab follows the note unless the user picked one by hand for this very site and profile.
    const sameKey = sameAccountKey(state.accountKey, key);
    state.accountKey = key;
    state.account = account;
    // A hand-picked tab survives a re-read of the same row (a saved edit, an options change).
    if (!sameKey || state.accountRowId !== r.rowId) state.manualTab = false;
    state.accountRowId = r.rowId;
    if (!state.manualTab) switchTab(key && !accountSettled(account) ? 'signup' : 'submit');
    await saveCursor(campaign.id, r.rowId);
  } else {
    state.accountKey = null;
    state.account = null;
    switchTab('submit');
    state.manualTab = false;
  }
  performance.mark('panel:render');
  await refreshTab();
  performance.mark('panel:tab');
  draw();
  performance.mark('panel:draw');
}

/** Origin we believe the tab is on: the tab's own when visible, else the row's target. */
function assumedOrigin(): string | undefined {
  if (state.tab?.origin) return state.tab.origin;
  if (state.mailOrigin) return state.mailOrigin;
  const r = row();
  const url = r ? targetUrl(r) : null;
  return url ? originOf(url) : undefined;
}

async function refreshTab(): Promise<void> {
  state.tab = await activeTab();
  state.permitted = state.tab ? await hasOriginPermission(assumedOrigin()) : false;
  if (state.permitted && state.tab && !state.tab.url) {
    // Permission exists for the assumed origin; the URL becomes visible now — re-read it.
    state.tab = (await activeTab()) ?? state.tab;
  }
}

async function go(delta: number): Promise<void> {
  if (state.rows.length === 0) return;
  state.index = (state.index + delta + state.rows.length) % state.rows.length;
  await refreshRow();
}

async function reloadRow(): Promise<void> {
  if (!state.campaign) return;
  const id = row()?.rowId;
  state.rows = await loadRows(state.campaign.id);
  const i = id ? state.rows.findIndex((r) => r.rowId === id) : -1;
  state.index = i >= 0 ? i : Math.min(state.index, Math.max(0, state.rows.length - 1));
}

// ── Actions ────────────────────────────────────────────────────────────────────

/** Short, readable form of the target: host + path for sites, the address for e-mail, "demo page N" for ours. */
function targetLabel(r: Row): string {
  return labelFor(r.target, targetUrl(r), originOf(extUrl('/')));
}

function targetUrl(r: Row): string | null {
  if (r.targetKind === 'url') return /^[a-z][a-z0-9+.-]*:\/\//i.test(r.target) ? r.target : `https://${r.target}`;
  return null;
}

/** Ctrl / ⌘ / Shift on a click means "somewhere else" everywhere on the web; honour it here too. */
function wantsNewTab(e: Event): boolean {
  const m = e as MouseEvent;
  return m.ctrlKey || m.metaKey || m.shiftKey;
}

async function openTarget(newTab = false): Promise<void> {
  const r = row();
  if (!r) return;
  const url = targetUrl(r);
  if (url) {
    // Reuse or a new tab: the setting decides, a Ctrl / ⌘ / middle click always means "new tab"
    // (the web-wide convention, and the escape hatch when the page you are on matters).
    const inNewTab = newTab || state.openTargetIn === 'new';
    const tab =
      state.tab && !inNewTab ? await browser.tabs.update(state.tab.id, { url }) : await browser.tabs.create({ url });
    state.tab = tab?.id && tab.url ? { id: tab.id, url: tab.url, origin: originOf(tab.url) } : state.tab;
    state.toast = t('panelOpened', url);
  } else if (r.targetKind === 'email' && state.render) {
    // Measured, not guessed: the body rides in the link when it fits the provider's limit.
    const link = composeLink(state.mail, {
      to: r.target,
      subject: state.render.subject?.text ?? '',
      body: state.render.body.text,
    });
    if (link.origin) {
      const tab = state.tab
        ? await browser.tabs.update(state.tab.id, { url: link.url })
        : await browser.tabs.create({ url: link.url });
      state.tab = tab?.id ? { id: tab.id, url: tab.url ?? link.url, origin: link.origin } : state.tab;
      state.mailOrigin = link.origin;
    } else await browser.tabs.create({ url: link.url });
    // "Sent — next" may only take over when the message actually left the panel: inside the link,
    // or in the clipboard. A blocked clipboard leaves the user with work to do (Codex review #4).
    if (link.bodyIncluded) {
      state.handedOff = true;
      state.toast = t('panelOpenedMail', r.target);
    } else {
      const copied = await copyText(state.render.body.text);
      state.handedOff = copied;
      state.toast = copied
        ? link.origin
          ? t('panelMailTooLongFill')
          : t('panelMailTooLongPaste')
        : t('panelMailTooLongBlocked');
    }
  } else {
    const copied = state.render ? await copyText(state.render.body.text) : false;
    state.handedOff = copied;
    state.toast = copied ? t('panelNoUrlCopied') : t('panelNoUrlBlocked');
  }
  draw();
}

// ── Site account (ADR 0014) ────────────────────────────────────────────────────

/** The sign-up page when the user marked one, else the row's target. */
function signupUrl(r: Row): string | null {
  return state.account?.signupUrl ?? targetUrl(r);
}

async function openSignup(newTab = false): Promise<void> {
  const r = row();
  const url = r ? signupUrl(r) : null;
  if (!url) return;
  const inNewTab = newTab || state.openTargetIn === 'new';
  const tab =
    state.tab && !inNewTab ? await browser.tabs.update(state.tab.id, { url }) : await browser.tabs.create({ url });
  state.tab = tab?.id && tab.url ? { id: tab.id, url: tab.url, origin: originOf(tab.url) } : state.tab;
  state.toast = t('panelOpened', url);
  draw();
}

/**
 * Every change of tab goes through here: the mapping, its report, the fill note and an acknowledged
 * stale recipe belong to one tab's fill and must not carry over to the other (Codex review of #6).
 */
function switchTab(next: State['panelTab']): void {
  if (state.panelTab === next) return;
  state.panelTab = next;
  state.staleAck = false;
  state.fillNote = '';
  state.mapping = null;
  state.scan = null;
  state.report = [];
}

const sameAccountKey = (a: State['accountKey'], b: State['accountKey']): boolean =>
  !!a && !!b && a.domain === b.domain && a.profileId === b.profileId;

async function setAccount(patch: Partial<Pick<SiteAccount, 'state' | 'signupUrl'>>): Promise<void> {
  const key = state.accountKey;
  if (!key) return;
  const account = await saveAccount(key.domain, key.profileId, patch);
  // The row may have moved to another site or profile meanwhile: this note is not its note.
  if (!sameAccountKey(state.accountKey, key)) return;
  state.account = account;
  if (patch.state) {
    state.fillNote = '';
    state.toast = t(ACCOUNT_LABEL[account.state]);
    // Done with sign-up: the submission is the next step.
    if (accountSettled(account)) {
      switchTab('submit');
      state.manualTab = false;
    }
  }
  draw();
}

/** "This is the sign-up page": remember the open tab's address for this site. */
async function markSignupPage(): Promise<void> {
  const url = state.tab?.url;
  if (!url || !/^https?:/.test(url)) {
    state.toast = t('panelSignupPageUnknown');
    draw();
    return;
  }
  await setAccount({ signupUrl: url });
  state.toast = t('panelSignupPageSaved', new URL(url).hostname + pathOf(url));
  draw();
}

const ACCOUNT_LABEL: Record<AccountState, MessageKey> = {
  none: 'panelAccountNone',
  awaiting_email: 'panelAccountAwaiting',
  ready: 'panelAccountReady',
  not_needed: 'panelAccountNotNeeded',
};

/** An unsaved edit in the textarea is what the user sees — every action uses it (review #5). */
async function flushDraft(): Promise<void> {
  if (state.draft === null) return;
  const text = state.draft;
  state.draft = null;
  await saveEdit(text);
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/**
 * Icon button that copies one value — the way out when a field could not be filled (not found,
 * over the length limit, a form the helper cannot reach). Copying changes nothing about the row.
 */
function copyButton(value: string | (() => string), label: string): HTMLElement {
  const aria = t('panelCopyValue', label);
  return h(
    'button',
    {
      type: 'button',
      class: 'btn-icon btn-icon--sm panel__copy',
      'aria-label': aria,
      title: aria,
      onclick: async () => {
        const text = typeof value === 'function' ? value() : value;
        state.toast = (await copyText(text)) ? t('panelCopiedValue', label) : t('panelCopyBlocked');
        // In place, not draw(): a full redraw drops keyboard focus and closes "Edit this row".
        const notes = app.querySelector('.panel__notes');
        let toast = notes?.querySelector('.panel__toast');
        if (!toast && notes) {
          toast = h('p', { class: 'panel__toast muted', role: 'status' });
          notes.append(toast);
        }
        if (toast) toast.textContent = state.toast;
      },
    },
    svgIcon('copy'),
  );
}

async function copyAndOpen(): Promise<void> {
  await flushDraft();
  const r = row();
  if (!r || !state.render) return;
  const ok = await copyText(state.render.body.text);
  state.toast = ok ? t('panelCopied') : t('panelCopyBlocked');
  await openTarget();
  state.handedOff = true;
  draw();
}

/**
 * A keyboard command carries the tab it was pressed in and grants activeTab there: act on that tab
 * and try to fill directly; ask for the origin only when the page is still out of reach (review #3).
 */
async function commandFill(tabId?: number): Promise<void> {
  if (tabId !== undefined && state.tab?.id !== tabId) await refreshTab();
  await fill();
  // "The page is out of reach" is a code, not a sentence — the retry must survive translation.
  if (!state.permitted && state.fillError !== 'none') await allowAndFill();
}

/** Footer: a row of small icon links (the geo-tier-builder `.app-footer` idiom), no text to wrap. */
function panelFooter(): HTMLElement {
  const store = getStoreInfo();
  const link = (href: string, title: string, ...kids: (Node | string)[]): HTMLElement =>
    h('a', { href, target: '_blank', rel: 'noopener', title, 'aria-label': title }, ...kids);
  return h(
    'div',
    { class: 'panel__footer' },
    store
      ? link(
          store.url,
          t('panelRateOn', store.label),
          h('img', { src: store.icon, class: 'panel__footer-icon', alt: '' }),
        )
      : null,
    link(
      SPINTAX_URL('sidepanel'),
      t('panelSpintaxLink'),
      h('img', { src: '/icons/32.png', class: 'panel__footer-icon', alt: '' }),
    ),
    h('span', { class: 'panel__footer-sep' }),
    link(PUBLISHER_URL('sidepanel'), t('panelPublisherLink'), svg301Logo(16)),
  );
}

/** Open an options screen in a tab (openOptionsPage cannot carry a hash). */
async function openOptions(hash: string): Promise<void> {
  const base = browser.runtime.getURL('/options.html');
  const url = `${base}#${hash}`;
  // Reuse the options tab if one is open — clicking the cog three times used to leave three tabs
  // behind (UX review). `tabs.query({url})` cannot find it: filtering by URL needs the `tabs`
  // permission, which this extension deliberately does not ask for. `runtime.getContexts` reports
  // the extension's OWN pages without any permission, and updating a tab by id needs none either.
  const runtime = browser.runtime as unknown as {
    getContexts?: (filter: { contextTypes: string[] }) => Promise<{ documentUrl?: string; tabId?: number }[]>;
  };
  try {
    const contexts = (await runtime.getContexts?.({ contextTypes: ['TAB'] })) ?? [];
    const open = contexts.find((c) => c.documentUrl?.startsWith(base) && c.tabId !== undefined && c.tabId >= 0);
    if (open?.tabId !== undefined) {
      const tab = await browser.tabs.update(open.tabId, { url, active: true });
      // Selecting a tab does not raise its window: with the options page in another window the cog
      // would look dead (pre-release review #7). `windows.update` needs no permission.
      if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
      return;
    }
  } catch {
    // Firefox has no getContexts yet — fall through and open a tab.
  }
  await browser.tabs.create({ url });
}

async function allowAndFill(): Promise<void> {
  const origin = assumedOrigin();
  if (!state.tab || !origin) return;
  const granted = await requestOriginPermission(origin);
  state.permitted = granted;
  if (!granted) {
    state.toast = t('panelPermissionDenied');
    draw();
    return;
  }
  await fill();
}

/** A sign-up form gets the sender profile only — never the message, never a password (ADR 0014). */
const SIGNUP_SLOTS: Slot[] = ['profile.name', 'profile.email', 'profile.site', 'profile.phone'];

async function fill(): Promise<void> {
  if (state.busy) return;
  const signup = state.panelTab === 'signup';
  // An unsaved message edit belongs to the submission; a sign-up fill must not write it into the
  // row and the journal (Codex review of #6).
  if (!signup) await flushDraft();
  // Saving the draft re-reads the row; if that moved the panel to the other tab, this fill is not
  // the one the user asked for any more.
  if (state.panelTab !== (signup ? 'signup' : 'submit')) return;
  // Snapshot everything the operation needs: a tab or row change mid-way must not leak text
  // into the wrong page (review 2026-08-23 #1).
  const r = row();
  const campaign = state.campaign;
  const render = state.render;
  const tab = state.tab;
  const step = state.step;
  const mode = state.panelTab;
  if (!r || !campaign || !tab || (!render && !signup)) return;
  const token = ++opToken;
  state.busy = token;
  state.fillError = 'none';
  const stillValid = (): boolean =>
    opToken === token && row()?.rowId === r.rowId && state.tab?.id === tab.id && state.panelTab === mode;
  try {
    state.fillNote = t('panelScanning');
    draw();
    const scan = await scanTab(tab.id);
    if (!stillValid()) return;
    const { slots, specs } = signup ? { slots: SIGNUP_SLOTS, specs: [] } : slotsFor(campaign);
    const mapping = await resolveMapping(scan, slots, specs);
    if (!stillValid()) return;
    state.scan = scan;
    state.mapping = mapping;
    if (mapping.stale && !state.staleAck) {
      // The saved recipe no longer matches this form: show the rebuilt mapping first, fill on the
      // next press (review #4) — nothing reaches the page unseen.
      state.staleAck = true;
      state.fillNote = t('panelStaleRecipe');
      return;
    }
    const targets = mapping.fields.filter((f) => f.field).map((f) => f.field?.fieldId ?? '');
    if (targets.length > 0) await highlightFields(tab.id, targets);
    const values = fillValues(campaign, r, signup ? null : render);
    const fileColumns = new Map(campaign.columns.filter((c) => c.type === 'file').map((c) => [c.id, c.header]));
    const { report, clipboardSlots, warnings } = await fillTab(tab.id, mapping, values, fileColumns, scan.token);
    if (!stillValid()) return;
    state.report = report;
    const landed = report.filter(
      (x) => x.outcome === 'exact' || x.outcome === 'equivalent' || x.outcome === 'changedBySite',
    ).length;
    const skipped = report.filter((x) => x.outcome === 'skippedNonEmpty').length;
    if (signup || !render) {
      // The row's status is about the message; a sign-up fill leaves it alone and says what is
      // still the human's: password, captcha, checkboxes, the button.
      if (mapping.fields.some((f) => f.field) && (mapping.source === 'heuristic' || mapping.stale))
        mapping.recipe = await saveMapping(
          scan,
          mapping,
          mapping.fields.some((f) => f.recipeField.manual) ? 'manual' : 'heuristic',
        );
      const parts: string[] = [];
      if (landed > 0) parts.push(tn(landed, 'panelFilled'));
      else parts.push(t('panelNothingFilled'));
      if (skipped > 0) parts.push(t('panelSkipped', String(skipped)));
      parts.push(...warnings.map((w) => `⚠ ${w}`));
      state.fillNote = `${parts.join('; ')}. ${t('panelSignupLeftToYou')}`;
      return;
    }
    let copied = false;
    if (clipboardSlots.includes('output.body')) copied = await copyText(render.body.text);
    if (mapping.fields.some((f) => f.field) && (mapping.source === 'heuristic' || mapping.stale)) {
      mapping.recipe = await saveMapping(
        scan,
        mapping,
        mapping.fields.some((f) => f.recipeField.manual) ? 'manual' : 'heuristic',
      );
    }
    // The row becomes "filled, unconfirmed" only when something actually reached the page
    // (or the message is in the clipboard for a rich editor) — review #6.
    const bodyLanded = report.some(
      (x) =>
        x.slot === 'output.body' &&
        (x.outcome === 'exact' || x.outcome === 'equivalent' || x.outcome === 'changedBySite'),
    );
    if (bodyLanded || copied) {
      await recordFilled(r, step, render, mapping.recipe, report);
      await reloadRow();
    }
    // Whole sentences, one key each: German and Russian order the clauses differently, so only the
    // "; " between them is assembled here.
    const parts: string[] = [];
    if (landed > 0) parts.push(tn(landed, 'panelFilled'));
    if (skipped > 0) parts.push(t('panelSkipped', String(skipped)));
    if (copied) parts.push(t('panelClipboardHint'));
    else if (clipboardSlots.includes('output.body')) parts.push(t('panelClipboardBlocked'));
    // A page with no fields at all: the mapping section says so; "nothing filled, not found: …"
    // would only repeat it.
    const formless = scan.fields.length === 0;
    const missing = formless ? [] : missingSlots(mapping, values);
    if (!formless && landed === 0 && !copied) parts.push(t('panelNothingFilled'));
    else if (!formless && !bodyLanded && !copied) parts.push(t('panelBodyNotFilled'));
    if (missing.length > 0) parts.push(t('panelNotFoundHere', missing.map((s) => slotLabel(s)).join(', ')));
    if (mapping.stale) parts.push(t('panelStaleRebuilt'));
    parts.push(...warnings.map((w) => `⚠ ${w}`));
    state.fillNote = parts.length > 0 ? `${parts.join('; ')}.` : '';
  } catch (err) {
    if (stillValid()) {
      // The code decides what happens next; the sentence is only for the user (i18n).
      const code = (err as { code?: string }).code;
      state.fillError = code === 'no-access' ? 'no-access' : code === 'old-helper' ? 'old-helper' : 'other';
      state.fillNote = t('panelFillFailed', (err as Error).message);
    }
  } finally {
    if (opToken === token) {
      state.busy = 0;
      // A fill abandoned half-way (the row or the tab changed under it) must not leave the
      // "Scanning…" note and a disabled button on screen.
      if (state.fillNote === t('panelScanning')) state.fillNote = '';
    }
    // In `finally`: the early returns above used to skip the redraw (e2e found a stuck "Filling…").
    draw();
  }
}

async function outcome(
  kind: 'sent' | 'deferred' | 'failed' | 'excluded' | 'replied' | 'declined',
  extra?: { reason?: FailureReason; until?: string },
): Promise<void> {
  // "Sent" (button, S, the global command) is about the message: nothing was sent from Sign-up.
  if (kind === 'sent' && state.panelTab === 'signup') return;
  await flushDraft();
  const r = row();
  if (!r || !state.render) return;
  const base = {
    rowId: r.rowId,
    step: state.step,
    engineVersion: ENGINE_VERSION,
    body: state.render.body.text,
    subject: state.render.subject?.text,
  };
  if (kind === 'failed' && extra?.reason) await appendEvent({ ...base, event: 'failed', reason: extra.reason });
  else if (kind === 'deferred' && extra?.until) await appendEvent({ ...base, event: 'deferred', until: extra.until });
  else if (kind !== 'failed' && kind !== 'deferred') await appendEvent({ ...base, event: kind });
  state.toast = kind === 'sent' ? t('panelMarkedSent', r.seedKey) : t('panelMarked', t(KIND_LABEL[kind]));
  await reloadRow();
  // Auto-advance to the next work row (spec §7); stays if nothing else is left.
  const next = state.rows.findIndex((x, i) => i !== state.index && isWork(x));
  if (next >= 0) state.index = next;
  await refreshRow();
}

async function saveEdit(text: string): Promise<void> {
  const r = row();
  if (!r || !state.render) return;
  await updateRow(r.rowId, { overrides: { ...r.overrides, body: { step: state.step, text, source: 'edit' } } });
  await appendEvent({
    rowId: r.rowId,
    step: state.step,
    event: 'edited',
    engineVersion: ENGINE_VERSION,
    body: text,
    subject: state.render.subject?.text,
  });
  await reloadRow();
  await refreshRow();
}

async function pointAt(slot: Slot): Promise<void> {
  const origin = assumedOrigin();
  if (!state.tab || !origin) return;
  if (!state.permitted) {
    const ok = await requestOriginPermission(origin);
    state.permitted = ok;
    if (!ok) return;
  }
  state.pickingSlot = slot;
  state.toast = t('panelPickHint', slotLabel(slot));
  draw();
  await startPicker(state.tab.id);
}

let reloadTimer: number | undefined;
browser.runtime.onMessage.addListener((raw: unknown, sender) => {
  const msg = raw as RuntimeMessage;
  if (msg.type === 'data-changed') {
    // Options page wrote something (rows, profile, template, campaign switch): refresh the queue.
    // While the user is mid-action here the reload waits instead of being dropped: a campaign
    // switched or deleted in options must reach the panel once the fill or edit is over.
    const attempt = (): void => {
      if (state.busy || state.draft !== null || state.pickingSlot) {
        reloadTimer = window.setTimeout(attempt, 1000);
        return;
      }
      void reload();
    };
    window.clearTimeout(reloadTimer);
    reloadTimer = window.setTimeout(attempt, 150);
    return;
  }
  if (msg.type === 'picked') {
    // Only the tab this panel is working on may answer the picker (review #9).
    if (sender.tab?.id !== undefined && state.tab && sender.tab.id !== state.tab.id) return;
    const slot = state.pickingSlot;
    state.pickingSlot = null;
    if (msg.field && slot && state.scan) {
      state.mapping = withManualField(
        state.mapping ?? { recipe: null, fields: [], unmapped: [], stale: false, source: 'heuristic' },
        slot,
        msg.field,
      );
      void saveMapping(state.scan, state.mapping, 'manual').then((recipe) => {
        if (state.mapping) state.mapping.recipe = recipe;
        state.toast = t('panelSavedSlot', slotLabel(slot), msg.field?.name ?? msg.field?.label ?? msg.field?.tag ?? '');
        draw();
      });
    } else state.toast = t('panelPickCancelled');
    draw();
  } else if (msg.type === 'command') {
    // Commands carry the window they were pressed in; another window's panel ignores them.
    if (msg.windowId !== undefined && state.windowId !== null && msg.windowId !== state.windowId) return;
    if (msg.command === 'fill-form') void commandFill(msg.tabId);
    else if (msg.command === 'copy-and-open') void copyAndOpen();
    else if (msg.command === 'mark-sent-next') void outcome('sent');
    else if (msg.command === 'next-row') void go(1);
  }
});

browser.tabs.onActivated.addListener((info) => {
  if (state.windowId !== null && info.windowId !== state.windowId) return;
  void refreshTab().then(draw);
});
browser.tabs.onUpdated.addListener((id, info) => {
  if (state.tab && id !== state.tab.id) return;
  if (info.status === 'complete' || info.url) void refreshTab().then(draw);
});
void browser.windows.getCurrent().then((w) => {
  state.windowId = w.id ?? null;
});

/**
 * The one-letter shortcuts this handler answers. The captions take the letter as a substitution, so
 * a translated caption can never promise a key the handler does not listen for — and the handler
 * matches `event.code` (the PHYSICAL key), because on a Russian layout the S key emits «ы» and the
 * hint would otherwise be a lie in exactly the locales this UI was translated for (Codex #3).
 */
const SENT_KEY = 'S';
const NEXT_KEY = 'N';
const SENT_CODE = 'KeyS';
const NEXT_CODE = 'KeyN';

document.addEventListener('keydown', (e) => {
  // Ctrl+S is Save, not "mark sent": a chord is never one of ours (pre-release review #5).
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target as HTMLElement | null;
  if (el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.isContentEditable)) return;
  if (e.key === 'Enter') app.querySelector<HTMLButtonElement>('.panel__primary')?.click();
  else if (e.code === SENT_CODE || e.key.toLowerCase() === SENT_KEY.toLowerCase()) void outcome('sent');
  else if (e.code === NEXT_CODE || e.key.toLowerCase() === NEXT_KEY.toLowerCase()) void go(1);
  else return;
  e.preventDefault();
});

// ── View ───────────────────────────────────────────────────────────────────────

/** "Field mapping — 4 mapped, 1 missing · recipe changed, confirm" — a clause per key. */
/** Profile values only for a sign-up fill or a step without a message; everything otherwise. */
function fillValues(c: Campaign, r: Row, render: RowRender | null): Partial<Record<Slot, string>> {
  const profile = pickProfile(c, r);
  if (render) return slotValues(c, r, render, profile);
  return {
    'profile.name': profile?.values.name ?? '',
    'profile.email': profile?.values.email ?? '',
    'profile.site': profile?.values.site ?? '',
    'profile.phone': profile?.values.phone ?? '',
  };
}

/** Slots with no field on the page — only those with something to put there: an empty profile
 *  phone "not found" on every form was noise (demo review). */
function missingSlots(mapping: ResolvedMapping, values: Partial<Record<Slot, string>>): Slot[] {
  return mapping.unmapped.filter((s) => (values[s] ?? '') !== '');
}

function mappingSummary(mapping: ResolvedMapping, missingCount: number): string {
  const mapped = t('panelMappingSummary', String(mapping.fields.filter((f) => f.field).length));
  const missing = missingCount ? `, ${t('panelMappingMissing', String(missingCount))}` : '';
  const stale = mapping.stale ? ` · ${t('panelMappingStale')}` : '';
  return `${mapped}${missing}${stale}`;
}

/** "1 / 12 · 5 to do · 2 due" — three independent facts, one message each, one separator. */
function counterText(work: number, due: number): string {
  const parts = [
    t('panelCounterPos', String(state.rows.length ? state.index + 1 : 0), String(state.rows.length)),
    t('panelCounterTodo', String(work)),
  ];
  if (due) parts.push(t('panelCounterDue', String(due)));
  return parts.join(' · ');
}

function draw(): void {
  clear(app);
  const r = row();
  const c = state.campaign;
  const tUrl = r ? targetUrl(r) : null;
  // On target = same page when the row names one (path), else same origin; a hidden tab URL
  // (no permission yet) counts — we will ask for the target's origin (review UX #1).
  const onTarget =
    !!r &&
    !!state.tab &&
    ((!!tUrl &&
      (!state.tab.origin || (state.tab.url ? samePage(state.tab.url, tUrl) : originOf(tUrl) === state.tab.origin))) ||
      (r.targetKind === 'email' && !!state.mailOrigin && state.tab.origin === state.mailOrigin));
  const sameSiteOtherPage = !onTarget && !!tUrl && !!state.tab?.url && originOf(tUrl) === state.tab.origin;
  const work = state.rows.filter((x) => isWork(x)).length;
  const due = state.rows.filter((x) => isDue(x)).length;

  const header = h(
    'header',
    { class: 'panel__header' },
    h(
      'div',
      { class: 'panel__campaign' },
      // The campaign name is the way back to the campaign itself: the panel is where you notice a
      // wrong column or a missing step, and there was no route from here to fix it.
      c
        ? h(
            'button',
            {
              type: 'button',
              class: 'panel__campaign-link',
              title: t('panelOpenCampaign'),
              onclick: () => void openOptions('list'),
            },
            h('img', { src: '/icons/32.png', class: 'brand-mark', alt: '' }),
            h('strong', {}, c.name),
            svgIcon('open-in-new'),
          )
        : h('strong', {}, h('img', { src: '/icons/32.png', class: 'brand-mark', alt: '' }), 'Spintax'),
      h('span', { class: 'panel__counter' }, c ? counterText(work, due) : t('panelNoCampaign')),
    ),
    h(
      'div',
      { class: 'panel__tools' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn-icon btn-icon--compact',
          'aria-label': t('panelSettingsAria'),
          title: t('panelSettingsTitle'),
          onclick: () => void openOptions('settings'),
        },
        svgIcon('cog'),
      ),
      themeToggleButton(),
      newsBellButton(),
    ),
  );

  if (!c || !r) {
    append(app, [
      header,
      h(
        'section',
        { class: 'card card--soft panel__row' },
        h('div', { class: 'panel__row-key' }, c ? t('panelNoRows') : t('panelNoCampaignYet')),
        h('div', { class: 'panel__row-meta muted' }, t('panelEmptyHint')),
      ),
      actionBar(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--primary panel__primary',
            onclick: () => void openOptions('wizard'),
          },
          svgIcon('open-in-new'),
          ' ',
          t('panelOpenCampaigns'),
        ),
        [],
        [],
      ),
    ]);
    return;
  }

  const card = h(
    'fieldset',
    { class: 'fieldset-group panel__row', 'aria-label': t('panelRowAria') },
    h('legend', { class: 'panel__row-key' }, r.seedKey, ' ', statusBadge(r)),
    h(
      'div',
      { class: 'panel__row-meta muted' },
      targetUrl(r)
        ? h(
            'a',
            { class: 'panel__target', href: targetUrl(r) ?? '#', target: '_blank', rel: 'noopener', title: r.target },
            targetLabel(r),
            svgIcon('open-in-new'),
          )
        : h('span', { class: 'panel__target', title: r.target }, targetLabel(r)),
      ` · ${t('panelStep', String(state.step))}${r.lang ? ` · ${r.lang}` : ''}`,
      sameSiteOtherPage && state.tab?.url
        ? h('div', { class: 'text-warning' }, t('panelOtherPage', pathOf(state.tab.url), pathOf(tUrl ?? '')))
        : null,
    ),
    rowVars(c, r),
    h(
      'div',
      { class: 'panel__row-nav' },
      h(
        'button',
        {
          type: 'button',
          class: 'btn-icon btn-icon--compact',
          'aria-label': t('panelPrevRow'),
          onclick: () => void go(-1),
        },
        svgIcon('chevron-left'),
      ),
      h(
        'button',
        {
          type: 'button',
          class: 'btn-icon btn-icon--compact',
          'aria-label': t('panelNextRow', NEXT_KEY),
          onclick: () => void go(1),
        },
        svgIcon('chevron-right'),
      ),
    ),
  );

  // The same values the fill would use: profile only on the Sign-up tab.
  const values = fillValues(c, r, state.accountKey && state.panelTab === 'signup' ? null : state.render);
  const message = h(state.render ? 'fieldset' : 'section', {
    class: state.render ? 'fieldset-group panel__message' : 'panel__message',
    'aria-label': t('panelMessageAria'),
  });
  if (state.render) {
    const textarea = h('textarea', { id: 'message-body', class: 'panel__textarea', rows: 7 }) as HTMLTextAreaElement;
    textarea.value = state.draft ?? state.render.body.text;
    const saveBtn = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--ghost btn--sm',
        hidden: state.draft === null,
        onclick: () => void saveEdit(textarea.value),
      },
      t('panelSaveEdit'),
    );
    textarea.addEventListener('input', () => {
      state.draft = textarea.value === state.render?.body.text ? null : textarea.value;
      saveBtn.hidden = state.draft === null;
    });
    append(message, [
      h(
        'legend',
        {},
        `${t('panelBodyChars', String(state.render.body.text.length))}${r.overrides?.body ? ` · ${t('panelEdited')}` : ''}`,
      ),
      state.render.subject
        ? h(
            'div',
            { class: 'panel__copyrow' },
            h(
              'p',
              { class: 'panel__subject' },
              h('span', { class: 'muted' }, t('panelSubjectLabel'), ' '),
              highlighted(state.render.subject),
            ),
            copyButton(state.render.subject.text, slotLabel('output.subject')),
          )
        : null,
      h(
        'div',
        { class: 'panel__copyrow panel__preview' },
        highlighted(state.render.body),
        // What the box below shows, unsaved edit included.
        copyButton(() => textarea.value, slotLabel('output.body')),
      ),
      h(
        'details',
        { class: 'field-details panel__edit' },
        h('summary', { class: 'field-details__summary' }, t('panelEditRow')),
        h('div', { class: 'field-details__body stack--sm' }, textarea, saveBtn),
      ),
      warningsList(state.render.warnings),
    ]);
  } else {
    // The only content on screen in this state: make the card itself the way out, not an inert
    // notice with the action stranded in the footer (UX review).
    message.append(
      h(
        'button',
        {
          type: 'button',
          class: 'panel panel--warning panel--compact panel__no-message',
          onclick: () => void openOptions(`template?step=${state.step}`),
        },
        h('span', {}, t('panelNoMessage', String(state.step))),
        svgIcon('pencil-circle'),
      ),
    );
  }

  const tabHost = state.tab?.url
    ? isOwnOrigin(originOf(state.tab.url))
      ? t('panelDemoPage')
      : new URL(state.tab.url).hostname
    : targetUrl(r)
      ? isOwnOrigin(originOf(targetUrl(r) ?? ''))
        ? t('panelDemoPage') // tab.url is hidden without the tabs permission; the row says where we are
        : new URL(targetUrl(r) ?? 'https://x').hostname
      : '';
  // A copy button on every slot with a value: what the helper could not put on the page, the human
  // can (demo review). Files are uploads, not text.
  const fileSlots = new Set(c.columns.filter((col) => col.type === 'file').map((col) => `row.${col.id}`));
  const slotCopy = (s: Slot): HTMLElement | null => {
    const v = values[s] ?? '';
    if (v === '' || fileSlots.has(s)) return null;
    return copyButton(s === 'output.body' ? () => state.draft ?? v : v, slotLabel(s));
  };
  const missing = state.mapping ? missingSlots(state.mapping, values) : [];
  // A page with no fields at all (blog-4): one line, not a list of "not found" with nothing to point at.
  const recipe =
    state.scan?.fields.length === 0
      ? h('p', { class: 'panel__nofields muted' }, t('panelNoFields'))
      : h(
          'details',
          { class: 'field-details panel__recipe', open: !!state.mapping },
          h(
            'summary',
            { class: 'field-details__summary' },
            state.mapping
              ? mappingSummary(state.mapping, missing.length)
              : t('panelMappingHost', tabHost || t('panelNoPage')),
          ),
          state.mapping
            ? h(
                'ul',
                { class: 'panel__slots field-details__body' },
                ...state.mapping.fields.map((f) => {
                  const rep = state.report.find((x) => x.slot === f.slot);
                  const outcomeFlag =
                    rep?.outcome === 'exact' || rep?.outcome === 'equivalent'
                      ? 'flag--ok'
                      : rep?.outcome === 'skippedNonEmpty'
                        ? 'flag--muted'
                        : 'flag--warn';
                  return h(
                    'li',
                    { class: 'slot' },
                    h(
                      'div',
                      { class: 'slot__main' },
                      h('span', { class: 'btn-chip btn-chip--sm chip--ok slot__name' }, slotLabel(f.slot)),
                      h('span', { class: 'slot__arrow muted' }, '→'),
                      h(
                        'code',
                        { class: 'slot__field', title: f.field?.label ?? f.field?.name ?? '' },
                        f.field?.name ?? f.field?.label ?? f.field?.placeholder ?? f.field?.tag ?? '?',
                      ),
                    ),
                    h(
                      'div',
                      { class: 'row-actions' },
                      rep
                        ? h(
                            'span',
                            { class: `flag ${outcomeFlag}`, title: rep.detail ?? '' },
                            t(FLAG_LABEL[rep.outcome]),
                          )
                        : null,
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'flag flag--button panel__policy',
                          title: t('panelPolicyTitle'),
                          onclick: () => {
                            // Cursor insertion exists for text inputs only; selects and files take or skip a value.
                            const order =
                              f.field?.tag === 'select' || f.field?.type === 'file'
                                ? POLICY_ORDER.filter((p) => p !== 'insertAtCursor')
                                : POLICY_ORDER;
                            const i = order.indexOf(f.recipeField.fillPolicy);
                            void patchSlot(f.slot, { fillPolicy: order[(i + 1) % order.length] ?? 'skipIfFilled' });
                          },
                        },
                        t(POLICY_LABEL[f.recipeField.fillPolicy]),
                        ' ▾',
                      ),
                      f.recipeField.manual
                        ? h('span', { class: 'flag flag--info', title: t('panelPinnedTitle') }, t('flagPinned'))
                        : h(
                            'button',
                            {
                              type: 'button',
                              class: 'btn-icon btn-icon--sm',
                              'aria-label': t('panelPinAria'),
                              title: t('panelPinTitle'),
                              onclick: () => void patchSlot(f.slot, { manual: true, confidence: 1 }),
                            },
                            svgIcon('lock'),
                          ),
                      slotCopy(f.slot),
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'btn-icon btn-icon--sm',
                          'aria-label': t('panelClearAria'),
                          title: t('panelClearTitle'),
                          onclick: () => void clearMapping(f.slot),
                        },
                        svgIcon('close'),
                      ),
                    ),
                  );
                }),
                ...missing.map((s) =>
                  h(
                    'li',
                    { class: 'slot' },
                    h(
                      'div',
                      { class: 'slot__main' },
                      h('span', { class: 'btn-chip btn-chip--sm chip--danger slot__name' }, slotLabel(s)),
                      h('span', { class: 'muted slot__field' }, t('slotNotFound')),
                    ),
                    h(
                      'div',
                      { class: 'row-actions' },
                      slotCopy(s),
                      h(
                        'button',
                        { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => void pointAt(s) },
                        svgIcon('target'),
                        ' ',
                        t('panelPointAt'),
                      ),
                    ),
                  ),
                ),
                state.mapping.recipe
                  ? h(
                      'li',
                      { class: 'panel__slots-foot' },
                      h(
                        'button',
                        {
                          type: 'button',
                          class: 'btn btn--danger btn--outline btn--sm',
                          onclick: () => void forgetMapping(),
                        },
                        svgIcon('trash'),
                        ' ',
                        t('panelForgetRecipe'),
                      ),
                    )
                  : null,
              )
            : h('p', { class: 'muted' }, t('panelMappingHelp')),
        );

  let primary: HTMLElement;
  const secondary: HTMLElement[] = [];
  const sentNext = (): HTMLElement =>
    h(
      'button',
      { type: 'button', class: 'btn btn--primary panel__primary', onclick: () => void outcome('sent') },
      svgIcon('check'),
      ' ',
      t('panelSentNext', SENT_KEY),
    );
  if (!state.render) {
    // No message for this step: nothing to fill or copy — writing the template is the only next step.
    primary = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary panel__primary',
        onclick: () => void openOptions(`template?step=${state.step}`),
      },
      svgIcon('pencil-circle'),
      ' ',
      t('panelWriteTemplate', String(state.step)),
    );
  } else if (r.deliveryStatus === 'filled_unconfirmed' || state.handedOff) {
    primary = sentNext();
  } else if (!onTarget) {
    primary = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary panel__primary',
        // The label is truncated to fit the button; the whole URL lives in the tooltip.
        title: tUrl ?? undefined,
        onclick: (e: Event) => void openTarget(wantsNewTab(e)),
        onauxclick: (e: Event) => {
          if ((e as MouseEvent).button === 1) void openTarget(true);
        },
      },
      svgIcon('open-in-new'),
      ' ',
      tUrl
        ? sameSiteOtherPage
          ? t('panelOpenPath', shortPath(tUrl))
          : t('panelOpenHost', new URL(tUrl).hostname)
        : t('panelOpenTarget'),
    );
  } else if (!state.permitted) {
    primary = h(
      'button',
      { type: 'button', class: 'btn btn--primary panel__primary', onclick: () => void allowAndFill() },
      svgIcon('auto-fix'),
      ' ',
      t('panelAllowFill', tabHost),
    );
  } else {
    primary = h(
      'button',
      {
        type: 'button',
        class: 'btn btn--primary panel__primary',
        disabled: state.busy !== 0,
        onclick: () => void fill(),
      },
      svgIcon('auto-fix'),
      ' ',
      state.busy !== 0 ? t('panelFilling') : t('panelFillOn', tabHost),
    );
  }
  if (state.render) {
    secondary.push(
      h(
        'button',
        { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => void copyAndOpen() },
        svgIcon('copy'),
        ' ',
        t('panelCopyOpen'),
      ),
    );
    // The message may have gone out another way (mail app, chat): "sent" must be one click, not a key.
    // Only rows that are still work: marking a replied / declined / not-applicable row "sent"
    // would overwrite a terminal outcome and could re-arm follow-ups (Codex review #2).
    if (r.deliveryStatus !== 'filled_unconfirmed' && !state.handedOff && isWork(r))
      secondary.push(
        h(
          'button',
          { type: 'button', class: 'btn btn--ghost btn--sm', onclick: () => void outcome('sent') },
          svgIcon('check'),
          ' ',
          t('panelMarkSent', SENT_KEY),
        ),
      );
  }
  // Sign-up tab (ADR 0014): the profile goes into the site's registration form; the human sets the
  // password, solves the captcha, ticks the boxes and presses the button.
  const signupTab = !!state.accountKey && state.panelTab === 'signup';
  if (signupTab) {
    const sUrl = signupUrl(r);
    const onWeb = !!state.tab && (state.tab.url === undefined || /^https?:/.test(state.tab.url));
    if (!onWeb && sUrl)
      primary = h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary panel__primary',
          title: sUrl,
          onclick: (e: Event) => void openSignup(wantsNewTab(e)),
        },
        svgIcon('open-in-new'),
        ' ',
        t('panelOpenHost', new URL(sUrl).hostname),
      );
    else if (!state.permitted)
      primary = h(
        'button',
        { type: 'button', class: 'btn btn--primary panel__primary', onclick: () => void allowAndFill() },
        svgIcon('auto-fix'),
        ' ',
        t('panelSignupAllowFill', tabHost),
      );
    else
      primary = h(
        'button',
        {
          type: 'button',
          class: 'btn btn--primary panel__primary',
          disabled: state.busy !== 0,
          onclick: () => void fill(),
        },
        svgIcon('auto-fix'),
        ' ',
        state.busy !== 0 ? t('panelFilling') : t('panelSignupFill', tabHost),
      );
    secondary.length = 0;
    if (sUrl && onWeb)
      secondary.push(
        h(
          'button',
          {
            type: 'button',
            class: 'btn btn--ghost btn--sm',
            title: sUrl,
            onclick: (e: Event) => void openSignup(wantsNewTab(e)),
          },
          svgIcon('open-in-new'),
          ' ',
          t('panelSignupOpenPage'),
        ),
      );
  }

  // Everything that is not the one obvious next step lives in the sheet behind the grip: two
  // nested <details> used to reflow the footer into a two-row cluster (UX review U11).
  const act = (label: string, run: () => void, icon?: Parameters<typeof svgIcon>[0]): HTMLElement =>
    h(
      'button',
      { type: 'button', class: 'btn btn--ghost btn--sm', onclick: run },
      ...(icon ? [svgIcon(icon), ' '] : []),
      label,
    );
  const reasons: [FailureReason, MessageKey][] = [
    ['no_form', 'panelReasonNoForm'],
    ['captcha', 'panelReasonCaptcha'],
    ['no_contact', 'panelReasonNoContact'],
    ['technical', 'panelReasonTechnical'],
  ];
  const sheet: HTMLElement[] = [
    h(
      'div',
      { class: 'panel__group' },
      h('span', { class: 'panel__group-label' }, t('panelGroupOutcome')),
      h(
        'div',
        { class: 'panel__group-row' },
        act(t('panelDefer3Days'), () => void outcome('deferred', { until: deferUntil(3) }), 'clock'),
        act(t('panelNotApplicable'), () => void outcome('excluded')),
        act(t('panelReplied'), () => void outcome('replied')),
        act(t('panelDeclined'), () => void outcome('declined')),
      ),
    ),
    h(
      'div',
      { class: 'panel__group' },
      h('span', { class: 'panel__group-label' }, t('panelGroupNotSent')),
      h(
        'div',
        { class: 'panel__group-row' },
        ...reasons.map(([reason, label]) => act(t(label), () => void outcome('failed', { reason }))),
      ),
    ),
    h(
      'div',
      { class: 'panel__group' },
      h('span', { class: 'panel__group-label' }, t('panelGroupEdit')),
      h(
        'div',
        { class: 'panel__group-row' },
        // The body of the step you are looking at — the most likely thing to want to fix, and it
        // was the one entry the "edit" group did not offer.
        act(
          t('panelEditStep', String(state.step)),
          () => void openOptions(`template?step=${state.step}`),
          'pencil-circle',
        ),
        act(t('panelStepsFollowups'), () => void openOptions('template'), 'clock'),
        act(
          t('panelSubjectTemplate'),
          () => void openOptions(`template?channel=subject&step=${state.step}`),
          'pencil-circle',
        ),
      ),
    ),
  ];

  // A rich editor never gets text programmatically (spec: clipboard + focus). The instruction in
  // fillNote is transient — reconstruct it from the mapping while the row waits for its paste,
  // so a panel reload does not eat the one step the user still has to do.
  const bodyViaClipboard =
    r?.deliveryStatus === 'filled_unconfirmed' &&
    (state.pendingPaste ||
      state.mapping?.fields.find((f) => f.slot === 'output.body')?.field?.tag === 'contenteditable');
  const notes = h(
    'div',
    { class: 'panel__notes' },
    state.fillNote
      ? h('p', { class: 'panel__note' }, state.fillNote)
      : bodyViaClipboard
        ? h('p', { class: 'panel__note' }, t('panelRichEditorNote'))
        : null,
    state.toast ? h('p', { class: 'panel__toast muted', role: 'status' }, state.toast) : null,
  );
  if (state.scan && state.scan.links.length > 0 && (state.mapping?.fields.filter((f) => f.field).length ?? 0) === 0) {
    notes.append(
      h(
        'p',
        { class: 'muted' },
        t('panelFoundOnPage'),
        ' ',
        ...state.scan.links
          .slice(0, 5)
          .map((l) =>
            h(
              'a',
              { href: l.href, target: '_blank', rel: 'noopener', class: 'panel__link' },
              l.kind === 'mailto' ? l.href.replace(/^mailto:/, '') : l.text || l.href,
            ),
          ),
      ),
    );
  }

  append(app, [
    header,
    card,
    state.accountKey ? panelTabs() : null,
    signupTab ? signupSection(c, r) : message,
    recipe,
    notes,
    actionBar(primary, secondary, sheet),
  ]);
}

/**
 * The row's own columns: one clipped line, and the whole text one click away — a column like
 * "instruction" is the thing to read on the site, and it was cut after a few words (field test).
 */
function rowVars(c: Campaign, r: Row): HTMLElement {
  const cols = c.columns.filter((col) => col.type === 'text' && col.role === 'none' && !col.hidden);
  const line = cols
    .slice(0, 3)
    .map((col) => `${col.header}: ${r.values[col.id] ?? ''}`)
    .join(' · ');
  const filled = cols.filter((col) => (r.values[col.id] ?? '').trim() !== '');
  if (filled.length === 0) return h('div', { class: 'panel__row-vars muted' }, line);
  return h(
    'details',
    { class: 'panel__row-vars-box' },
    h('summary', { class: 'panel__row-vars muted' }, line),
    h(
      'dl',
      { class: 'panel__row-values' },
      ...filled.flatMap((col) => [h('dt', {}, col.header), h('dd', {}, r.values[col.id] ?? '')]),
    ),
  );
}

/**
 * Sign-up / Submission switch over the row (submissions campaigns, ADR 0014). Two toggle buttons
 * in a group (aria-pressed), not an ARIA tabs widget: there is no tabpanel to own.
 */
function panelTabs(): HTMLElement {
  const tab = (id: 'signup' | 'submit', label: string, badge?: string): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: `tabs__trigger panel__tab${state.panelTab === id ? ' is-active' : ''}`,
        'aria-pressed': String(state.panelTab === id),
        onclick: () => {
          if (state.panelTab === id) return;
          switchTab(id);
          state.manualTab = true;
          draw();
        },
      },
      label,
      badge ? h('span', { class: 'panel__tab-badge' }, badge) : null,
    );
  const settled = accountSettled(state.account);
  return h(
    'div',
    { class: 'tabs__nav panel__tabs', role: 'group', 'aria-label': t('panelTabsAria') },
    tab('signup', t('panelTabSignup'), settled ? '✓' : undefined),
    tab('submit', t('panelTabSubmit')),
  );
}

function signupSection(c: Campaign, r: Row): HTMLElement {
  const profile = pickProfile(c, r);
  const state_ = state.account?.state ?? 'none';
  const values = SIGNUP_SLOTS.map(
    (s) => [s, profile?.values[s.slice(8) as 'name' | 'email' | 'site' | 'phone'] ?? ''] as const,
  ).filter(([, v]) => v.trim() !== '');
  const stateBtn = (label: string, next: AccountState, primary = false): HTMLElement =>
    h(
      'button',
      {
        type: 'button',
        class: `btn ${primary ? 'btn--primary' : 'btn--ghost'} btn--sm`,
        'aria-pressed': String(state_ === next),
        onclick: () => void setAccount({ state: next }),
      },
      label,
    );
  return h(
    'fieldset',
    { class: 'fieldset-group panel__message panel__signup', 'aria-label': t('panelTabSignup') },
    h('legend', { class: 'panel__signup-state' }, t(ACCOUNT_LABEL[state_])),
    h('p', { class: 'muted' }, t('panelSignupIntro')),
    values.length > 0
      ? h(
          'ul',
          { class: 'panel__signup-values' },
          ...values.map(([s, v]) =>
            h(
              'li',
              { class: 'panel__copyrow' },
              h('span', {}, h('span', { class: 'muted' }, `${slotLabel(s)}: `), v),
              copyButton(v, slotLabel(s)),
            ),
          ),
        )
      : h(
          'button',
          { type: 'button', class: 'panel panel--warning panel--compact', onclick: () => void openOptions('profiles') },
          t('panelSignupNoProfile'),
        ),
    h(
      'div',
      { class: 'cluster' },
      state_ === 'none' ? stateBtn(t('panelSignupRegistered'), 'awaiting_email') : null,
      stateBtn(t('panelSignupConfirmed'), 'ready', state_ === 'awaiting_email'),
      stateBtn(t('panelSignupNotNeeded'), 'not_needed'),
    ),
    h(
      'p',
      { class: 'muted panel__signup-page' },
      state.account?.signupUrl ? `${t('panelSignupPageLabel')} ${pathOf(state.account.signupUrl)} · ` : '',
      h(
        'button',
        { type: 'button', class: 'btn-link', onclick: () => void markSignupPage() },
        t('panelSignupThisPage'),
      ),
    ),
  );
}

const SHEET_KEY = 'spintax_panel_sheet';
const SHEET_H_KEY = 'spintax_panel_sheet_h';
const SHEET_MIN = 72;
const sheetMax = (): number => Math.round(window.innerHeight * 0.6);
const readStore = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};
const writeStore = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // localStorage may be blocked
  }
};

/**
 * Sticky action bar as a bottom sheet (the geo-tier-builder drawer idiom): a grip you can click or
 * drag opens the rest of the actions above the primary button, so the footer never reflows.
 */
function actionBar(primary: HTMLElement, secondary: HTMLElement[], sheet: HTMLElement[]): HTMLElement {
  // Nothing to open (the empty state has no row): no grip, no sheet.
  if (sheet.length === 0)
    return h(
      'footer',
      { class: 'panel__actions' },
      primary,
      h('div', { class: 'panel__secondary' }, ...secondary),
      panelFooter(),
    );
  const more = h('div', { class: 'panel__sheet', id: 'panel-sheet' }, ...sheet);
  const grip = h('button', {
    type: 'button',
    class: 'panel__handle',
    title: t('panelMoreTitle'),
    'aria-label': t('panelMoreAria'),
    'aria-expanded': 'false',
    'aria-controls': 'panel-sheet',
  }) as HTMLButtonElement;
  // An unlabelled 40px pill hid four outcomes and the only route to the editor (UX review).
  grip.append(h('span', { class: 'panel__grip' }), h('span', { class: 'panel__grip-caption' }, t('panelMoreCaption')));
  const bar = h(
    'footer',
    { class: 'panel__actions' },
    grip,
    more,
    primary,
    h('div', { class: 'panel__secondary' }, ...secondary),
    panelFooter(),
  );

  // Persist only on pointer-up: a drag that passes through the minimum on its way to "closed"
  // must not overwrite the size the user liked.
  const setHeight = (px: number, persist = false): void => {
    const clamped = Math.max(SHEET_MIN, Math.min(px, sheetMax()));
    bar.style.setProperty('--panel-sheet-h', `${clamped}px`);
    if (persist) writeStore(SHEET_H_KEY, String(clamped));
  };
  const setOpen = (open: boolean): void => {
    bar.classList.toggle('is-open', open);
    grip.setAttribute('aria-expanded', String(open));
    writeStore(SHEET_KEY, open ? '1' : '0');
  };
  // The remembered height, or as much as the content wants (capped at 60% of the panel).
  const stored = Number(readStore(SHEET_H_KEY));
  setHeight(stored > 0 ? stored : Math.min(more.scrollHeight || 260, sheetMax()));
  setOpen(readStore(SHEET_KEY) === '1');

  // Click toggles; dragging the grip resizes the sheet live, like the reference drawer — pulling it
  // down past the minimum closes it, pulling up from closed opens it.
  let dragged = false;
  grip.addEventListener('pointerdown', (e) => {
    const ev = e as PointerEvent;
    const startY = ev.clientY;
    const startH = bar.classList.contains('is-open') ? more.getBoundingClientRect().height : 0;
    dragged = false;
    ev.preventDefault();
    const move = (m: PointerEvent): void => {
      const delta = startY - m.clientY;
      if (!dragged && Math.abs(delta) < 4) return;
      dragged = true;
      bar.classList.add('is-dragging');
      const wanted = startH + delta;
      if (wanted < SHEET_MIN / 2) setOpen(false);
      else {
        setOpen(true);
        setHeight(wanted);
      }
    };
    const up = (): void => {
      bar.classList.remove('is-dragging');
      if (bar.classList.contains('is-open')) setHeight(more.getBoundingClientRect().height, true);
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', up);
    };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
  });
  grip.addEventListener('click', () => {
    if (dragged) {
      dragged = false; // the pointer gesture already decided
      return;
    }
    const open = !bar.classList.contains('is-open');
    // A drag that ended in "closed" left the live height shrunken; opening by click restores the
    // remembered size instead of showing a squashed sheet.
    if (open) setHeight(Number(readStore(SHEET_H_KEY)) || Math.min(more.scrollHeight || 260, sheetMax()));
    setOpen(open);
  });
  return bar;
}

void reload();
