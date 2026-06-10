// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the library catalog runtime detector. Probes
 * the muni main site (often links to bibliotek.*) plus a few
 * conventional library subdomains.
 */
import runtime from "../../packages/core/src/detectors/library";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [
      `https://www.${muni.domain}`,
      `https://bibliotek.${muni.domain}`,
      `https://biblioteket.${muni.domain}`,
    ];
  },
};

export default detector;
