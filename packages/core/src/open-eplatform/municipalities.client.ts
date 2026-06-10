// SPDX-License-Identifier: MIT
/**
 * Client-side mirror of the static SKL registry. Imports the JSON directly
 * so the muni autocomplete can run entirely in-browser — no server round-trip
 * per keystroke. The JSON is ~50 KB (290 munis × ~10 fields); cheaper than
 * a network call.
 *
 * Server-side code still uses `./municipalities.ts` for the same data plus
 * the `findMunicipalityByUrl` reverse lookup that runs in a server action.
 */
import data from "../../data/swedish-municipalities.json" with { type: "json" };

export type MunicipalityClient = {
  name: string;
  city: string;
  domain: string | null;
  email: string | null;
  phone: string | null;
  postalAddress: string | null;
  region: string | null;
  orgNumber: string | null;
  portalCandidates: string[];
  /** Subset of `portalCandidates` confirmed to serve Open ePlatform HTML. */
  verifiedPortals: string[];
};

/**
 * Best URL to prefill into the source-add form. Verified portals win; fall
 * back to the most-common candidate (stellan's frequency-ordered first
 * entry). Returns null only if the muni has no candidates at all (no
 * website on record in SKL).
 */
export function preferredPortalFor(m: MunicipalityClient): string | null {
  return m.verifiedPortals[0] ?? m.portalCandidates[0] ?? null;
}

type Registry = {
  generatedAt: string | null;
  source: string;
  municipalities: MunicipalityClient[];
};

const registry = data as unknown as Registry;

/**
 * Defensive coercion: older JSON snapshots (pre-verifiedPortals) omit the
 * field, so we normalise to an empty array on read. Cheap and avoids
 * scattering `?? []` across every consumer.
 */
function normalise(m: MunicipalityClient): MunicipalityClient {
  return { ...m, verifiedPortals: m.verifiedPortals ?? [] };
}

export function allMunicipalities(): MunicipalityClient[] {
  return registry.municipalities.map(normalise);
}

export function isRegistryEmpty(): boolean {
  return registry.municipalities.length === 0;
}
