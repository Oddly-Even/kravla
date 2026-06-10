// SPDX-License-Identifier: MIT
/**
 * Meta-detector — finds platform candidates we haven't written a named
 * detector for, by rolling up fingerprint frequency across municipalities.
 *
 * Inputs: per-(muni, probeUrl) `Fingerprint[]` from `extractFingerprints`,
 * plus the set of detector ids that already matched that page.
 *
 * Two outputs:
 *
 *   1. `unidentifiedFingerprints` — every fingerprint key that appears on
 *      >= `minMuniSupport` distinct munis. For each, we include:
 *        - `totalMunis`: how many munis carry this fingerprint.
 *        - `unmatchedMunis`: of those, how many had ZERO detector matches.
 *        - `coOccursWithDetectors`: which known detectors fired on the
 *          same muni elsewhere — high overlap with one detector = the
 *          fingerprint is probably part of that platform's footprint
 *          (= safe to ignore). Low overlap = candidate new platform.
 *
 *      We deliberately do NOT auto-suppress fingerprints that co-occur
 *      with a known detector; the reviewer can read the numbers and
 *      decide. (Earlier iteration auto-suppressed and erased every
 *      genuine candidate because Sitevision matches half the corpus.)
 *
 *   2. `cooccurrenceClusters` — exact-set clustering: munis with the same
 *      bundle of unidentified fingerprints group together. A cluster of N
 *      munis sharing 5 fingerprints is N munis running the same unknown
 *      platform — pick one example URL, write a detector, all N flip
 *      green on the next scan. Restricted to munis with zero current
 *      detector matches so clusters are genuinely about new platforms,
 *      not subsets of an existing one's signature.
 */
import type { Fingerprint, ProbeRecord } from "./types";

export type FingerprintRollup = {
  kind: Fingerprint["kind"];
  key: string;
  totalMunis: number;
  unmatchedMunis: number;
  /** Cap at ~10 samples so the JSON doesn't bloat. */
  sampleMunicipalities: string[];
  exampleUrl: string;
  exampleValue: string | undefined;
  /** Detectors that ever fired on a muni carrying this fingerprint, with counts. */
  coOccursWithDetectors: { detectorId: string; muniCount: number }[];
};

export type UnidentifiedCluster = {
  /** Stable id derived from the sorted feature list — useful when re-running. */
  signature: string;
  size: number;
  municipalities: string[];
  /** The fingerprints that defined the cluster, in descending support order. */
  sharedFingerprints: { kind: string; key: string; support: number }[];
  exampleUrl: string;
};

export type MetaReport = {
  unidentifiedFingerprints: FingerprintRollup[];
  cooccurrenceClusters: UnidentifiedCluster[];
};

type RollupOptions = {
  /** Minimum distinct municipalities that must share a fingerprint to surface. */
  minMuniSupport: number;
  /** Skip fingerprint kinds that we know aren't useful (e.g. class prefixes blow up the table). */
  excludeKinds: ReadonlySet<Fingerprint["kind"]>;
  /** Used when filtering "unidentified" rollups — fingerprints co-occurring with these are not novel. */
  knownDetectorIds: ReadonlySet<string>;
};

