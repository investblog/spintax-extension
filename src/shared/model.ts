/**
 * Data model — mirrors docs/data-model.md (the contract). Change the doc first, then this file.
 */

export type RowId = string;
export type CampaignId = string;
export type ColumnId = string;
export type SeedKey = string;

export type Scenario = 'outreach' | 'submit';
export type WizardStep = 1 | 2 | 3 | 4 | 5 | 'done';

export type GrammaticalCase = 'nominative' | 'genitive' | 'dative' | 'accusative' | 'instrumental' | 'prepositional';

export interface ColumnDef {
  id: ColumnId;
  header: string;
  variable: string;
  role: 'none' | 'target' | 'key' | 'lang';
  type: 'text' | 'file';
  fillable: boolean;
  defaultValue?: string;
  required?: boolean;
  promptNote?: string;
  grammaticalCase?: GrammaticalCase;
  hidden?: boolean;
}

export interface ProfileValues {
  name: string;
  email: string;
  site?: string;
  phone?: string;
  intro?: string;
  signature?: string;
}

export type ProfileActivation =
  | { kind: 'always' }
  | { kind: 'urlPattern'; pattern: string }
  | { kind: 'column'; columnId: ColumnId; equals: string };

export interface Profile {
  id: string;
  name: string;
  values: ProfileValues;
  activation: ProfileActivation;
}

export interface StepDef {
  step: number;
  kind: 'initial' | 'followup';
  delayDays?: number;
}

export interface Campaign {
  id: CampaignId;
  schemaVersion: 1;
  name: string;
  scenario: Scenario;
  columns: ColumnDef[];
  profiles: Profile[];
  steps: StepDef[];
  defaultLocale: string;
  wizardStep: WizardStep;
  createdAt: string;
  updatedAt: string;
}

export type DeliveryStatus =
  | 'not_started'
  | 'filled_unconfirmed'
  | 'sent'
  | 'deferred'
  | 'not_sent'
  | 'not_applicable'
  | 'replied'
  | 'declined';
export type FailureReason = 'no_form' | 'captcha' | 'no_contact' | 'technical';
export type ReviewState = 'unreviewed' | 'approved' | 'edited' | 'skipped';
export type FollowupState = 'none' | 'due' | 'done' | 'stopped';
export type TargetKind = 'url' | 'email' | 'handle' | 'unknown';

export interface RowOverride {
  step: number;
  text: string;
  source: 'edit' | 'translate' | 'prompt';
}

export interface Row {
  rowId: RowId;
  campaignId: CampaignId;
  seedKey: SeedKey;
  target: string;
  targetKind: TargetKind;
  lang?: string;
  values: Record<ColumnId, string>;
  overrides?: Partial<Record<'subject' | 'body', RowOverride>>;
  deliveryStatus: DeliveryStatus;
  failureReason?: FailureReason;
  deferredUntil?: string;
  reviewState: ReviewState;
  followupState: FollowupState;
  followupDueAt?: string;
  currentStep: number;
  salt: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export type TemplateChannel = 'body' | 'subject';

export interface Template {
  id: string;
  campaignId: CampaignId;
  channel: TemplateChannel;
  step: number;
  locale: string;
  source: string;
  includes: Record<string, string>;
  engineVersion: string;
  promptVersion?: string;
  origin?: { promptId: string; version: string };
  validatedAt?: string;
  constructs?: Record<string, number>;
}

export type Slot =
  | 'profile.name'
  | 'profile.email'
  | 'profile.site'
  | 'profile.phone'
  | 'output.subject'
  | 'output.body'
  | `row.${string}`;

export interface FieldFingerprint {
  frame: string;
  tag: 'input' | 'textarea' | 'select' | 'contenteditable';
  type?: string;
  name?: string;
  id?: string;
  autocomplete?: string;
  label?: string;
  placeholder?: string;
  ariaLabel?: string;
  sameTypeIndex: number;
  maxLength?: number;
}

export type ConstraintLevel = 'warning' | 'blocking';

export type Constraint =
  | { kind: 'maxLength'; value: number; level: ConstraintLevel }
  | { kind: 'minLength'; value: number; level: ConstraintLevel }
  | { kind: 'maxTerms'; terms: number; perTerm: number; level: ConstraintLevel }
  | { kind: 'maxWords'; value: number; level: ConstraintLevel }
  | { kind: 'keywordRepeat'; max: number; level: ConstraintLevel }
  | { kind: 'imageSize'; width: number; height: number; level: ConstraintLevel }
  | { kind: 'mime'; allow: string[]; level: ConstraintLevel }
  | { kind: 'plainText'; level: ConstraintLevel }
  | { kind: 'markdown'; level: ConstraintLevel };

export type FillPolicy = 'skipIfFilled' | 'replace' | 'insertAtCursor';

export interface RecipeField {
  slot: Slot;
  fingerprint: FieldFingerprint;
  confidence: number;
  manual: boolean;
  fillPolicy: FillPolicy;
  format?: 'plain' | 'markdown';
  constraints: Constraint[];
}

export interface RecipeKey {
  origin: string;
  routePattern: string;
  formSignature: string;
  frame: string;
}

export interface Recipe {
  id: string;
  key: RecipeKey;
  fields: RecipeField[];
  version: number;
  source: 'heuristic' | 'ai' | 'manual' | 'imported';
  createdAt: string;
  updatedAt: string;
}

export type JournalEventKind =
  | 'filled'
  | 'sent'
  | 'failed'
  | 'deferred'
  | 'replied'
  | 'declined'
  | 'excluded'
  | 'edited'
  | 'reviewed'
  | 'translated'
  | 'corrected';

export type FillOutcome = 'exact' | 'equivalent' | 'changedBySite' | 'partial' | 'skippedNonEmpty' | 'clipboard';

export interface JournalEvent {
  id: string;
  rowId: RowId;
  /** Denormalized for range deletes and backup snapshots. */
  campaignId: CampaignId;
  step: number;
  event: JournalEventKind;
  reason?: FailureReason;
  seed: string;
  salt: number;
  engineVersion: string;
  subject?: string;
  body?: string;
  recipeId?: string;
  recipeVersion?: number;
  fillReport?: { slot: Slot; outcome: FillOutcome }[];
  ai?: {
    api: 'Translator' | 'LanguageModel' | 'Summarizer' | 'LanguageDetector';
    model?: string;
    promptVersion?: string;
  };
  source?: { promptId: string; version: string };
  correctsEventId?: string;
  /** For `deferred`: when the row comes back. */
  until?: string;
  /** For `reviewed`: the review verdict (default approved). */
  reviewState?: ReviewState;
  at: string;
  /** Strictly increasing per device (ms clock + tie-break) — ordering key; `at` is for display. */
  seq: number;
}

export interface Asset {
  sha256: string;
  name: string;
  mime: string;
  size: number;
  width?: number;
  height?: number;
  /** Stored as ArrayBuffer — structured-clonable in every IndexedDB (and in tests); see repo.assetBlob(). */
  bytes: ArrayBuffer;
  createdAt: string;
}

export interface Setting<T = unknown> {
  key: string;
  value: T;
}

export const SCHEMA_VERSION = 1 as const;
