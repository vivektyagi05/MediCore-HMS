import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

// Non-sensitive build identifier: lets you tell which build a deployed site is
// actually serving (window.__MEDICORE_BUILD__ in the browser console, also the
// <meta name="medicore-build"> tag) and which API host it was built against.
const build = { version, builtAt: new Date().toISOString() };

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: { __MEDICORE_BUILD__: JSON.stringify(build) },
});
