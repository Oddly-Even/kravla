#!/usr/bin/env bun
// SPDX-License-Identifier: MIT
/**
 * Discovery scan: for each municipality in `data/swedish-municipalities.json`,
 * probe a small set of candidate URLs and run every named detector against
 * the response. Then feed the *unmatched* pages into the meta-detector to
 * surface shared fingerprints that might be a new platform.
 *
 * Output files (under `data/detection/`, configurable via `--out`):
 *   - `report.json`              full machine-readable report
 *   - `report.md`                human-skimmable summary table
 *   - `unidentified.json`        meta-detector findings, broken out so a
 *                                reviewer (or a follow-up Claude session)
 *                                can act on them without parsing the full
 *                                report
 *
 * Usage:
 *   bun scripts/detect-municipal-services.ts
 *   bun scripts/detect-municipal-services.ts --limit 20            # smoke test
 *   bun scripts/detect-municipal-services.ts --only sundsvall,ale  # specific munis
 *   bun scripts/detect-municipal-services.ts --concurrency 8
 *   bun scripts/detect-municipal-services.ts --out /tmp/scan
 *
 * The script is idempotent and re-fetches everything on each run — we
 * don't cache, because the point is to see *current* state. For a faster
 * iteration loop while tweaking detectors, pass `--limit 20`.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import * as cheerio from "cheerio";
import {
  listMunicipalities,
  type Municipality,
} from "../packages/core/src/open-eplatform/municipalities";
import { detectors, detectorIds } from "./detectors";
import { buildMetaReport, type MetaReport } from "./detectors/meta";
import { extractFingerprints, fetchProbe, withPool } from "./detectors/util";
import type { DetectionHit, Fingerprint, ProbeRecord } from "./detectors/types";

type Args = {
  limit: number | null;
  only: string[] | null;
  concurrency: number;
  out: string;
  timeoutMs: number;
  /** Minimum munis a fingerprint must appear on to surface in the meta report. */
  metaSupport: number;
};

function parseArgs(argv: string[]): Args {
  const args: Args = {
    limit: null,
    only: null,
    concurrency: 6,
    out: resolve(import.meta.dir, "..", "data", "detection"),
    timeoutMs: 12_000,
    metaSupport: 4,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--only")
      args.only = (argv[++i] ?? "").split(",").map((s) => s.trim().toLowerCase());
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--out") args.out = resolve(argv[++i]!);
    else if (a === "--timeout") args.timeoutMs = Number(argv[++i]);
    else if (a === "--meta-support") args.metaSupport = Number(argv[++i]);
  }
  return args;
}

function chooseMunis(all: Municipality[], args: Args): Municipality[] {
  let pool = all;
  if (args.only) {
    const set = new Set(args.only);
    pool = pool.filter((m) => set.has(m.name.toLowerCase()) || set.has(m.city.toLowerCase()));
  }
  if (args.limit) pool = pool.slice(0, args.limit);
  return pool;
}

type CandidateRow = {
  muni: Municipality;
  url: string;
  /** Which detectors requested this URL — informational; every detector still runs on the probe. */
  requestedBy: string[];
};

/**
 * Build the dedupe'd probe queue: take the union of every detector's
 * candidate URLs, group by URL, remember which detectors asked for it.
 * Each unique URL is fetched once even when 3 detectors all want the main
 * site root.
 */
function buildCandidates(munis: Municipality[]): CandidateRow[] {
  const byMuni = new Map<string, Map<string, CandidateRow>>();
  for (const muni of munis) {
    const perUrl = new Map<string, CandidateRow>();
    for (const detector of detectors) {
      for (const url of detector.candidateUrls(muni)) {
        const existing = perUrl.get(url);
        if (existing) existing.requestedBy.push(detector.id);
        else perUrl.set(url, { muni, url, requestedBy: [detector.id] });
      }
    }
    byMuni.set(muni.name, perUrl);
  }
  return [...byMuni.values()].flatMap((m) => [...m.values()]);
}

