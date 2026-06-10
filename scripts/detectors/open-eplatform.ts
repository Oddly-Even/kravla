// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the Open ePlatform runtime detector. Adds
 * `candidateUrls` — the discovery-only step: try the muni's already-
 * verified portals first (from `swedish-municipalities.json`), else the
 * four most-common Open ePlatform subdomain prefixes (stellan's
 * frequency-ordered list).
 */
import runtime from "../../packages/core/src/detectors/open-eplatform";
import type { ScriptDetector } from "./types";

const SUBDOMAINS = ["sjalvservice", "e-tjanster", "minasidor", "etjanster"];

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (muni.verifiedPortals.length > 0) return muni.verifiedPortals;
    if (!muni.domain) return [];
    return SUBDOMAINS.map((s) => `https://${s}.${muni.domain}`);
  },
};

export default detector;
