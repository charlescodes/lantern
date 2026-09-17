# Saved arena maps

Browser startup loads `maps/<arena>.json` through the development server.
No `arena` parameter means `maps/default.json`. For example,
`http://127.0.0.1:4173/?arena=navigation&renderer=3d` loads `navigation.json`.
The renderer parameter does not select or alter map content.

These are ordinary `lantern-authoring-map` v7 documents exported through the
same save path as the editor. Floors, props, elevators, navigation nodes, and
obelisk settings live here. The original procedural factories remain available
for deterministic tests; browser startup uses these files.

| Arena | File |
| --- | --- |
| Default | `default.json` |
| Elevator | `elevator.json` |
| Holes | `holes.json` |
| Navigation | `navigation.json` |
| Navigation testing v2 | `navigation-testing-v2.json` |

To edit an arena, open its URL, use the editor, and **Save**. Replace the
corresponding file here with the downloaded `lantern-scenario.json`, then reload
the page. Browser Save downloads a file; it does not overwrite the repository.
Reset restores the already loaded map; reload fetches the latest file from disk.
Recordings embed the loaded authored map, so replay does not fetch these files.

For elevator-aware enemy routes, choose the **Navigation** channel. Paint places
cyan nodes and **Link endpoints** connects them to the purple elevator ports.
The **Fill connector navigation** action can instead add the missing staging
nodes and a sparse connector skeleton across all floors as one undoable edit.
It writes ordinary v7 nodes and links; rerunning it does not replace or duplicate
an already complete skeleton.

To add an arena, put another valid authored map here as `my-arena.json` and open
`?arena=my-arena`. Names accept lowercase letters, digits, hyphens, and
underscores. Missing or invalid maps show a startup error instead of silently
loading a different arena.

The navigation map's obelisk has `enemyArchetype: "urchin"`, `maximumAlive: 1`,
and `spawnIntervalTicks: 600` (10 seconds at 60 Hz). There is no saved starting
enemy. The existing simulation still attempts its first spawn on tick one and
then every 600 ticks; the interval is a repeating attempt schedule, not a delay
after death. Initial-spawn timing and global obelisk defaults are unchanged.
