// SPDX-License-Identifier: MIT
import type { Logger } from "./logger";

/**
 * Product token used for robots.txt rule matching and as the base of every
 * outgoing User-Agent header (`<token>/sitemap-loader (+repo-url)` etc.).
 * Callers with established robots rules under another token override it
 * so existing site policies keep applying.
 */
export const DEFAULT_USER_AGENT = "kravla";

export const USER_AGENT_CONTACT_URL = "https://github.com/Oddly-Even/kravla";

/** Options accepted by every standalone helper (robots, sitemap, feed, …). */
export interface CrawlerRuntimeOptions {
  logger?: Logger;
  /** Product token for robots matching + User-Agent headers. Default `"kravla"`. */
  userAgent?: string;
}

/** `<token>/<facility> (+contact-url)` — the descriptive UA for HTTP fetches. */
export function buildUserAgent(token: string, facility: string): string {
  return `${token}/${facility} (+${USER_AGENT_CONTACT_URL})`;
}
