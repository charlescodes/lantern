# Platform Contract

> **Current through:** Lantern 0.3.1

The engine is browser-first and built with standard JavaScript ES modules, HTML, and CSS. It targets modern desktop browsers, while Node.js is used only for development tooling, dependency management, testing, and the local development server. The core simulation should remain independent of the browser, renderer, and input devices so it can later run in a Web Worker, Node.js server, Electron application, or another host with minimal changes. The prototype runs entirely on the client, but the code preserves a clear boundary between commands, simulation state, and presentation so authoritative multiplayer can be added later without redesigning the engine.
