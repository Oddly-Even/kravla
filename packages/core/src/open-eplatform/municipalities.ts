// SPDX-License-Identifier: MIT
/**
 * Reader for the static `data/swedish-municipalities.json` registry. Powers
 * the muni autocomplete on the "Add source" form so operators can pick
 * "Sundsvall" and have the URL field prefilled with a portal candidate.
 *
 * The JSON is regenerated from the SKL dataset by
 * `scripts/update-swedish-municipalities.ts` (`bun run update:municipalities`).
 * It's imported as a module — no I/O at request time, no caching layer
 * needed.
 */
import data from "../../data/swedish-municipalities.json" with { type: "json" };

export type Municipality = {
  name: string;
  city: string;
  domain: string | null;
  email: string | null;
  phone: string | null;
  postalAddress: string | null;
  region: string | null;
  orgNumber: string | null;
  /**
   * URLs we attempted to probe at script run time, ordered by stellan's
   * frequency table. Useful for diagnostics — the UI prefers
   * `verifiedPortals` first because those are confirmed to serve Open
   * ePlatform HTML.
   */
  portalCandidates: string[];
  /**
   * Subset of `portalCandidates` that resolved + responded 2xx + had
   * Open ePlatform / Nordic Peak fingerprints (meta tags or `flowtype_`
   * sections) when the script last ran. Empty array when none of the
   * candidates matched (muni doesn't use Open ePlatform, or DNS/firewall
   * blocked the probe from the script's environment).
   */
  verifiedPortals: string[];
};

type Registry = {
  generatedAt: string | null;
  source: string;
  municipalities: Municipality[];
};

const registry = data as unknown as Registry;

/**
 * Defensive coercion: older JSON snapshots (pre-verifiedPortals) omit the
 * field. Normalise so consumers can safely read `m.verifiedPortals`.
 */
function normalise(m: Municipality): Municipality {
  return { ...m, verifiedPortals: m.verifiedPortals ?? [] };
}

export function listMunicipalities(): Municipality[] {
  return registry.municipalities.map(normalise);
}

export function municipalityRegistryGeneratedAt(): string | null {
  return registry.generatedAt;
}

/**
 * Autocomplete-friendly municipality search.
 *
 * Splits the query into whitespace-separated tokens, then keeps every
 * municipality where *every* token matches a prefix of either the name or
 * the city (tokens that match neither are ignored). This way:
 *   - "Sundsvall"          → name "Sundsvalls kommun" / city "Sundsvall" ✓
 *   - "Sundsvalls"         → name "Sundsvalls kommun"                     ✓
 *   - "Sundsvalls kommun"  → "Sundsvalls" + ignore "kommun"              ✓
 *   - "kommun"             → no tokens left → empty (avoids 290-row dumps)
 *
 * Names carry the "kommun" / "stad" suffix, but matching is prefix-based,
 * so a trailing "kommun" / "stad" token would never prefix-match the name
 * and would wrongly exclude every row. We drop those tokens before matching.
 */
const NOISE_TOKENS = new Set(["kommun", "stad", "kommuns"]);

export function searchMunicipalities(query: string, limit = 10): Municipality[] {
  const tokens = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0 && !NOISE_TOKENS.has(t));
  if (tokens.length === 0) return [];

  const out: Municipality[] = [];
  for (const m of registry.municipalities) {
    const name = m.name.toLowerCase();
    const city = m.city.toLowerCase();
    // Every token must hit a prefix of name OR city — keeps "Sundsvalls kommun"
    // (after dropping "kommun") from matching everything but stays forgiving
    // about whether the operator typed bare, genitive, or full form.
    const allMatch = tokens.every((t) => name.startsWith(t) || city.startsWith(t));
    if (allMatch) {
      out.push(m);
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function findMunicipalityByName(name: string): Municipality | null {
  const target = name.trim().toLowerCase();
  return (
    registry.municipalities.find(
      (m) => m.name.toLowerCase() === target || m.city.toLowerCase() === target,
    ) ?? null
  );
}

/**
 * Reverse lookup: given a portal URL the operator typed, return the
 * municipality whose `domain` matches the URL's eTLD+1 (or any of its
 * dotted-suffix parents, so `sjalvservice.sundsvall.se` resolves to the
 * `sundsvall.se` muni). Returns null on malformed URLs, unknown domains,
 * or domains the registry doesn't carry.
 */
export function findMunicipalityByUrl(url: string): Municipality | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
  if (!hostname) return null;

  const labels = hostname.split(".");
  for (let i = 0; i < labels.length - 1; i++) {
    const candidate = labels.slice(i).join(".");
    const hit = registry.municipalities.find(
      (m) => m.domain && m.domain.toLowerCase() === candidate,
    );
    if (hit) return hit;
  }
  return null;
}
