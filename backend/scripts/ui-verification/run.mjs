// Component-level UI verification (jsdom — NOT a real browser) of the shared doctor location
// fields against a RUNNING backend with LGD data imported. Not part of `npm test`.
//   npm i --no-save jsdom esbuild   (from repo root)   then   node backend/scripts/ui-verification/run.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const out = path.join(here, ".out.mjs");
await build({
  entryPoints: [path.join(here, "locationFields.harness.jsx")], bundle: true, format: "esm", platform: "node", outfile: out, jsx: "automatic",
  nodePaths: [path.join(repo, "node_modules")], logLevel: "error",
  plugins: [{ name: "shim", setup(b) { b.onResolve({ filter: /api\/masterDataApi$/ }, () => ({ path: path.join(here, "apiShim.js") })); } }],
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
const dom = new JSDOM('<!doctype html><div id="root"></div>', { pretendToBeVisual: true });
for (const k of ["window", "document", "navigator", "HTMLElement", "Node"]) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
await import(out);
