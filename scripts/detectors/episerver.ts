// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the EpiServer / Optimizely runtime detector.
 * Probes the muni's main site.
 */
import runtime from "../../packages/core/src/detectors/episerver";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [`https://www.${muni.domain}`];
  },
};

export default detector;
