// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the recruitment ATS runtime detector. Probes
 * the muni main site — ATS hosts are linked from "lediga jobb" pages,
 * usually one click in from the global nav or footer.
 */
import runtime from "../../packages/core/src/detectors/job-platforms";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [`https://www.${muni.domain}`];
  },
};

export default detector;
