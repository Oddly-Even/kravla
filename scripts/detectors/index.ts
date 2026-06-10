// SPDX-License-Identifier: MIT
/**
 * Script-side detector registry. Each entry pairs a runtime detector
 * (from `src/lib/crawler/detectors/`) with a `candidateUrls(muni)`
 * function — discovery-only concern that doesn't apply on a live crawl.
 *
 * Adding a new platform:
 *   1. Write the runtime detector under `src/lib/crawler/detectors/<id>.ts`.
 *   2. Register it in `src/lib/crawler/detectors/index.ts`'s `DETECTORS`.
 *   3. Write the script wrapper here (`scripts/detectors/<id>.ts`) — usually
 *      just `{ ...runtime, candidateUrls: muni => [...] }`.
 *   4. Add it to the array below.
 */
import type { ScriptDetector } from "./types";
import openEplatform from "./open-eplatform";
import sitevision from "./sitevision";
import episerver from "./episerver";
import netpublicator from "./netpublicator";
import infracontrol from "./infracontrol";
import jobPlatforms from "./job-platforms";
import library from "./library";

export const detectors: ScriptDetector[] = [
  openEplatform,
  sitevision,
  episerver,
  netpublicator,
  infracontrol,
  jobPlatforms,
  library,
];

export const detectorIds = new Set(detectors.map((d) => d.id));