export function buildMetaReport(records: ProbeRecord[], opts: RollupOptions): MetaReport {
  // Roll the muni's detector matches up across all of its probes — a
  // fingerprint on `www.<muni>` "co-occurs with detector X" if detector X
  // fired on *any* probe for that muni, not just the same URL.
  const munisWithAnyMatch = new Set<string>();
  const detectorsByMuni = new Map<string, Set<string>>();
  for (const r of records) {
    if (r.matches.length === 0) continue;
    munisWithAnyMatch.add(r.municipalityName);
    const set = detectorsByMuni.get(r.municipalityName) ?? new Set<string>();
    for (const m of r.matches) set.add(m.detectorId);
    detectorsByMuni.set(r.municipalityName, set);
  }

  type Bucket = {
    kind: Fingerprint["kind"];
    key: string;
    muniSet: Set<string>;
    /** Detector → count of munis where (this fingerprint) AND (that detector fired on the muni). */
    coDetectorMuniCounts: Map<string, Set<string>>;
    exampleUrl: string;
    exampleValue: string | undefined;
  };
  const buckets = new Map<string, Bucket>();
  for (const r of records) {
    if (!r.probe.html) continue;
    const muniDetectors = detectorsByMuni.get(r.municipalityName) ?? new Set();
    for (const fp of r.fingerprints) {
      if (opts.excludeKinds.has(fp.kind)) continue;
      const bucketKey = `${fp.kind}::${fp.key}`;
      let bucket = buckets.get(bucketKey);
      if (!bucket) {
        bucket = {
          kind: fp.kind,
          key: fp.key,
          muniSet: new Set(),
          coDetectorMuniCounts: new Map(),
          exampleUrl: r.probe.finalUrl ?? r.probe.requestedUrl,
          exampleValue: fp.sample,
        };
        buckets.set(bucketKey, bucket);
      }
      bucket.muniSet.add(r.municipalityName);
      for (const id of muniDetectors) {
        const set = bucket.coDetectorMuniCounts.get(id) ?? new Set<string>();
        set.add(r.municipalityName);
        bucket.coDetectorMuniCounts.set(id, set);
      }
    }
  }

  const unidentifiedFingerprints: FingerprintRollup[] = [];
  for (const b of buckets.values()) {
    if (b.muniSet.size < opts.minMuniSupport) continue;
    const unmatched = [...b.muniSet].filter((m) => !munisWithAnyMatch.has(m)).length;
    const co = [...b.coDetectorMuniCounts.entries()]
      .map(([detectorId, set]) => ({ detectorId, muniCount: set.size }))
      .sort((a, c) => c.muniCount - a.muniCount);
    unidentifiedFingerprints.push({
      kind: b.kind,
      key: b.key,
      totalMunis: b.muniSet.size,
      unmatchedMunis: unmatched,
      sampleMunicipalities: [...b.muniSet].slice(0, 10),
      exampleUrl: b.exampleUrl,
      exampleValue: b.exampleValue,
      coOccursWithDetectors: co.filter((c) => opts.knownDetectorIds.has(c.detectorId)),
    });
  }
  // Rank by "unmatched-muni support" first — that's the signal we actually
  // care about for finding new platforms — falling back to total support for
  // ties so widespread infra still surfaces near the top when nothing new
  // is hiding in the unmatched pool.
  unidentifiedFingerprints.sort(
    (a, b) => b.unmatchedMunis - a.unmatchedMunis || b.totalMunis - a.totalMunis,
  );

  // Co-occurrence clustering: among munis with NO detector match, group by
  // exact intersection of their (kind, key) sets, restricted to fingerprints
  // that themselves passed the support threshold. Exact-set clustering is
  // crude but explainable and avoids inventing a similarity threshold —
  // most platforms emit a stable bundle of fingerprints (vendor CDN, JS
  // bundle, cookie name) that produces identical sets across deployments.
  const surfaceKeys = new Set(unidentifiedFingerprints.map((f) => `${f.kind}::${f.key}`));
  const muniSigs = new Map<string, { muni: string; keys: string[]; url: string }>();
  for (const r of records) {
    if (r.matches.length > 0) continue;
    if (!r.probe.html) continue;
    const keys = r.fingerprints
      .map((f) => `${f.kind}::${f.key}`)
      .filter((k) => surfaceKeys.has(k))
      .sort();
    if (keys.length < 2) continue;
    const sig = keys.join("|");
    if (!muniSigs.has(`${r.municipalityName}::${sig}`)) {
      muniSigs.set(`${r.municipalityName}::${sig}`, {
        muni: r.municipalityName,
        keys,
        url: r.probe.finalUrl ?? r.probe.requestedUrl,
      });
    }
  }
  const sigGroups = new Map<string, { muni: string; url: string }[]>();
  for (const v of muniSigs.values()) {
    const sig = v.keys.join("|");
    const group = sigGroups.get(sig) ?? [];
    group.push({ muni: v.muni, url: v.url });
    sigGroups.set(sig, group);
  }

  const cooccurrenceClusters: UnidentifiedCluster[] = [];
  for (const [sig, members] of sigGroups) {
    if (members.length < 3) continue;
    const keys = sig.split("|");
    cooccurrenceClusters.push({
      signature: hashSig(sig),
      size: members.length,
      municipalities: members.map((m) => m.muni).slice(0, 20),
      sharedFingerprints: keys.map((k) => {
        const [kind, key] = k.split("::");
        return { kind: kind!, key: key!, support: members.length };
      }),
      exampleUrl: members[0]!.url,
    });
  }
  cooccurrenceClusters.sort((a, b) => b.size - a.size);

  return { unidentifiedFingerprints, cooccurrenceClusters };
}

function hashSig(s: string): string {
  // Tiny FNV-1a so the signature is short + stable; collisions don't matter
  // (the full feature list is still in the cluster body).
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
