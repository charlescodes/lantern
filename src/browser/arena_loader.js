// @ts-check

import { ArenaScenario } from "../sim/scenario.js";

/** @param {string|URLSearchParams} [search] */
export function arenaMapUrl(search = "") {
  const parameters = new URLSearchParams(search);
  const name = parameters.get("arena") || "default";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(name)) {
    throw new RangeError("Arena name must contain only lowercase letters, digits, underscores, or hyphens.");
  }
  return new URL(`../../maps/${name}.json`, import.meta.url);
}

/**
 * Load and validate authored data before simulation or rendering starts.
 * @param {string|URLSearchParams} [search]
 * @param {typeof fetch} [fetchMap]
 */
export async function loadArenaScenario(search = "", fetchMap = globalThis.fetch) {
  const url = arenaMapUrl(search);
  try {
    const response = await fetchMap(url, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return ArenaScenario.fromJSON(await response.json());
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    throw new Error(`Could not load arena map ${url.pathname}: ${detail}`, { cause });
  }
}
