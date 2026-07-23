import test from "node:test";
import assert from "node:assert/strict";

import {
  developmentRoutes,
  listLanIpv4Addresses,
  parseServeOptions,
  startupMessages,
} from "../scripts/serve_options.mjs";

test("server arguments preserve environment compatibility and allow cross-platform overrides", () => {
  assert.deepEqual(parseServeOptions([], {}), {
    host: "127.0.0.1",
    port: 4173,
  });
  assert.deepEqual(parseServeOptions([], { HOST: "10.0.0.5", PORT: "9000" }), {
    host: "10.0.0.5",
    port: 9000,
  });
  assert.deepEqual(
    parseServeOptions(
      ["--host", "0.0.0.0", "--port=5000"],
      { HOST: "127.0.0.1", PORT: "4173" },
    ),
    { host: "0.0.0.0", port: 5000 },
  );
  assert.deepEqual(
    parseServeOptions(["--host=::", "--port", "8080"], {}),
    { host: "::", port: 8080 },
  );
});

test("server arguments reject unknown, missing, and invalid values", () => {
  assert.throws(() => parseServeOptions(["--wat"], {}), /Unknown/);
  assert.throws(() => parseServeOptions(["--host"], {}), /requires a value/);
  assert.throws(() => parseServeOptions(["--port", "0"], {}), /1 to 65535/);
  assert.throws(() => parseServeOptions([], { PORT: "abc" }), /1 to 65535/);
});

test("LAN address enumeration returns unique non-loopback IPv4 routes", () => {
  assert.deepEqual(
    listLanIpv4Addresses({
      lo: [
        { address: "127.0.0.1", family: "IPv4", internal: true },
        { address: "::1", family: "IPv6", internal: true },
      ],
      wifi: [
        { address: "192.168.1.50", family: "IPv4", internal: false },
        { address: "fe80::1", family: "IPv6", internal: false },
      ],
      duplicate: [
        { address: "192.168.1.50", family: 4, internal: false },
        { address: "10.0.0.8", family: 4, internal: false },
      ],
    }),
    ["10.0.0.8", "192.168.1.50"],
  );
});

test("printed network routes are phone-ready and include the unauthenticated-LAN warning", () => {
  const lines = startupMessages({
    version: "0.3.3",
    host: "0.0.0.0",
    port: 4173,
    lanAddresses: ["192.168.1.50"],
  });
  const output = lines.join("\n");
  assert.match(output, /Lantern 0\.3\.3/);
  assert.match(output, /http:\/\/192\.168\.1\.50:4173\/\?renderer=2d/);
  assert.match(output, /http:\/\/192\.168\.1\.50:4173\/\?renderer=3d/);
  assert.match(
    output,
    /http:\/\/192\.168\.1\.50:4173\/\?renderer=3d&backend=webgl/,
  );
  assert.match(output, /no authentication/i);
  assert.match(output, /secure context/i);

  assert.deepEqual(developmentRoutes("::1", 4173), {
    canvas2d: "http://[::1]:4173/?renderer=2d",
    automatic3d: "http://[::1]:4173/?renderer=3d",
    forcedWebgl2: "http://[::1]:4173/?renderer=3d&backend=webgl",
  });
});