async function probeOne(row: CandidateRow, timeoutMs: number): Promise<ProbeRecord> {
  const probe = await fetchProbe(row.url, timeoutMs);
  const matches: DetectionHit[] = [];
  // Detectors expect a loaded cheerio instance + URL + headers — the
  // runtime-detector contract is shared with `crawl-runner.ts`. Load
  // once per probe and pass to every detector.
  const $ = probe.html ? cheerio.load(probe.html) : null;
  if ($) {
    const input = {
      $,
      url: probe.requestedUrl,
      finalUrl: probe.finalUrl ?? undefined,
      headers: probe.headers,
    };
    for (const detector of detectors) {
      let evidence;
      try {
        evidence = detector.detect(input);
      } catch {
        continue;
      }
      if (!evidence) continue;
      matches.push({
        detectorId: detector.id,
        detectorName: detector.name,
        confidence: evidence.confidence,
        evidence: evidence.evidence,
        ...(evidence.metadata ? { metadata: evidence.metadata } : {}),
        probeUrl: row.url,
      });
    }
  }
  const fingerprints: Fingerprint[] = extractFingerprints(probe);
  return {
    municipalityName: row.muni.name,
    probe,
    matches,
    fingerprints,
  };
}

type PerMuniSummary = {
  municipality: string;
  domain: string | null;
  detected: { detectorId: string; confidence: string; probeUrl: string; evidence: string[] }[];
  /** Probe URLs that returned no detector hit — useful when filtering candidates. */
  unmatchedProbes: { url: string; status: number | null; error: string | null }[];
};

function summarisePerMuni(records: ProbeRecord[]): PerMuniSummary[] {
  const byMuni = new Map<string, ProbeRecord[]>();
  for (const r of records) {
    const list = byMuni.get(r.municipalityName) ?? [];
    list.push(r);
    byMuni.set(r.municipalityName, list);
  }
  const out: PerMuniSummary[] = [];
  for (const [muni, list] of byMuni) {
    const detected = list.flatMap((r) =>
      r.matches.map((m) => ({
        detectorId: m.detectorId,
        confidence: m.confidence,
        probeUrl: m.probeUrl,
        evidence: m.evidence,
      })),
    );
    const unmatchedProbes = list
      .filter((r) => r.matches.length === 0)
      .map((r) => ({ url: r.probe.requestedUrl, status: r.probe.status, error: r.probe.error }));
    out.push({ municipality: muni, domain: null, detected, unmatchedProbes });
  }
  return out.sort((a, b) => a.municipality.localeCompare(b.municipality, "sv"));
}

function rollupByDetector(records: ProbeRecord[]) {
  const out = new Map<string, { name: string; high: Set<string>; low: Set<string> }>();
  for (const d of detectors) out.set(d.id, { name: d.name, high: new Set(), low: new Set() });
  for (const r of records) {
    for (const m of r.matches) {
      const bucket = out.get(m.detectorId);
      if (!bucket) continue;
      (m.confidence === "high" ? bucket.high : bucket.low).add(r.municipalityName);
    }
  }
  return [...out.entries()].map(([id, b]) => ({
    detectorId: id,
    detectorName: b.name,
    highConfidenceMunicipalities: [...b.high].sort((a, b2) => a.localeCompare(b2, "sv")),
    lowConfidenceMunicipalities: [...b.low].filter((m) => !b.high.has(m)).sort(),
    highCount: b.high.size,
    lowCount: [...b.low].filter((m) => !b.high.has(m)).length,
  }));
}

