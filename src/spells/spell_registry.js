// @ts-check

import {
  DEFAULT_FIREBALL_DEFINITION,
  FIREBALL_SPELL_CODE,
  FIREBALL_SPELL_ID,
  validateFireballDefinition,
} from "./fireball_definition.js";

export const MAX_SPELL_REVISIONS = 512;

/** @param {unknown} value */
function cloneJson(value) {
  if (Array.isArray(value)) return value.map(cloneJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, cloneJson(item)]),
    );
  }
  return value;
}

/** @param {string} spellId @param {string} code @param {string} message @param {unknown} [actual] */
function registryError(spellId, code, message, actual) {
  const error = { path: "spellId", spellId, code, message };
  if (arguments.length >= 4) Object.assign(error, { actual });
  return error;
}

export class SpellRegistry {
  /**
   * @param {{
   * initialFireballDefinition?:unknown,
   * recordingBaseline?:Array<Record<string,any>>
   * }} [options]
   */
  constructor(options = {}) {
    this.entriesById = new Map();
    this.entriesByCode = new Map();
    if (Array.isArray(options.recordingBaseline)) {
      this.#loadRecordingBaseline(options.recordingBaseline);
    } else {
      const initial = validateFireballDefinition(
        options.initialFireballDefinition ?? DEFAULT_FIREBALL_DEFINITION,
      );
      if (!initial.ok) {
        throw new TypeError(initial.errors.map((error) => error.message).join("; "));
      }
      this.#addEntry({
        id: FIREBALL_SPELL_ID,
        name: "Fireball",
        code: FIREBALL_SPELL_CODE,
        handler: "fireball",
        currentRevision: 1,
        revisionCounter: 1,
        definitions: new Map([[1, initial.value]]),
      });
    }
  }

  /** @param {Record<string,any>} entry */
  #addEntry(entry) {
    if (
      this.entriesById.has(entry.id)
      || this.entriesByCode.has(entry.code)
      || !Number.isInteger(entry.code)
      || entry.code <= 0
      || entry.code > 255
    ) {
      throw new RangeError("Spell registry contains a duplicate or invalid spell code");
    }
    this.entriesById.set(entry.id, entry);
    this.entriesByCode.set(entry.code, entry);
  }

  /** @param {Array<Record<string,any>>} baseline */
  #loadRecordingBaseline(baseline) {
    for (const source of baseline) {
      if (
        source?.id !== FIREBALL_SPELL_ID
        || Number(source.code) !== FIREBALL_SPELL_CODE
        || source.handler !== "fireball"
      ) {
        throw new RangeError("Recording contains an unsupported spell registry entry");
      }
      const revision = Number(source.currentRevision);
      const revisionCounter = Number(source.revisionCounter);
      if (
        !Number.isInteger(revision)
        || revision <= 0
        || !Number.isInteger(revisionCounter)
        || revisionCounter < revision
      ) {
        throw new RangeError("Recording contains invalid spell revision metadata");
      }
      const validated = validateFireballDefinition(source.definition);
      if (!validated.ok) {
        throw new TypeError(
          `Recording Fireball definition is invalid: ${
            validated.errors.map((error) => error.message).join("; ")
          }`,
        );
      }
      this.#addEntry({
        id: FIREBALL_SPELL_ID,
        name: "Fireball",
        code: FIREBALL_SPELL_CODE,
        handler: "fireball",
        currentRevision: revision,
        revisionCounter,
        definitions: new Map([[revision, validated.value]]),
      });
    }
    if (!this.entriesById.has(FIREBALL_SPELL_ID) || this.entriesById.size !== 1) {
      throw new RangeError("Recording must contain exactly the Fireball spell");
    }
  }

  list() {
    return [...this.entriesById.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      code: entry.code,
      handler: entry.handler,
      revision: entry.currentRevision,
    }));
  }

  /** @param {string} id */
  get(id) {
    return this.entriesById.get(String(id)) ?? null;
  }

  /** @param {number} code */
  getByCode(code) {
    return this.entriesByCode.get(Number(code)) ?? null;
  }

  /** @param {number} code @param {number} revision */
  getDefinition(code, revision) {
    return this.getByCode(code)?.definitions.get(Number(revision)) ?? null;
  }

  /** @param {string} id */
  describe(id) {
    const entry = this.get(id);
    if (!entry) return null;
    return {
      id: entry.id,
      name: entry.name,
      code: entry.code,
      handler: entry.handler,
      revision: entry.currentRevision,
      revisionCounter: entry.revisionCounter,
      definition: cloneJson(entry.definitions.get(entry.currentRevision)),
    };
  }

  /**
   * @param {string} id
   * @param {unknown} definition
   * @param {number|undefined} expectedRevision
   */
  validateApply(id, definition, expectedRevision) {
    const entry = this.get(id);
    if (!entry) {
      return {
        ok: false,
        errors: [registryError(String(id), "unknown_spell", `Unknown spell "${id}"`)],
      };
    }
    if (
      expectedRevision !== undefined
      && (
        !Number.isInteger(expectedRevision)
        || Number(expectedRevision) !== entry.currentRevision
      )
    ) {
      return {
        ok: false,
        errors: [registryError(
          entry.id,
          "revision_conflict",
          `Expected revision ${expectedRevision}; current revision is ${entry.currentRevision}`,
          expectedRevision,
        )],
      };
    }
    const validated = validateFireballDefinition(definition);
    if (!validated.ok) return validated;
    if (entry.definitions.size >= MAX_SPELL_REVISIONS) {
      return {
        ok: false,
        errors: [registryError(
          entry.id,
          "revision_capacity",
          `Spell revision capacity ${MAX_SPELL_REVISIONS} is fully referenced`,
        )],
      };
    }
    return { ok: true, value: validated.value, errors: [] };
  }

  /**
   * @param {string} id
   * @param {unknown} definition
   * @param {number|undefined} expectedRevision
   */
  apply(id, definition, expectedRevision) {
    const validation = this.validateApply(id, definition, expectedRevision);
    if (!validation.ok) {
      return { ok: false, spellId: String(id), errors: validation.errors };
    }
    const entry = this.get(id);
    if (!entry) throw new Error("Validated spell disappeared");
    entry.revisionCounter += 1;
    entry.currentRevision = entry.revisionCounter;
    entry.definitions.set(entry.currentRevision, validation.value);
    return {
      ok: true,
      spellId: entry.id,
      code: entry.code,
      revision: entry.currentRevision,
      definition: cloneJson(validation.value),
      errors: [],
    };
  }

  /**
   * Removes only definitions that are neither current nor referenced.
   * @param {Map<number,Set<number>>} referenced
   */
  prune(referenced) {
    let removed = 0;
    for (const entry of this.entriesById.values()) {
      const keep = referenced.get(entry.code) ?? new Set();
      keep.add(entry.currentRevision);
      for (const revision of entry.definitions.keys()) {
        if (keep.has(revision)) continue;
        entry.definitions.delete(revision);
        removed += 1;
      }
    }
    return removed;
  }

  recordingBaseline() {
    return [...this.entriesById.values()].map((entry) => ({
      id: entry.id,
      name: entry.name,
      code: entry.code,
      handler: entry.handler,
      currentRevision: entry.currentRevision,
      revisionCounter: entry.revisionCounter,
      definition: cloneJson(entry.definitions.get(entry.currentRevision)),
    }));
  }

  /**
   * @param {Map<number,Set<number>>} referenced
   */
  snapshotTable(referenced) {
    return [...this.entriesById.values()].map((entry) => {
      const revisions = new Set(referenced.get(entry.code) ?? []);
      revisions.add(entry.currentRevision);
      return {
        id: entry.id,
        name: entry.name,
        code: entry.code,
        handler: entry.handler,
        currentRevision: entry.currentRevision,
        revisionCounter: entry.revisionCounter,
        revisions: [...revisions]
          .sort((left, right) => left - right)
          .map((revision) => ({
            revision,
            definition: cloneJson(entry.definitions.get(revision)),
          }))
          .filter((item) => item.definition),
      };
    });
  }

  diagnostics() {
    return [...this.entriesById.values()].map((entry) => ({
      id: entry.id,
      code: entry.code,
      currentRevision: entry.currentRevision,
      revisionCounter: entry.revisionCounter,
      retainedRevisions: entry.definitions.size,
      revisions: [...entry.definitions.keys()].sort((left, right) => left - right),
    }));
  }

  cloneBaseline() {
    return cloneJson(this.recordingBaseline());
  }
}
