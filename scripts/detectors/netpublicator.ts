// SPDX-License-Identifier: MIT
/**
 * Script-side wrapper for the Netpublicator runtime detector. Probes
 * the muni main site, common subdomain conventions, AND a few common
 * Swedish municipal politik-landing-page paths — meeting portals are
 * usually linked from there rather than the homepage. Most paths 404
 * on most munis (the runner returns null and moves on); the cost is
 * worth it for the coverage uplift on pre-crawl discovery.
 *
 * On a running CrawlSource this discovery layer isn't needed —
 * Crawlee's link traversal naturally reaches the politik pages and the
 * runtime detector picks them up.
 */
import runtime from "../../packages/core/src/detectors/netpublicator";
import type { ScriptDetector } from "./types";

const detector: ScriptDetector = {
  ...runtime,
  candidateUrls(muni) {
    if (!muni.domain) return [];
    return [
      `https://www.${muni.domain}`,
      `https://moten.${muni.domain}`,
      `https://protokoll.${muni.domain}`,
      `https://meetings.${muni.domain}`,
      `https://www.${muni.domain}/politik`,
      `https://www.${muni.domain}/kommun-och-politik`,
      `https://www.${muni.domain}/moten-och-protokoll`,
      `https://www.${muni.domain}/kommun-och-politik/moten-och-protokoll`,
      `https://www.${muni.domain}/politik-och-paverkan`,
    ];
  },
};

export default detector;
