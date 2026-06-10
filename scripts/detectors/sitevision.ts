// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the Sitevision runtime detector. Probes the
 * muni's main site (Sitevision is the dominant municipal CMS).
 */
import runtime from "../../packages/core/src/detectors/sitevision";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [`https://www.${muni.domain}`, `https://${muni.domain}`];
  },
};

export default detector;
