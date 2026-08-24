/**
 * E-mail targets: where "Open target" goes and what fits into the link (spec §8: mailto ≤ 2 000
 * characters; web compose links take more). The choice between "body in the link" and "body via
 * Fill/clipboard in the opened editor" is measured per row, not guessed: the rendered message has a
 * length, the provider has a limit.
 */
import { t } from './i18n';

export type MailProvider = 'mailto' | 'gmail' | 'outlook' | 'outlook365' | 'yandex' | 'custom';

export interface MailSettings {
  provider: MailProvider;
  /** Gmail account index in the URL (`/mail/u/N/`) when several accounts are signed in. */
  gmailAccount: number;
  /** Copy every message to yourself — a record in your own mailbox. */
  bcc: string;
  /** `custom`: `%to%`, `%subject%`, `%body%`, `%bcc%` placeholders. */
  customTemplate: string;
}

export const MAIL_DEFAULTS: MailSettings = { provider: 'mailto', gmailAccount: 0, bcc: '', customTemplate: '' };
export const MAIL_SETTINGS_KEY = 'mail';

/** Where a site target opens: reuse the tab the panel is working with, or always a new one. */
export type OpenTargetIn = 'current' | 'new';
export const OPEN_TARGET_KEY = 'openTargetIn';
export const OPEN_TARGET_DEFAULT: OpenTargetIn = 'current';

export interface ProviderInfo {
  id: MailProvider;
  label: string;
  hint: string;
  /** Longest URL the provider's compose page reliably accepts with the body inside. */
  urlLimit: number;
  /** Origin of the compose page (the panel treats that tab as "on target"); none for mailto. */
  origin?: string;
}

/** Caption and hint resolve on read: the link builder (and its tests) never draw them, so importing
 *  the provider table costs no message lookup. */
export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'mailto',
    get label() {
      return t('mailMailto');
    },
    get hint() {
      return t('mailMailtoHint');
    },
    urlLimit: 2000,
  },
  {
    id: 'gmail',
    get label() {
      return t('mailGmail');
    },
    get hint() {
      return t('mailGmailHint');
    },
    urlLimit: 8000,
    origin: 'https://mail.google.com',
  },
  {
    id: 'outlook',
    get label() {
      return t('mailOutlook');
    },
    get hint() {
      return t('mailOutlookHint');
    },
    urlLimit: 4000,
    origin: 'https://outlook.live.com',
  },
  {
    id: 'outlook365',
    get label() {
      return t('mailOutlook365');
    },
    get hint() {
      return t('mailOutlook365Hint');
    },
    urlLimit: 4000,
    origin: 'https://outlook.office.com',
  },
  {
    id: 'yandex',
    get label() {
      return t('mailYandex');
    },
    get hint() {
      return t('mailYandexHint');
    },
    urlLimit: 4000,
    origin: 'https://mail.yandex.ru',
  },
  {
    id: 'custom',
    get label() {
      return t('mailCustom');
    },
    get hint() {
      return t('mailCustomHint');
    },
    urlLimit: 8000,
  },
];

export const providerInfo = (id: MailProvider): ProviderInfo =>
  PROVIDERS.find((p) => p.id === id) ?? (PROVIDERS[0] as ProviderInfo);

export interface ComposeInput {
  to: string;
  subject: string;
  body: string;
}

export interface ComposeLink {
  url: string;
  /** false → the link carries to/subject(/bcc) only; paste or Fill the body in the editor. */
  bodyIncluded: boolean;
  /** The provider's web origin (undefined for mailto). */
  origin?: string;
}

function build(settings: MailSettings, input: ComposeInput, withBody: boolean): string {
  const enc = encodeURIComponent;
  const body = withBody ? input.body : '';
  const bcc = settings.bcc.trim();
  switch (settings.provider) {
    case 'gmail': {
      const q = new URLSearchParams({ view: 'cm', fs: '1', to: input.to, su: input.subject });
      if (bcc) q.set('bcc', bcc);
      if (withBody) q.set('body', body);
      return `https://mail.google.com/mail/u/${settings.gmailAccount}/?${q.toString()}`;
    }
    case 'outlook':
    case 'outlook365': {
      const host = settings.provider === 'outlook' ? 'outlook.live.com' : 'outlook.office.com';
      const q = new URLSearchParams({ to: input.to, subject: input.subject });
      if (bcc) q.set('bcc', bcc);
      if (withBody) q.set('body', body);
      return `https://${host}/mail/0/deeplink/compose?${q.toString()}`;
    }
    case 'yandex': {
      const q = new URLSearchParams({ to: input.to, subject: input.subject });
      if (bcc) q.set('bcc', bcc);
      if (withBody) q.set('body', body);
      return `https://mail.yandex.ru/compose?${q.toString()}`;
    }
    case 'custom': {
      const tpl = settings.customTemplate.trim();
      return tpl
        .replace(/%to%/g, enc(input.to))
        .replace(/%subject%/g, enc(input.subject))
        .replace(/%body%/g, enc(body))
        .replace(/%bcc%/g, enc(bcc));
    }
    default: {
      const parts = [`subject=${enc(input.subject)}`];
      if (bcc) parts.push(`bcc=${enc(bcc)}`);
      if (withBody) parts.push(`body=${enc(body)}`);
      return `mailto:${input.to}?${parts.join('&')}`;
    }
  }
}

/** The link for this message: with the body when it fits the provider's limit, otherwise without. */
export function composeLink(settings: MailSettings, input: ComposeInput): ComposeLink {
  const info = providerInfo(settings.provider);
  const origin = settings.provider === 'custom' ? customOrigin(settings.customTemplate) : info.origin;
  const full = build(settings, input, true);
  if (full.length <= info.urlLimit) return { url: full, bodyIncluded: true, origin };
  return { url: build(settings, input, false), bodyIncluded: false, origin };
}

function customOrigin(template: string): string | undefined {
  try {
    return new URL(template.replace(/%[a-z]+%/g, 'x')).origin;
  } catch {
    return undefined;
  }
}

/** How long a message can be and still travel inside the link, for the settings screen. */
export function bodyBudget(settings: MailSettings, sample: ComposeInput): number {
  const info = providerInfo(settings.provider);
  const overhead = build(settings, { ...sample, body: '' }, true).length;
  // URL-encoding inflates Cyrillic ~6× and spaces 3×; report a conservative plain-text budget.
  const encodedPerChar = sample.body.length > 0 ? encodeURIComponent(sample.body).length / sample.body.length : 3;
  return Math.max(0, Math.floor((info.urlLimit - overhead) / Math.max(1, encodedPerChar)));
}
