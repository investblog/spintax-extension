import { browser } from 'wxt/browser';

/**
 * Open the side panel (Chromium) or the sidebar (Firefox) from an extension page.
 *
 * Both APIs require a user gesture, so this must be called straight from a click handler. It lived
 * inline in wizard step 5, which is the only place that offered it — and the demo path never goes
 * there, leaving the product's main surface unreachable (UX review). Now any screen can offer it.
 */
export async function openSidePanel(): Promise<void> {
  const api = browser as unknown as {
    sidePanel?: { open: (o: { windowId: number }) => Promise<void> };
    sidebarAction?: { open: () => Promise<void> };
  };
  try {
    if (api.sidePanel) {
      const w = await browser.windows.getCurrent();
      if (w.id !== undefined) await api.sidePanel.open({ windowId: w.id });
    } else await api.sidebarAction?.open();
  } catch {
    // No gesture context (or the call raced a navigation) — the toolbar button still opens it.
  }
}
