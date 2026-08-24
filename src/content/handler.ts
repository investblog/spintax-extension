/**
 * The fill helper's message handler — shared by the on-demand content script (injected into a
 * permitted page) and the bundled demo pages (which load it themselves, so no injection and no
 * host permission is needed there). Nothing runs until the panel sends a message (spec §4).
 */
import { browser } from 'wxt/browser';
import { cancelPick, docToken, fillAll, highlight, scanPage, startPick } from '@/content/dom';
import { t } from '@/shared/i18n';
import { CONTENT_SCRIPT_VERSION, type ContentRequest, type ContentResponse } from '@/shared/protocol';

export function installFillHandler(): void {
  const w = window as unknown as { __spintaxOutreachLoaded?: boolean };
  if (w.__spintaxOutreachLoaded) return;
  w.__spintaxOutreachLoaded = true;

  let lastScan = scanPage();

  browser.runtime.onMessage.addListener(
    (raw: unknown, _sender, sendResponse: (r: ContentResponse) => void): true | undefined => {
      const msg = raw as ContentRequest;
      try {
        switch (msg.type) {
          case 'ping':
            sendResponse({ ok: true, type: 'pong', version: CONTENT_SCRIPT_VERSION });
            return;
          case 'scan':
            lastScan = scanPage();
            sendResponse({ ok: true, type: 'scan', result: lastScan });
            return;
          case 'fill':
            if (msg.token && msg.token !== docToken()) {
              sendResponse({ ok: false, error: t('panelPageChanged') });
              return;
            }
            lastScan = scanPage();
            // Async: the fill waits a settle tick per field before read-back. `return true` keeps
            // the message channel open until sendResponse is called.
            fillAll(msg.items, lastScan.fields).then(
              (report) => sendResponse({ ok: true, type: 'fill', report }),
              (err: Error) => sendResponse({ ok: false, error: err.message }),
            );
            return true;
          case 'highlight':
            highlight(msg.fieldIds);
            sendResponse({ ok: true, type: 'highlight' });
            return;
          case 'pick':
            startPick((field) => {
              void browser.runtime.sendMessage({ type: 'picked', field });
            });
            sendResponse({ ok: true, type: 'pick', field: null });
            return;
          case 'cancelPick':
            cancelPick();
            sendResponse({ ok: true, type: 'cancelPick' });
            return;
          default:
            return; // a broadcast for another listener (data-changed, command…) — not ours
        }
      } catch (err) {
        sendResponse({ ok: false, error: (err as Error).message });
      }
      return undefined;
    },
  );
}
