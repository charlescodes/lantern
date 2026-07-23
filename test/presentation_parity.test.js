import test from "node:test";
import assert from "node:assert/strict";

import { PresentationLightBudget } from "../src/presentation/light_budget.js";
import { Simulation } from "../src/sim/simulation.js";

test("2D and 3D presentation consumers leave the same replay snapshot unchanged", () => {
  const source = new Simulation({ seed: 0x3d_2d_51ce, particleBurstCount: 24 });
  for (let tick = 0; tick < 240; tick += 1) {
    source.tick({
      move: tick < 120 ? { x: 19.5, z: 18.5 } : { x: 4.5, z: 5.5 },
      cast: tick % 30 === 0 ? { x: 11.5, z: 19.5 } : null,
    });
  }
  const commandLog = source.exportCommandLog();
  const canvas2dSimulation = Simulation.replay(commandLog);
  const threeSimulation = Simulation.replay(commandLog);
  const canvas2dSnapshot = canvas2dSimulation.snapshot();
  const threeSnapshot = threeSimulation.snapshot();

  const beforeLighting = JSON.stringify(threeSnapshot);
  new PresentationLightBudget().allocate(threeSnapshot);
  assert.equal(JSON.stringify(threeSnapshot), beforeLighting);
  assert.deepEqual(threeSnapshot, canvas2dSnapshot);
});
