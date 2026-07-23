const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 4173;

/** @param {unknown} value @param {string} source */
function parsePort(value, source) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new RangeError(`${source} must be an integer from 1 to 65535`);
  }
  return port;
}

/**
 * CLI values override the original HOST/PORT environment contract.
 * @param {string[]} argv
 * @param {Record<string,string|undefined>} [environment]
 */
export function parseServeOptions(argv, environment = process.env) {
  let host = environment.HOST || DEFAULT_HOST;
  let port = environment.PORT
    ? parsePort(environment.PORT, "PORT")
    : DEFAULT_PORT;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--host") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new TypeError("--host requires a value");
      }
      host = value;
      index += 1;
      continue;
    }
    if (argument.startsWith("--host=")) {
      host = argument.slice("--host=".length);
      if (!host) throw new TypeError("--host requires a value");
      continue;
    }
    if (argument === "--port") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new TypeError("--port requires a value");
      }
      port = parsePort(value, "--port");
      index += 1;
      continue;
    }
    if (argument.startsWith("--port=")) {
      port = parsePort(argument.slice("--port=".length), "--port");
      continue;
    }
    throw new TypeError(`Unknown server argument: ${argument}`);
  }
  return { host, port };
}

/**
 * @param {Record<string,Array<{address:string,family:string|number,internal:boolean}>|undefined>} interfaces
 */
export function listLanIpv4Addresses(interfaces) {
  const addresses = new Set();
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      const ipv4 = entry.family === "IPv4" || entry.family === 4;
      if (!ipv4 || entry.internal || !entry.address) continue;
      addresses.add(entry.address);
    }
  }
  return [...addresses].sort((left, right) => left.localeCompare(right));
}

/** @param {string} host */
function urlHost(host) {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

/** @param {string} host @param {number} port */
export function developmentRoutes(host, port) {
  const baseUrl = `http://${urlHost(host)}:${port}/`;
  return Object.freeze({
    canvas2d: new URL("?renderer=2d", baseUrl).href,
    automatic3d: new URL("?renderer=3d", baseUrl).href,
    forcedWebgl2: new URL("?renderer=3d&backend=webgl", baseUrl).href,
  });
}

/** @param {string} host */
export function exposesLan(host) {
  return host === "0.0.0.0"
    || host === "::"
    || host === "[::]"
    || (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(host));
}

/**
 * @param {{version:string,host:string,port:number,lanAddresses:string[]}} options
 */
export function startupMessages(options) {
  const routeHosts = [];
  if (options.host === "0.0.0.0" || options.host === "::" || options.host === "[::]") {
    routeHosts.push({ label: "This device", host: "127.0.0.1" });
    for (const address of options.lanAddresses) {
      routeHosts.push({ label: "LAN / phone", host: address });
    }
  } else {
    routeHosts.push({
      label: exposesLan(options.host) ? "LAN / phone" : "This device",
      host: options.host,
    });
  }

  const lines = [`Lantern ${options.version} development routes:`];
  for (const routeHost of routeHosts) {
    const routes = developmentRoutes(routeHost.host, options.port);
    lines.push(`  ${routeHost.label} · Canvas2D       ${routes.canvas2d}`);
    lines.push(`  ${routeHost.label} · Automatic 3D    ${routes.automatic3d}`);
    lines.push(`  ${routeHost.label} · Forced WebGL 2  ${routes.forcedWebgl2}`);
  }
  if (
    (options.host === "0.0.0.0" || options.host === "::" || options.host === "[::]")
    && options.lanAddresses.length === 0
  ) {
    lines.push("  No non-loopback LAN IPv4 address was detected.");
  }
  if (exposesLan(options.host)) {
    lines.push("  WARNING: This development server has no authentication. Use a trusted LAN.");
    lines.push("  LAN HTTP phone testing targets WebGL 2; WebGPU requires a secure context.");
  }
  return lines;
}