function renderMarkdown(opts: {
  totalMunicipalities: number;
  probesFetched: number;
  rollup: ReturnType<typeof rollupByDetector>;
  meta: MetaReport;
  generatedAt: string;
}): string {
  const lines: string[] = [];
  lines.push(`# Municipal service detection report`);
  lines.push("");
  lines.push(`Generated: ${opts.generatedAt}`);
  lines.push(
    `Municipalities scanned: **${opts.totalMunicipalities}**, total probes: ${opts.probesFetched}`,
  );
  lines.push("");

  lines.push(`## Detector hit counts`);
  lines.push("");
  lines.push("| Detector | High-confidence | Low-confidence |");
  lines.push("| --- | ---: | ---: |");
  for (const r of opts.rollup) {
    lines.push(`| ${r.detectorName} | ${r.highCount} | ${r.lowCount} |`);
  }
  lines.push("");

  for (const r of opts.rollup) {
    if (r.highCount === 0 && r.lowCount === 0) continue;
    lines.push(`### ${r.detectorName}`);
    lines.push("");
    if (r.highCount > 0) {
      lines.push(`**High** (${r.highCount}): ${r.highConfidenceMunicipalities.join(", ")}`);
      lines.push("");
    }
    if (r.lowCount > 0) {
      lines.push(`**Low** (${r.lowCount}): ${r.lowConfidenceMunicipalities.join(", ")}`);
      lines.push("");
    }
  }

  lines.push(`## Meta-detector: shared fingerprints`);
  lines.push("");
  lines.push(
    `Each row is a fingerprint that appeared on >= ${"`--meta-support`"} municipalities. ` +
      `\`Unmatched\` is how many of those munis had ZERO detector hits — that column ranks ` +
      `the table, so rows at the top are the strongest new-platform candidates. ` +
      `\`Co-occurs with\` shows which named detectors fired on the same munis: heavy overlap ` +
      `with one detector means the fingerprint is part of that platform's footprint (= noise), ` +
      `light overlap means the fingerprint is independent (= likely a new platform).`,
  );
  lines.push("");
  lines.push("| Kind | Key | Total | Unmatched | Co-occurs with | Example URL |");
  lines.push("| --- | --- | ---: | ---: | --- | --- |");
  for (const f of opts.meta.unidentifiedFingerprints.slice(0, 80)) {
    const co =
      f.coOccursWithDetectors
        .slice(0, 3)
        .map((c) => `${c.detectorId} (${c.muniCount})`)
        .join(", ") || "—";
    lines.push(
      `| ${f.kind} | \`${truncate(f.key, 50)}\` | ${f.totalMunis} | ${f.unmatchedMunis} | ${co} | ${truncate(f.exampleUrl, 60)} |`,
    );
  }
  lines.push("");

  if (opts.meta.cooccurrenceClusters.length > 0) {
    lines.push(`## Meta-detector: co-occurrence clusters`);
    lines.push("");
    lines.push(
      `Groups of unmatched municipalities that share the *same set* of unidentified ` +
        `fingerprints. A cluster of size N is N munis running what looks like the same ` +
        `unknown platform — write a detector against the example URL and they all turn green.`,
    );
    lines.push("");
    for (const c of opts.meta.cooccurrenceClusters.slice(0, 25)) {
      lines.push(`### Cluster ${c.signature} — ${c.size} munis`);
      lines.push(`Example URL: ${c.exampleUrl}`);
      lines.push(`Munis (first 20): ${c.municipalities.join(", ")}`);
      lines.push(`Shared fingerprints:`);
      for (const sf of c.sharedFingerprints)
        lines.push(`- ${sf.kind}: \`${truncate(sf.key, 80)}\``);
      lines.push("");
    }
  }

  return lines.join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1) + "…";
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const generatedAt = new Date().toISOString();
  const all = listMunicipalities();
  const munis = chooseMunis(all, args);
  console.log(
    `Scanning ${munis.length}/${all.length} municipalities with ${detectors.length} detectors ` +
      `(concurrency=${args.concurrency}, timeout=${args.timeoutMs}ms)`,
  );

  const candidates = buildCandidates(munis);
  console.log(`  ${candidates.length} unique probe URLs queued`);

  let completed = 0;
  const records = await withPool(candidates, args.concurrency, async (row) => {
    const r = await probeOne(row, args.timeoutMs);
    completed++;
    if (completed % 50 === 0 || completed === candidates.length) {
      const hits = r.matches.length > 0 ? "✓" : " ";
      console.log(`  [${completed}/${candidates.length}] ${hits} ${row.url}`);
    }
    return r;
  });

  const perMuni = summarisePerMuni(records);
  const rollup = rollupByDetector(records);
  const meta = buildMetaReport(records, {
    minMuniSupport: args.metaSupport,
    excludeKinds: new Set(["class-prefix"]),
    knownDetectorIds: detectorIds,
  });

  await mkdir(args.out, { recursive: true });
  const reportPath = resolve(args.out, "report.json");
  const mdPath = resolve(args.out, "report.md");
  const unidentifiedPath = resolve(args.out, "unidentified.json");

  await writeFile(
    reportPath,
    JSON.stringify(
      {
        generatedAt,
        totalMunicipalities: munis.length,
        probesFetched: records.length,
        rollup,
        perMuni,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(unidentifiedPath, JSON.stringify({ generatedAt, ...meta }, null, 2), "utf8");
  await writeFile(
    mdPath,
    renderMarkdown({
      totalMunicipalities: munis.length,
      probesFetched: records.length,
      rollup,
      meta,
      generatedAt,
    }),
    "utf8",
  );

  console.log("");
  console.log(`Wrote:`);
  console.log(`  ${reportPath}`);
  console.log(`  ${mdPath}`);
  console.log(`  ${unidentifiedPath}`);
  console.log("");
  console.log(`Detector summary:`);
  for (const r of rollup) {
    console.log(`  ${r.detectorName}: ${r.highCount} high, ${r.lowCount} low`);
  }
  console.log("");
  console.log(
    `Meta-detector: ${meta.unidentifiedFingerprints.length} unidentified fingerprints, ` +
      `${meta.cooccurrenceClusters.length} co-occurrence clusters`,
  );
}

await main();
