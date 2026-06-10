// SPDX-License-Identifier: MIT
/**
 * Path-scope helpers shared between the live crawler and the dry-run preview.
 *
 * Seed-prefix scope: a CrawlSource seeded at `https://host/upplev` covers
 * only URLs whose pathname is exactly `/upplev` or starts with `/upplev/`
 * (and matches the same hostname). To ingest a full site, seed with the
 * root path.
 *
 * Two consumer shapes:
 *  - `pathPrefixGlobs(seedUrl)` — globs for Crawlee's `enqueueLinks` to
 *    filter discovered links at parse time.
 *  - `isInSeedScope(seedUrl, candidate)` — predicate used by sitemap-mode
 *    crawls to filter `Sitemap.load()` results before queueing them.
 */

export function isInSeedScope(seedUrl: string, candidateUrl: string): boolean {
  let seed: URL;
  let candidate: URL;
  try {
    seed = new URL(seedUrl);
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (seed.hostname !== candidate.hostname) return false;

  const seedPath = normalizePath(seed.pathname);
  const candidatePath = normalizePath(candidate.pathname);

  // Root-of-site seed → no path restriction (all same-hostname matches).
  if (seedPath === "") return true;

  // Exact match OR descends into the seed's subtree.
  return candidatePath === seedPath || candidatePath.startsWith(seedPath + "/");
}

export function pathPrefixGlobs(seedUrl: string): string[] {
  const u = new URL(seedUrl);
  const path = normalizePath(u.pathname);
  if (path === "") {
    return [`${u.origin}/**`];
  }
  return [
    `${u.origin}${path}`,
    `${u.origin}${path}/**`,
    `${u.origin}${path}?**`,
    `${u.origin}${path}#**`,
  ];
}

function normalizePath(path: string): string {
  // Strip trailing slash(es), but preserve the leading slash. Empty path
  // after normalization means "root of site".
  return path.replace(/\/+$/, "");
}
