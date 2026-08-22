// @ts-check

import { ROCK_ARCHETYPES, VERTICAL_PHYSICS } from "../config.js";

const CATEGORY_LABELS = Object.freeze({
  surface: "Surfaces",
  structure: "Structures",
  object: "Objects",
  connector: "Connectors",
});

/** @param {Record<string, any>} definition */
function freezeDefinition(definition) {
  if (definition.footprint?.cells) {
    for (const cell of definition.footprint.cells) Object.freeze(cell);
    Object.freeze(definition.footprint.cells);
    Object.freeze(definition.footprint);
  }
  if (definition.traits?.presentationLight) {
    Object.freeze(definition.traits.presentationLight.color);
    Object.freeze(definition.traits.presentationLight);
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
    id: "surface.hole",
    label: "Floor hole",
    category: "surface",
    categoryLabel: CATEGORY_LABELS.surface,
    placementMode: "paint",
    placementTarget: "surface",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#20252a", alternateFill: "#20252a", stroke: "#bdc7cf", glyph: "" },
    renderAsset: null,
    traits: {
      surfaceMaterial: "hole",
      runtimeKind: "floor-hole",
      apertureWidth: VERTICAL_PHYSICS.defaultHoleApertureWidthMeters,
      apertureClearance: VERTICAL_PHYSICS.holeFitClearanceMeters,
      blocksMovement: false,
      blocksSight: false,
    },
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
      collider: "circle",
      dynamic: true,
      airbornePassable: true,
      canRideElevator: true,
      canActivateElevator: false,
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
      runtimeKind: "dynamic-upright",
      shape: "standing-torch",
      snap: "tenth",
      radius: 0.1,
      height: 2,
      massKg: 8,
      collider: "circle",
      dynamic: true,
      upright: true,
      airbornePassable: false,
      canRideElevator: true,
      canActivateElevator: false,
      blocksMovement: true,
      blocksSight: false,
      presentationLight: {
        height: 1.82,
        color: { r: 1, g: 0.22, b: 0.045 },
        intensity: 18,
        distance: 5,
        decay: 2,
      },
    },
  }),
  freezeDefinition({
    id: "object.table",
    label: "Plain table",
    category: "object",
    categoryLabel: CATEGORY_LABELS.object,
    placementMode: "stamp",
    placementTarget: "instance",
    footprint: { cells: [{ x: 0, z: 0 }, { x: 1, z: 0 }] },
    debug: { fill: "#7b5b3f", alternateFill: "#8a6848", stroke: "#e0b47d", glyph: "→" },
    renderAsset: null,
    traits: {
      runtimeKind: "dynamic-fixed-box",
      shape: "table",
      snap: "cell-center",
      rotatable: true,
      dynamic: true,
      airbornePassable: true,
      canRideElevator: true,
      canActivateElevator: false,
      collider: "box",
      halfWidth: 0.9,
      halfDepth: 0.36,
      height: 0.52,
      massKg: 320,
      fixedRotation: true,
      runtimeAnchor: "footprint-center",
      blocksMovement: true,
      blocksSight: false,
    },
  }),
  freezeDefinition({
    id: "connector.elevator.two-stop",
    label: "Two-stop elevator",
    category: "connector",
    categoryLabel: CATEGORY_LABELS.connector,
    placementMode: "stamp",
    placementTarget: "connector",
    footprint: { cells: [{ x: 0, z: 0 }] },
    debug: { fill: "#4c8f9f", alternateFill: "#356d7a", stroke: "#b9f3ff", glyph: "E" },
    renderAsset: null,
    traits: {
      runtimeKind: "elevator-connector",
      snap: "tenth",
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

/**
 * Dynamic circular props share the existing bounded X/Z rigid-body pool.
 * Their stable authoring definition remains the semantic identity; the pool
 * slot is only a runtime implementation detail.
 * @param {Record<string, any>|null|undefined} definition
 */
export function isDynamicCircleDefinition(definition) {
  return Boolean(
    isDynamicBodyDefinition(definition)
    && definition.traits.collider !== "box"
    && Number.isFinite(Number(definition.traits.radius))
    && Number(definition.traits.radius) > 0
    && Number.isFinite(Number(definition.traits.massKg))
    && Number(definition.traits.massKg) > 0,
  );
}

/** @param {Record<string, any>|null|undefined} definition */
export function isDynamicBoxDefinition(definition) {
  return Boolean(
    isDynamicBodyDefinition(definition)
    && definition.traits.collider === "box"
    && Number.isFinite(Number(definition.traits.halfWidth))
    && Number(definition.traits.halfWidth) > 0
    && Number.isFinite(Number(definition.traits.halfDepth))
    && Number(definition.traits.halfDepth) > 0,
  );
}

/** @param {Record<string, any>|null|undefined} definition */
export function isDynamicBodyDefinition(definition) {
  return Boolean(
    definition?.placementTarget === "instance"
    && definition.traits?.dynamic === true
    && Number.isFinite(Number(definition.traits.massKg))
    && Number(definition.traits.massKg) > 0,
  );
}

/** @param {string} archetype */
export function rockDefinitionId(archetype) {
  const id = `object.rock.${archetype}`;
  return DEFINITIONS_BY_ID.has(id) ? id : null;
}
