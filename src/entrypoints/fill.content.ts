import { installFillHandler } from '@/content/handler';

/**
 * On-demand content script (registration: runtime) — injected by the panel after the user
 * grants the origin (ADR 0011 p.4). Nothing runs until the panel sends a message; the page
 * receives only the rendered strings (spec §4).
 */
export default defineContentScript({
  matches: [],
  registration: 'runtime',
  main() {
    installFillHandler();
  },
});
