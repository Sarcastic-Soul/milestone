import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts"],
  platform: "node",
  target: "node22",
  format: "esm",
  // Bundle workspace code; leave real npm packages in node_modules.
  deps: { alwaysBundle: [/^@milestone\//] },
});
