# Navigation floor transitions: stale overlay and suspected AI retargeting

- **Status:** Open playtest reports; not independently reproduced.
- **Priority:** Near-term investigation before substantial map authoring.
- **Reported:** 2026-09-15, during the transition to saved JSON arena loading.
- **Route:** `?arena=navigation&renderer=3d`, developer tools/navigation view open.
- **Context:** Ground-to-second-floor elevator travel. Exact seed, enemy IDs,
  AI state/evidence, selected debug tool, and map revision were not captured.
  The saved navigation map now permits a single urchin to simplify reproduction.

## NAV-001: Navigation overlay stays on the previous floor

After reaching the second floor, the visible navigation graph does not update
until the player enters/clicks the editor. Refreshing the editor then displays
the graph for the new floor.

Expected: in play mode, the debug graph follows the player's viewed runtime
floor automatically. In edit mode, it follows the selected editor floor.
Opening the editor should not be needed to refresh a play-mode overlay.

Investigation lead: `createNavigationTopologyView()` currently chooses its layer
from `editor.activeLayerId`, and `src/main.js` supplies the editor view in play
mode too. Verify that relationship during a runtime floor handoff; this is a
code observation, not a completed diagnosis or proof that AI state changes.

## NAV-002: Enemies appear to redirect upstairs when the player changes floors

Ground-floor enemies appear to change navigation and head toward the elevator
after the player reaches the second floor. Brief yellow route/goal lines flash
on the grid, and enemies appear to seek a destination they cannot reach directly.
The player suspects the AI is using the viewed floor's navigation graph.

Expected: changing the camera/editor floor cannot retarget an enemy. Each enemy
keeps its own runtime floor and home; cross-floor pursuit must follow the
existing evidence rules and a valid route. A witnessed elevator pursuit may be
correct, so distinguish it from unintended patrol/home changes.

Reproduce with one enemy and compare a player elevator trip with an editor-only
layer change. Capture enemy floor, home floor, perception state, pursuit
evidence, route intent, local goal, and elevator phase before/after each. Include
a trip the enemy cannot witness. Check the overlay independently: a stale or
misfiltered route drawing does not by itself establish a simulation defect.

## Debug readability follow-up

The light-blue triangular graph, purple/pink markers, and transient yellow
lines are difficult to interpret without a legend. Explain authored links,
patrol nodes, elevator endpoints, selected enemy route, and local goal in the
debug UI. Keep this presentation improvement separate from the two behavioral
reports above. Record the active overlay during reproduction because AI View
has additional colors beyond the authored navigation graph.

Acceptance: play-mode floor changes refresh the correct overlay without an
editor toggle; editor-only layer changes leave enemy behavior unchanged; and
cross-floor enemy travel is explained by recorded pursuit/home intent rather
than the debug view's active floor. Verify in a real browser as well as tests.

## NAV-003: AI route-intent inspection is too fleeting and coarse

One playtest briefly showed yellow cell-level route/goal geometry for an enemy
trying to reach a player on another floor through an elevator. It appeared only
once, was not reproduced, and may have been an existing transient debug draw
rather than a rendering defect. The observation is nevertheless useful because
the current view does not make it possible to inspect how an individual enemy
selected, followed, failed, or abandoned its route.

Investigate a read-only navigation-inspection mode under AI View (or a clearly
paired navigation panel). For the selected enemy, it should persistently show a
thin world-space route line or ordered segment chain, rather than only
cell-filling highlights, along with the current local movement goal, intended
target/home, route status, and relevant connector/layer transitions. It must
identify unavailable or failed next steps without implying that a path exists.

This is a diagnostics and reproduction aid, not permission to add a general
navmesh or let UI/debug state influence simulation. It should remain bounded,
read-only, deterministic for a recorded state, separated from authored graph
geometry, and concealed/visible according to an explicit debug policy.
