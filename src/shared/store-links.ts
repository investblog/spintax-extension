/**
 * "Rate us" targets per store — the same idiom as redirect-inspector. URLs are empty until the
 * listing is published (step 16); an empty URL hides the link instead of pointing nowhere.
 * Fill them from the store dashboards after approval (docs/store/listing.md keeps the checklist).
 *
 * Edge is addressed by product id without the slug: the slug is derived from the name, which
 * contains an em dash, and a percent-encoded slug in a shipped URL is one rename away from a 404.
 */
export interface StoreInfo {
  url: string;
  icon: string;
  label: string;
}

const STORES: Record<string, StoreInfo> = {
  chrome: { url: '', icon: '/icons/chrome.svg', label: 'Chrome Web Store' },
  edge: {
    url: 'https://microsoftedge.microsoft.com/addons/detail/joddeoojfbefdpfbbhannlhofakamlld',
    icon: '/icons/edge.svg',
    label: 'Edge Add-ons',
  },
  firefox: { url: '', icon: '/icons/mozilla.svg', label: 'Firefox Add-ons' },
};

export function getStoreInfo(): StoreInfo | null {
  const info = STORES[import.meta.env.BROWSER] ?? null;
  return info?.url ? info : null;
}
