# Lantern agent guide

Lantern is a browser-first, fixed-step JavaScript action-simulation kernel. Keep
the source of gameplay truth in the simulation; renderers and browser UI observe
it but do not decide it.

## Start safely

1. Run `git status --short` before changing anything. Preserve unrelated work.
2. Read the applicable current contract before changing a system.
3. For implementation work, run the focused tests and `npm run check` before
   handoff. Browser/GPU readability still needs a real-browser manual pass.
4. Stage exact paths, inspect `git diff --cached`, and never conflate app,
   recording-schema, authoring-map, and historical-profile versions.

## Authority order

For shipped behavior, use this order when artifacts disagree:

1. Current source, tests, and current format contracts.
2. Current implementation plans and the [roadmap](docs/roadmap.md).
3. Soft specifications and product direction.
4. Historical milestone documents and archived handoffs.

The [documentation guide](docs/README.md) explains ownership of each document.
Historical contracts describe their release boundary; do not silently rewrite
their frozen behavior to describe a newer runtime.

## Engineering invariants

- Keep simulation authority independent from Canvas, Three.js, DOM, and frame
  rate. Send mutations through the fixed-tick command boundary.
- Preserve bounded pools, typed-array/SoA patterns in hot loops, stable IDs,
  deterministic tie breaks, replay branches, and detached JSON-safe probes.
- Keep authored map state separate from disposable runtime movement and editor
  active-layer state separate from every body's runtime layer.
- Lantern is X/Z gameplay with limited per-body world Y. Floors and elevators
  are supports, not passenger ownership; do not introduce general 3D rigid-body
  physics, global floor swaps, or an unrelated ECS rewrite.
- Treat new diagnostics and automation as bounded, replay-aware product tools,
  not unbounded per-tick logs.

## Useful references

- [Product vision](docs/product-vision.md)
- [Current roadmap](docs/roadmap.md)
- [Architecture guide](docs/architecture-guide.md)
- [Probe contract](docs/probe-contract.md)
- [Verification guide](docs/verification.md)
- [Platform contract](docs/platform.md)
