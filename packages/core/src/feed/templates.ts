// SPDX-License-Identifier: MIT
/**
 * Curated registry of known feed providers, so an operator can pick a feed
 * from a list instead of pasting an RSS URL — the feed analogue of the Open
 * ePlatform municipality registry. The add-source dialog imports this
 * directly (it is pure data + string matching, no server-only deps).
 *
 * Only verified, working feed URLs are listed. To add one:
 *   1. Confirm the URL returns RSS/Atom (the feed runner parses RSS 2.0,
 *      RSS 1.0, and Atom).
 *   2. Append a `FeedTemplate` row below. `label`/`description` are content
 *      (source names, not UI chrome) and are intentionally not translated.
 *
 * Riksdagen's document API serves any document-list query as RSS with
 * `&utformat=rss`; one row per `doktyp` keeps the picker flat. SKR's only
 * public feed (pressmeddelanden) is exposed via an opaque SiteVision portlet
 * URL — instead of pinning that brittle id, the SKR row points at the site
 * root and the runner resolves the feed via `<link rel="alternate">`
 * autodiscovery (see `discover.ts`). A `feedUrl` may therefore be either a
 * feed URL (Riksdagen) or a page URL that autodiscovers one (SKR).
 */

export type FeedTemplate = {
  /** Stable id, used as the combobox key. */
  id: string;
  /** Grouping label shown to the operator (e.g. "Riksdagen", "SKR"). */
  provider: string;
  /** Display name; also used as the friendly source name on create. */
  label: string;
  /** One-line description of what the feed carries. */
  description: string;
  /**
   * The RSS/Atom feed URL, or a page URL whose `<link rel="alternate">`
   * autodiscovers one (resolved at fetch time by the feed runner).
   */
  feedUrl: string;
};

/**
 * Build a Riksdagen document-list RSS URL for a `doktyp` code. `sz` overrides
 * the API's default page size of 20 — a larger window gives a real initial
 * backfill and headroom between polls (entries accumulate, never pruned). 200
 * is the upper bound we fetch in one request; we don't paginate.
 */
function riksdagen(doktyp: string): string {
  return `https://data.riksdagen.se/dokumentlista/?doktyp=${doktyp}&sort=datum&sortorder=desc&utformat=rss&sz=200`;
}

export const FEED_TEMPLATES: readonly FeedTemplate[] = [
  {
    id: "riksdagen-sfs",
    provider: "Riksdagen",
    label: "Riksdagen – Författningar (SFS)",
    description: "Lagar och förordningar i Svensk författningssamling, senaste först.",
    feedUrl: riksdagen("sfs"),
  },
  {
    id: "riksdagen-prop",
    provider: "Riksdagen",
    label: "Riksdagen – Propositioner",
    description: "Regeringens propositioner till riksdagen.",
    feedUrl: riksdagen("prop"),
  },
  {
    id: "riksdagen-bet",
    provider: "Riksdagen",
    label: "Riksdagen – Betänkanden",
    description: "Utskottens betänkanden.",
    feedUrl: riksdagen("bet"),
  },
  {
    id: "riksdagen-mot",
    provider: "Riksdagen",
    label: "Riksdagen – Motioner",
    description: "Motioner från riksdagens ledamöter.",
    feedUrl: riksdagen("mot"),
  },
  {
    id: "riksdagen-rskr",
    provider: "Riksdagen",
    label: "Riksdagen – Riksdagsskrivelser",
    description: "Riksdagens skrivelser till regeringen.",
    feedUrl: riksdagen("rskr"),
  },
  {
    id: "riksdagen-sou",
    provider: "Riksdagen",
    label: "Riksdagen – Statens offentliga utredningar (SOU)",
    description: "Betänkanden i serien Statens offentliga utredningar.",
    feedUrl: riksdagen("sou"),
  },
  {
    id: "riksdagen-ds",
    provider: "Riksdagen",
    label: "Riksdagen – Departementsserien (Ds)",
    description: "Utredningar och förslag i departementsserien.",
    feedUrl: riksdagen("ds"),
  },
  {
    id: "riksdagen-kom",
    provider: "Riksdagen",
    label: "Riksdagen – EU-förslag (KOM)",
    description: "EU-kommissionens förslag (KOM-dokument).",
    feedUrl: riksdagen("kom"),
  },
  {
    id: "skr-press",
    provider: "SKR",
    label: "SKR – Pressmeddelanden och debattartiklar",
    description:
      "Pressmeddelanden och debattartiklar från Sveriges Kommuner och Regioner (SKR:s enda publika RSS-flöde, hittas via autoupptäckt från skr.se).",
    // Page URL, not a feed URL: the runner autodiscovers SKR's feed from the
    // site root, so we don't pin the opaque SiteVision portlet id.
    feedUrl: "https://skr.se/",
  },
];

export function listFeedTemplates(): FeedTemplate[] {
  return [...FEED_TEMPLATES];
}

/** Normalize a URL for equality: lowercased host, no trailing slash on path. */
function normalizeUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    u.hostname = u.hostname.toLowerCase();
    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Match a pasted feed URL back to a template so the picker stays in sync when
 * the operator types a known URL directly. Returns null on no match.
 */
export function findFeedTemplateByUrl(url: string): FeedTemplate | null {
  const target = normalizeUrl(url);
  if (!target) return null;
  return FEED_TEMPLATES.find((t) => normalizeUrl(t.feedUrl) === target) ?? null;
}
