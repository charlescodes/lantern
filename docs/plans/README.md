# Active implementation plans

This directory holds decision-complete plans for work that has been approved
but is not yet a frozen milestone record. The [roadmap](../roadmap.md) owns
ordering. Historical milestone documents remain under `docs/milestones/`.

## Active

- [M1E authored mechanisms](./m1e-mechanisms.md) — two implementation passes.
  Pass A (M1E.1 + M1E.2) is implemented with manual browser acceptance pending;
  Pass B (M1E.3 + M1E.4) remains planned. See the
  [runtime contract](../notes/authored-mechanisms.md) for the delivered boundary.

## Implemented

- [M1C authored navigation topology](./m1c-authored-navigation-topology.md) —
  delivered persisted topology, editor tooling, deterministic patrol,
  autonomous elevator traversal, and observed cross-floor pursuit.

- [Editable, floor-aware obelisks and reliable enemy homes](./editable-floor-aware-obelisks.md)
  — delivered floor-aware homes and independent authored encounters across
  schemas v19-v21 and authoring-map v7; later encounter/destruction profiles
  are summarized by the [platform contract](../platform.md).
