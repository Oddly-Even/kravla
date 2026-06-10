// SPDX-License-Identifier: MIT
/**
 * Adapter that exposes the Open ePlatform runner under the streaming
 * `runCrawl(input) → CrawlOutcome` contract `processCrawlRun` now expects.
 *
 * Upstream restructured the crawl pipeline so the generic `runCrawl` calls
 * `input.onPage` for every fetched page and returns counts only. The Open
 * ePlatform runner still produces an `{ ok, failed }` array (the portal is
 * one big HTML doc — there is no streaming on the wire). This adapter
 * bridges the two: it runs the eplatform fetch+parse, then fans each
 * resulting page through `onPage` / each failure through `onFailed`, and
 * returns the counts the dispatcher expects.
 *
 * Cache hints, sitemap URLs, skip lists, and rate limits in `CrawlRunnerInput`
 * are ignored — the eplatform path doesn't honor conditional GETs (the
 * catalog HTML is replaced wholesale each refresh; the content-hash
 * short-circuit downstream still suppresses re-embedding when nothing
 * changed).
 */
import type { CrawlOutcome, CrawlRunnerInput } from "../crawl-runner";
import { findMunicipalityByName, listMunicipalities } from "./municipalities";
import { runOpenEplatformCrawl } from "./runner";

/**
 * For an Open ePlatform source URL like `https://sjalvservice.sundsvall.se`,
 * derive the municipality display name ("Sundsvall") by looking up the
 * eTLD+1 (`sundsvall.se`) in the static SKL registry. Falls back to a name
 * lookup on the leading subdomain so portals on personalised hostnames
 * still get a sensible value rather than null.
 */
export function guessMunicipalityName(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }

  // Walk from the most specific subdomain down to the bare eTLD+1, trying
  // each as a `domain` match. Municipalities the registry knows about
  // always have `domain` set; the leading-subdomain fallback covers the rest.
  const labels = hostname.split(".");
  const candidates: string[] = [];
  for (let i = 0; i < labels.length - 1; i++) {
    candidates.push(labels.slice(i).join("."));
  }

  const all = listMunicipalities();
  for (const cand of candidates) {
    const hit = all.find((m) => m.domain && m.domain.toLowerCase() === cand);
    if (hit) return hit.name;
  }

  const leading = labels[0];
  if (leading) {
    const byName = findMunicipalityByName(leading);
    if (byName) return byName.name;
  }
  return null;
}

export async function runOpenEplatformAsStreaming(input: CrawlRunnerInput): Promise<CrawlOutcome> {
  let okCount = 0;
  let failedCount = 0;

  if (input.signal?.aborted) {
    return {
      okCount: 0,
      unchangedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      skippedRobotsCount: 0,
      robotsBlockedSeed: false,
      skippedByContentType: 0,
    };
  }

  const result = await runOpenEplatformCrawl({
    seedUrl: input.seedUrl,
    municipalityName: guessMunicipalityName(input.seedUrl),
    logger: input.logger,
    userAgent: input.userAgent,
  });

  for (const p of result.ok) {
    if (input.signal?.aborted) break;
    await input.onPage?.(p);
    okCount += 1;
  }
  for (const f of result.failed) {
    if (input.signal?.aborted) break;
    await input.onFailed?.(f);
    failedCount += 1;
  }

  return {
    okCount,
    unchangedCount: 0,
    failedCount,
    skippedCount: 0,
    skippedRobotsCount: 0,
    robotsBlockedSeed: false,
    skippedByContentType: 0,
  };
}
