// SPDX-License-Identifier: MIT
/**
 * Shared types for the municipal-service detection script.
 *
 * The script is a pre-crawl discovery tool: probes a list of URLs per
 * municipality, runs each runtime detector against the response, and
 * produces a roll-up report. New specialised-crawler / enricher
 * candidates fall out of:
 *   - Per-detector hit counts (how many munis run X?).
 *   - The meta-detector's fingerprint clusters (which unknown signatures
 *     repeat across many munis?).
 *
 * Detector LOGIC lives in `src/lib/crawler/detectors/` so the
 * crawl-runtime hook in `crawl-runner.ts` and this script see the same
 * matches. The script-only concerns are:
 *   - Which URLs to probe (`candidateUrls(muni)` per detector).
 *   - HTTP fetching with concurrency + timeout.
 *   - Fingerprint extraction for the meta-detector (the runtime doesn't
 *     yet persist fingerprints — only matches).
 */
import type { Municipality } from "../../packages/core/src/open-eplatform/municipalities";
import type { Detector as RuntimeDetector, DetectorMatch } from "../../packages/core/src/detectors";

/**
 * The result of fetching one candidate URL. `html` is the response body
 * when the response was 2xx HTML; for non-HTML / failure responses it
 * is the empty string and `error` carries the reason. Detectors still
 * get a chance to look at the status + headers even on failure (some
 * platforms only reveal themselves through redirects or 4xx error pages).
 */
export type Probe = {
  requestedUrl: string;
  finalUrl: string | null;
  status: number | null;
  headers: Record<string, string>;
  contentType: string | null;
  html: string;
  error: string | null;
};

export type DetectionHit = DetectorMatch & {
  probeUrl: string;
};

/**
 * Script-side detector — wraps a runtime detector with `candidateUrls`,
 * the discovery-only concern that doesn't apply on a live crawl
 * (Crawlee provides URLs via link traversal). Each `scripts/detectors/<id>.ts`
 * imports the runtime detector and adds this one method.
 */
export type ScriptDetector = RuntimeDetector & {
  candidateUrls(muni: Municipality): string[];
};

/**
 * What the runner accumulates per (muni, probeUrl). A page can match many
 * detectors at once (a Sitevision-rendered page that also iframes
 * Infracontrol), so `matches` is a list, not a single value.
 */
export type ProbeRecord = {
  municipalityName: string;
  probe: Probe;
  matches: DetectionHit[];
  fingerprints: Fingerprint[];
};

/**
 * A meta-detector "fingerprint" — one observable feature of a page that
 * might indicate a shared platform. Cheap to extract, regardless of whether
 * any specific detector matched. We group on `key` to find features that
 * repeat across many unmatched munis (= new platform candidate).
 */
export type Fingerprint = {
  kind:
    | "meta-generator"
    | "meta-application-name"
    | "header"
    | "script-host"
    | "stylesheet-host"
    | "iframe-host"
    | "outbound-link-host"
    | "html-comment"
    | "class-prefix"
    | "url-path-pattern"
    | "cookie-name";
  key: string;
  /** Optional sample evidence (e.g. the full attribute value). */
  sample?: string;
};
