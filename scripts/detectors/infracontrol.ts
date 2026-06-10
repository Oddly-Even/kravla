// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the Infracontrol runtime detector. Probes
 * the conventional felanmälan / tycktill subdomains.
 */
import runtime from "../../packages/core/src/detectors/infracontrol";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [
      `https://felanmalan.${muni.domain}`,
      `https://felanmalan2.${muni.domain}`,
      `https://tycktill.${muni.domain}`,
      `https://tyck-till.${muni.domain}`,
    ];
  },
};

export default detector;
