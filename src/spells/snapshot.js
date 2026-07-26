// @ts-check

import {
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_SPELL_CODE,
} from "./fireball_definition.js";

const SNAPSHOT_LOOKUPS = new WeakMap();

/** @param {Record<string,any>} snapshot */
function definitionLookup(snapshot) {
  if (
    !snapshot
    || typeof snapshot !== "object"
    || !Array.isArray(snapshot.spells)
  ) return null;
  const cached = SNAPSHOT_LOOKUPS.get(snapshot);
  if (cached) return cached;
  const bySpellCode = new Map();
  for (const spell of snapshot.spells) {
    bySpellCode.set(Number(spell.code), {
      currentRevision: Number(spell.currentRevision),
      revisions: new Map(
        (spell.revisions ?? []).map((entry) => [
          Number(entry.revision),
          entry.definition,
        ]),
      ),
    });
  }
  SNAPSHOT_LOOKUPS.set(snapshot, bySpellCode);
  return bySpellCode;
}

/**
 * Resolves one captured definition through the snapshot spell table. Legacy
 * schema fixtures and direct pool tests fall back to the current Fireball
 * revision, then the built-in immutable default.
 *
 * @param {Record<string,any>} snapshot
 * @param {Record<string,any>|null|undefined} source
 */
export function fireballDefinitionFromSnapshot(snapshot, source) {
  const requestedCode = Number(source?.spellCode ?? FIREBALL_SPELL_CODE);
  const lookup = definitionLookup(snapshot);
  const spell = lookup?.get(
    requestedCode > 0 ? requestedCode : FIREBALL_SPELL_CODE,
  );
  if (!spell) return DEFAULT_FIREBALL_DEFINITION;
  const requestedRevision = Number(
    source?.definitionRevision ?? spell.currentRevision,
  );
  return spell.revisions.get(
    requestedRevision > 0 ? requestedRevision : spell.currentRevision,
  ) ?? DEFAULT_FIREBALL_DEFINITION;
}
