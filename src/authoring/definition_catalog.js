// @ts-check

import { ROCK_ARCHETYPES } from "../config.js";

const CATEGORY_LABELS = Object.freeze({
  surface: "Surfaces",
  structure: "Structures",
  object: "Objects",
});

/** @param {Record<string, any>} definition */
function freezeDefinition(definition) {
  if (definition.footprint?.cells) {
    for (const cell of definition.footprint.cells) Object.freeze(cell);
    Object.freeze(definition.footprint.cells);
    Object.freeze(definition.footprint);
  }
  Object.freeze(definition.debug);
  Object.freeze(definition.traits);
  return Object.freeze(definition);
}

/**
 * The catalog is authoring data. Runtime systems resolve these stable IDs
 * during compilation rather than branching on palette button names.
 */
export const PLACEABLE_DEFINITIONS = Object.freeze([
  freezeDefinition({
    id: "surface.stone",
    label: "Stone floor",
    category: "surface",
    categoryLabel: CATEGORY_LABELS.surface,
    placementMode: "paint",
    placementTarget: "surface",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#586358", alternateFill: "#5b665b", stroke: "#46544b", glyph: "" },
    renderAsset: null,
    traits: { surfaceMaterial: "stone", blocksMovement: false, blocksSight: false },
  }),
  freezeDefinition({
    id: "surface.moss",
    label: "Moss floor",
    category: "surface",
    categoryLabel: CATEGORY_LABELS.surface,
    placementMode: "paint",
    placementTarget: "surface",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#3f664b", alternateFill: "#466f50", stroke: "#31533c", glyph: "" },
    renderAsset: null,
    traits: { surfaceMaterial: "moss", blocksMovement: false, blocksSight: false },
  }),
  freezeDefinition({
    id: "structure.wall",
    label: "Wall",
    category: "structure",
    categoryLabel: CATEGORY_LABELS.structure,
    placementMode: "paint",
    placementTarget: "structure",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#687568", alternateFill: "#687568", stroke: "#b8cba8", glyph: "" },
    renderAsset: null,
    traits: { blocksMovement: true, blocksSight: true, runtimeKind: "solid-cell" },
  }),
  ...Object.entries(ROCK_ARCHETYPES).map(([archetype, rock]) => freezeDefinition({
    id: `object.rock.${archetype}`,
    label: `Rock ${rock.radius}m`,
    category: "object",
    categoryLabel: CATEGORY_LABELS.object,
    placementMode: "stamp",
    placementTarget: "instance",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: {
      fill: archetype === "small" ? "#a7aa91" : archetype === "medium" ? "#828673" : "#676c5d",
      alternateFill: archetype === "small" ? "#a7aa91" : archetype === "medium" ? "#828673" : "#676c5d",
      stroke: "#d0d0b1",
      glyph: "",
    },
    renderAsset: null,
    traits: {
      runtimeKind: "rock",
      rockArchetype: archetype,
      radius: rock.radius,
      massKg: rock.massKg,
      dynamic: true,
      snap: "tenth",
      blocksMovement: true,
      blocksSight: false,
    },
  })),
  freezeDefinition({
    id: "object.pillar",
    label: "Pillar",
    category: "object",
    categoryLabel: CATEGORY_LABELS.object,
    placementMode: "stamp",
    placementTarget: "instance",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#777d74", alternateFill: "#777d74", stroke: "#d2d8cf", glyph: "P" },
    renderAsset: null,
    traits: {
      runtimeKind: "static-placeholder",
      shape: "pillar",
      snap: "cell-center",
      blocksMovement: true,
      blocksSight: true,
    },
  }),
  freezeDefinition({
    id: "object.torch",
    label: "Standing torch",
    category: "object",
    categoryLabel: CATEGORY_LABELS.object,
    placementMode: "stamp",
    placementTarget: "instance",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#e19b45", alternateFill: "#e19b45", stroke: "#ffe0a1", glyph: "T" },
    renderAsset: null,
    traits: {
      runtimeKind: "debug-placeholder",
      shape: "standing-torch",
      snap: "cell-center",
      blocksMovement: false,
      blocksSight: false,
    },
  }),
]);

const DEFINITIONS_BY_ID = new Map(
  PLACEABLE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** @param {unknown} id */
export function getPlaceableDefinition(id) {
  return DEFINITIONS_BY_ID.get(String(id)) ?? null;
}

export function listPlaceableDefinitions() {
  return [...PLACEABLE_DEFINITIONS];
}

/** @param {string} archetype */
export function rockDefinitionId(archetype) {
  const id = `object.rock.${archetype}`;
  return DEFINITIONS_BY_ID.has(id) ? id : null;
}
