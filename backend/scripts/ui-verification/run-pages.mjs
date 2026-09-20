// Page-level UI verification (jsdom — NOT a real browser): mounts the REAL DoctorProfessionalProfile and
// DoctorOnboarding pages with the real API client against a RUNNING backend as a pending dev doctor.
//   npm i --no-save jsdom esbuild   then   MONGO_URI=... node backend/scripts/ui-verification/run-pages.mjs
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { api, dbConnect, registerDevDoctor } from "../runtime-verification/lib.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const out = path.join(here, ".out-pages.mjs");
const API = process.env.API_BASE || "http://127.0.0.1:5000/api";
const m = await dbConnect();
const tag = `ui-${Date.now().toString(36)}`;
const doctor = await registerDevDoctor(m, tag);
await m.disconnect();

await build({
  entryPoints: [path.join(here, "doctorForms.harness.jsx")], bundle: true, format: "esm", platform: "node", outfile: out, jsx: "automatic",
  nodePaths: [path.join(repo, "node_modules")], logLevel: "error",
  define: { "import.meta.env": JSON.stringify({ VITE_API_BASE_URL: API, PROD: false, DEV: true, MODE: "test" }) },
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
});
const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: "http://localhost:5173/", pretendToBeVisual: true });
for (const k of ["window", "document", "navigator", "HTMLElement", "Node", "XMLHttpRequest", "localStorage", "Event", "FormData", "File", "Blob", "URLSearchParams"]) {
  if (dom.window[k] !== undefined) Object.defineProperty(globalThis, k, { value: dom.window[k], configurable: true, writable: true });
}
dom.window.localStorage.setItem("hms_token", doctor.token);
dom.window.localStorage.setItem("hms_user", JSON.stringify(doctor.user));
await import(out);
