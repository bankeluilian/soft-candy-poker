import { copyFile, rename, writeFile } from "node:fs/promises";
import { build } from "vite";

await build({ configFile: "vite.static.config.ts" });
await rename("docs/static-index.html", "docs/index.html");
await copyFile("docs/index.html", "docs/404.html");
await writeFile("docs/.nojekyll", "");

console.log("GitHub Pages static site generated in docs/");
