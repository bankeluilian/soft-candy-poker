import fs from "node:fs";
import { spawnSync } from "node:child_process";

for (const generated of ["app/legal-notice.js", "app/ai-psychology.js", "app/page.js", "app/poker-core.js", "app/table-config.js"]) {
  if (fs.existsSync(generated)) fs.unlinkSync(generated);
}

let status = 1;
try {
  const result = spawnSync(process.execPath, ["node_modules/vinext/dist/cli.js", "build"], { stdio: "inherit" });
  status = result.status ?? 1;
} finally {
  const preview = spawnSync(process.execPath, ["scripts/build-preview.mjs"], { stdio: "inherit" });
  if (status === 0 && preview.status !== 0) status = preview.status ?? 1;
}

process.exit(status);
