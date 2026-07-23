import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
const host = process.env.HOST || "127.0.0.1";
const port = Number.parseInt(process.env.PORT || "4173", 10);
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    let filename = resolve(root, `.${pathname}`);
    if (filename !== root && !filename.startsWith(`${root}${sep}`)) {
      response.writeHead(403).end("Forbidden");
      return;
    }
    const info = await stat(filename);
    if (info.isDirectory()) filename = resolve(filename, "index.html");
    const content = await readFile(filename);
    response.writeHead(200, {
      "Content-Type": mimeTypes.get(extname(filename)) || "application/octet-stream",
      "Cache-Control": "no-store",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(content);
  } catch (error) {
    const code = error && typeof error === "object" && "code" in error && error.code === "ENOENT" ? 404 : 500;
    response.writeHead(code, { "Content-Type": "text/plain; charset=utf-8" });
    response.end(code === 404 ? "Not found" : "Internal server error");
  }
}).listen(port, host, () => {
  const baseUrl = `http://${host}:${port}/`;
  console.log(`Lantern ${manifest.version} development routes:`);
  console.log(`  Canvas2D (default)       ${new URL("?renderer=2d", baseUrl)}`);
  console.log(`  3D (automatic backend)  ${new URL("?renderer=3d", baseUrl)}`);
  console.log(`  3D (forced WebGL 2)     ${new URL("?renderer=3d&backend=webgl", baseUrl)}`);
});
