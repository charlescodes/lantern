import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveCastSeed,
  deriveSampleSeed,
  laneUint32,
  laneUnit,
} from "../src/spells/random.js";

test("automatic cast and semantic random lanes have pinned uint32 fixtures", () => {
  assert.equal(deriveCastSeed(0x12345678, 1, 0), 2_025_247_103);
  assert.equal(deriveCastSeed(0x12345678, 1, 1), 2_089_413_058);
  assert.equal(deriveCastSeed(0x12345678, 2, 0), 656_920_599);
  const sampleSeed = deriveSampleSeed(0xfeedc0de, 17);
  assert.equal(sampleSeed, 3_148_008_485);
  assert.deepEqual(
    {
      angle: laneUint32(sampleSeed, "angle"),
      speed: laneUint32(sampleSeed, "speed"),
      bias: laneUint32(sampleSeed, "bias"),
      vertical: laneUint32(sampleSeed, "vertical"),
      lifetime: laneUint32(sampleSeed, "lifetime"),
      size: laneUint32(sampleSeed, "size"),
      hue: laneUint32(sampleSeed, "hue"),
      brightness: laneUint32(sampleSeed, "brightness"),
    },
    {
      angle: 2_365_162_161,
      speed: 1_987_894_641,
      bias: 3_733_826_566,
      vertical: 3_522_543_187,
      lifetime: 2_082_414_124,
      size: 3_793_542_576,
      hue: 1_342_414_316,
      brightness: 420_634_563,
    },
  );
});

test("each lane is pure and adding reads cannot perturb any other lane", () => {
  const seed = deriveSampleSeed(99, 7);
  const before = laneUnit(seed, "lifetime");
  for (const lane of ["angle", "speed", "bias", "vertical", "size", "hue", "brightness"]) {
    laneUnit(seed, lane);
  }
  assert.equal(laneUnit(seed, "lifetime"), before);
  assert.notEqual(laneUnit(seed, "angle"), laneUnit(seed, "speed"));
  assert.throws(() => laneUnit(seed, "future"), /Unknown random lane/);
});
