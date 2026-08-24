/** One-line, human-readable description of a journal event (row drawer, journal screens). */
import { formatDay, type MessageKey, t } from './i18n';
import type { FailureReason, JournalEvent, ReviewState } from './model';

/** The stored event stays a code; only the word the user reads is a message key. */
const LABEL: Record<JournalEvent['event'], MessageKey> = {
  filled: 'jrnFilled',
  sent: 'jrnSent',
  failed: 'jrnFailed',
  deferred: 'jrnDeferred',
  replied: 'jrnReplied',
  declined: 'jrnDeclined',
  excluded: 'jrnExcluded',
  edited: 'jrnEdited',
  reviewed: 'jrnReviewed',
  translated: 'jrnTranslated',
  corrected: 'jrnCorrected',
};

const REASON_LABEL: Record<FailureReason, MessageKey> = {
  no_form: 'jrnReasonNoForm',
  captcha: 'jrnReasonCaptcha',
  no_contact: 'jrnReasonNoContact',
  technical: 'jrnReasonTechnical',
};

const REVIEW_LABEL: Record<ReviewState, MessageKey> = {
  unreviewed: 'jrnReviewUnreviewed',
  approved: 'jrnReviewApproved',
  edited: 'jrnReviewEdited',
  skipped: 'jrnReviewSkipped',
};

/* The journal shows dates in the UI language, like every other date in the app (ADR 0013):
   an ISO slice next to a Russian sentence reads as a leaked machine value. */
const day = (iso: string): string => formatDay(iso);

export function describeEvent(e: JournalEvent): string {
  const label = LABEL[e.event];
  const parts = [day(e.at), label ? t(label) : e.event];
  if (e.event === 'failed' && e.reason) parts.push(t(REASON_LABEL[e.reason]));
  if (e.event === 'deferred' && e.until) parts.push(t('jrnUntil', day(e.until)));
  if (e.event === 'reviewed' && e.reviewState) parts.push(t(REVIEW_LABEL[e.reviewState]));
  parts.push(t('jrnStep', String(e.step)));
  if (e.ai) parts.push(t('jrnAi', e.ai.api));
  return parts.join(' · ');
}
