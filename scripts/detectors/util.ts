// SPDX-License-Identifier: MIT
/**
 * Shared probe + fingerprint utilities.
 *
 * `fetchProbe` is the single network primitive the runner uses — keeps
 * timeout, UA, and redirect handling consistent across every detector. The
 * function never throws; all failures land in `probe.error` so the report
 * still records that we tried.
 *
 * `extractFingerprints` is the meta-detector's feature extractor. It runs on
 * every successful HTML response (independent of whether any named detector
 * matched), so the report can surface unknown-but-shared signatures.
 */
import * as cheerio from "cheerio";
import type { Fingerprint, Probe } from "./types";

const DEFAULT_TIMEOUT_MS = 12_000;
const USER_AGENT = "ladan/municipal-service-detector (+https://github.com/Oddly-Even/ladan)";

export async function fetchProbe(url: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Probe> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ac.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml,*/*;q=0.5" },
      redirect: "follow",
    });
    const headers = Object.fromEntries(res.headers.entries());
    const ct = res.headers.get("content-type");
    const isHtml = (ct ?? "").toLowerCase().includes("html");
    const html = isHtml ? await res.text() : "";
    return {
      requestedUrl: url,
      finalUrl: res.url || url,
      status: res.status,
      headers,
      contentType: ct,
      html,
      error: !res.ok ? `HTTP ${res.status}` : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isTimeout =
      err instanceof Error && (err.name === "AbortError" || /timeout/i.test(message));
    return {
      requestedUrl: url,
      finalUrl: null,
      status: null,
      headers: {},
      contentType: null,
      html: "",
      error: isTimeout ? "timeout" : message,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Strip "<base>." from a hostname so `web.netpublicator.com` and
 * `documents.netpublicator.com` collide on the same key — what we care
 * about for clustering is the vendor, not the subdomain. Two-label TLDs
 * (`.co.uk`) aren't worth special-casing here; municipalities are .se.
 */
function hostKey(hostname: string): string {
  const labels = hostname.toLowerCase().split(".");
  if (labels.length <= 2) return labels.join(".");
  return labels.slice(-2).join(".");
}

/**
 * Same-site check that tolerates the `www.` prefix on either side. Used to
 * decide whether a script/link host counts as "third-party" (= interesting
 * fingerprint) or "first-party" (= noise).
 */
function sameSite(pageHost: string, otherHost: string): boolean {
  const a = pageHost.replace(/^www\./, "").toLowerCase();
  const b = otherHost.replace(/^www\./, "").toLowerCase();
  if (a === b) return true;
  return hostKey(a) === hostKey(b);
}

function safeHost(maybeUrl: string, baseUrl: string): string | null {
  try {
    return new URL(maybeUrl, baseUrl).hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

const INTERESTING_HEADERS = [
  "server",
  "x-powered-by",
  "x-generator",
  "x-aspnet-version",
  "x-drupal-cache",
  "x-cms",
  "x-magento-cache-debug",
  "x-varnish",
  "via",
];

/**
 * Common CDN / cookie-banner / analytics hosts. Stripping these keeps the
 * meta-detector report focused on platform-relevant third parties instead
 * of every Cloudflare-fronted site looking identical.
 */
const NOISY_HOSTS = new Set([
  "cookiebot.com",
  "cookieinformation.com",
  "googletagmanager.com",
  "google-analytics.com",
  "google.com",
  "gstatic.com",
  "googleapis.com",
  "doubleclick.net",
  "youtube.com",
  "vimeo.com",
  "facebook.net",
  "facebook.com",
  "linkedin.com",
  "twitter.com",
  "fonts.googleapis.com",
  "cloudflare.com",
  "jsdelivr.net",
  "unpkg.com",
  "bootstrapcdn.com",
  "fontawesome.com",
  "siteimproveanalytics.com",
  "matomo.cloud",
  "addtoany.com",
  "cdninstagram.com",
  "azureedge.net",
]);

export function extractFingerprints(probe: Probe): Fingerprint[] {
  if (!probe.html) {
    // We still surface headers — some platforms (e.g. EpiServer behind IIS)
    // are most visible through `x-powered-by`, even on a 404 or redirect.
    return headerFingerprints(probe);
  }

  const out: Fingerprint[] = [...headerFingerprints(probe)];
  let $: cheerio.CheerioAPI;
  try {
    $ = cheerio.load(probe.html);
  } catch {
    return out;
  }

  const base = probe.finalUrl ?? probe.requestedUrl;
  let pageHost: string;
  try {
    pageHost = new URL(base).hostname.toLowerCase();
  } catch {
    pageHost = "";
  }

  const gen = ($('meta[name="generator"]').attr("content") ?? "").trim();
  if (gen) out.push({ kind: "meta-generator", key: gen.toLowerCase(), sample: gen });

  const appName = ($('meta[name="application-name"]').attr("content") ?? "").trim();
  if (appName)
    out.push({ kind: "meta-application-name", key: appName.toLowerCase(), sample: appName });

  const seenHosts = new Map<Fingerprint["kind"], Set<string>>();
  const push = (kind: Fingerprint["kind"], host: string, sample: string) => {
    const set = seenHosts.get(kind) ?? new Set<string>();
    if (set.has(host)) return;
    set.add(host);
    seenHosts.set(kind, set);
    const key = hostKey(host);
    if (NOISY_HOSTS.has(key)) return;
    if (pageHost && sameSite(pageHost, host)) return;
    out.push({ kind, key, sample });
  };

  $("script[src]").each((_, el) => {
    const src = ($(el).attr("src") ?? "").trim();
    const host = safeHost(src, base);
    if (host) push("script-host", host, src);
  });
  $('link[rel="stylesheet"][href]').each((_, el) => {
    const href = ($(el).attr("href") ?? "").trim();
    const host = safeHost(href, base);
    if (host) push("stylesheet-host", host, href);
  });
  $("iframe[src]").each((_, el) => {
    const src = ($(el).attr("src") ?? "").trim();
    const host = safeHost(src, base);
    if (host) push("iframe-host", host, src);
  });
  // Outbound anchors are noisy in volume — cap so a page with 400 links
  // doesn't flood the fingerprint table. The first ~80 anchors are usually
  // enough to catch nav + footer references to vendor portals.
  let anchorCount = 0;
  $("a[href]").each((_, el) => {
    if (anchorCount >= 80) return;
    anchorCount++;
    const href = ($(el).attr("href") ?? "").trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:"))
      return;
    const host = safeHost(href, base);
    if (host) push("outbound-link-host", host, href);
  });

  // HTML comments often carry "powered by" markers in older CMS templates.
  // Cheerio doesn't expose comments through the standard selectors; grep the
  // raw HTML for the few markers that have ever been useful in practice.
  const commentMatches = probe.html.match(/<!--[^]*?-->/g) ?? [];
  for (const c of commentMatches.slice(0, 50)) {
    const lc = c.toLowerCase();
    if (
      lc.includes("powered by") ||
      lc.includes("generated by") ||
      lc.includes("sitevision") ||
      lc.includes("episerver") ||
      lc.includes("optimizely") ||
      lc.includes("drupal") ||
      lc.includes("wordpress")
    ) {
      const trimmed = c.replace(/\s+/g, " ").slice(0, 200);
      out.push({ kind: "html-comment", key: trimmed.toLowerCase(), sample: trimmed });
    }
  }

  // Top-N class prefixes — Sitevision (`sv-*-portlet`), Drupal (`field--*`),
  // Bootstrap (`col-`), etc. Useful for the meta-detector to spot families
  // we haven't named yet. We only emit the prefix as a fingerprint when it
  // appears at least 5 times on the page (filters out one-off ids).
  const prefixCounts = new Map<string, number>();
  $("[class]").each((_, el) => {
    const classes = ($(el).attr("class") ?? "").split(/\s+/);
    for (const c of classes) {
      const dash = c.indexOf("-");
      if (dash <= 1) continue;
      const prefix = c.slice(0, dash);
      if (prefix.length < 2 || prefix.length > 12) continue;
      prefixCounts.set(prefix, (prefixCounts.get(prefix) ?? 0) + 1);
    }
  });
  for (const [prefix, count] of prefixCounts) {
    if (count >= 5) {
      out.push({
        kind: "class-prefix",
        key: prefix.toLowerCase(),
        sample: `${count}× .${prefix}-…`,
      });
    }
  }

  // URL-path-pattern signals — Sitevision's `/4.<digits>.html`, EpiServer's
  // `/util/login.aspx` etc. We look at the final URL after redirects.
  if (base) {
    try {
      const path = new URL(base).pathname;
      if (/^\/\d+\.\d+\.html$/i.test(path) || /^\/\d+(\.\d+)+\b/.test(path)) {
        out.push({ kind: "url-path-pattern", key: "sitevision-numeric-id", sample: path });
      }
      if (/\.aspx$/i.test(path)) {
        out.push({ kind: "url-path-pattern", key: "aspx", sample: path });
      }
    } catch {
      /* ignore */
    }
  }

  return out;
}

function headerFingerprints(probe: Probe): Fingerprint[] {
  const out: Fingerprint[] = [];
  for (const name of INTERESTING_HEADERS) {
    const v = probe.headers[name];
    if (!v) continue;
    out.push({ kind: "header", key: `${name}: ${v.toLowerCase().slice(0, 80)}`, sample: v });
  }
  const setCookie = probe.headers["set-cookie"];
  if (setCookie) {
    // Bun normalises set-cookie to a single comma-joined string. We want the
    // cookie NAME (first token of each individual Set-Cookie), so we have to
    // split per-cookie and skip standard RFC 6265 attribute keys that follow
    // the name. A naive `/[,;]\s*([A-Za-z0-9_.\-]+)=/g` swept those up too
    // and the meta report ended up flooded with `path`/`domain`/`expires`.
    const cookieStrings = setCookie.split(/,(?=\s*[A-Za-z0-9_.\-]+=)/);
    const seen = new Set<string>();
    for (const cookie of cookieStrings) {
      const m = cookie.trim().match(/^([A-Za-z0-9_.\-]+)=/);
      if (!m) continue;
      const name = m[1]!;
      const lc = name.toLowerCase();
      if (seen.has(lc)) continue;
      seen.add(lc);
      if (COOKIE_ATTRIBUTES.has(lc)) continue;
      if (/^(PHPSESSID|JSESSIONID|ASP\.NET_SessionId|session|sid|csrf|XSRF-TOKEN)$/i.test(name))
        continue;
      out.push({ kind: "cookie-name", key: lc, sample: name });
    }
  }
  return out;
}

// Reserved keys defined by RFC 6265 — these are not cookie names, they're
// attributes that follow the name=value pair (`Path=/`, `Domain=...`, etc.).
const COOKIE_ATTRIBUTES = new Set([
  "path",
  "domain",
  "expires",
  "max-age",
  "samesite",
  "secure",
  "httponly",
  "priority",
  "partitioned",
]);

/**
 * Bounded concurrency worker pool — same shape as the one in
 * `update-swedish-municipalities.ts`. Kept inline to avoid a shared util
 * dependency just for this script.
 */
export async function withPool<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = cursor++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx]!, idx);
    }
  });
  await Promise.all(runners);
  return results;
}
