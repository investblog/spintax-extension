import { browser } from 'wxt/browser';
import { setupNews } from '@/background/news';
import { extUrl } from '@/shared/ext-url';

// Side panel (Chromium) opens on toolbar-icon click; on Firefox the toolbar button opens the
// sidebar from the click gesture (sidebarAction.open requires a user action).
export default defineBackground(() => {
  const api = browser as unknown as {
    sidePanel?: { setPanelBehavior: (o: object) => Promise<void> };
    sidebarAction?: { open: () => Promise<void> };
    browserAction?: { onClicked: { addListener: (fn: () => void) => void } };
  };
  api.sidePanel?.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  if (api.sidebarAction && api.browserAction)
    api.browserAction.onClicked.addListener(() => {
      api.sidebarAction?.open().catch(() => {});
    });

  // Opt-in 301.sh news: alarm + notifications, nothing until the user turns it on (spec §15.6).
  setupNews();

  // First install: the welcome page (how it works, demo, privacy). Never on updates.
  browser.runtime.onInstalled.addListener(({ reason }) => {
    if (reason === 'install') void browser.tabs.create({ url: extUrl('/welcome.html') });
  });

  // Keyboard commands (spec §14.5) are relayed to the side panel, which owns the queue state.
  browser.commands.onCommand.addListener((command, tab) => {
    void browser.runtime
      .sendMessage({ type: 'command', command, tabId: tab?.id, windowId: tab?.windowId })
      .catch(() => {});
  });
});
