import { browser } from 'wxt/browser';

/** runtime.getURL for paths WXT's generated PublicPath type cannot express (template strings, folders). */
export const extUrl = (path: string): string => (browser.runtime.getURL as (p: string) => string)(path);
