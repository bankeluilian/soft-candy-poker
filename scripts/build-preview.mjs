import fs from "node:fs";
import ts from "typescript";

const files = [
  ["app/legal-notice.tsx", "app/legal-notice.js"],
  ["app/ai-psychology.ts", "app/ai-psychology.js"],
  ["app/poker-core.ts", "app/poker-core.js"],
  ["app/table-config.ts", "app/table-config.js"],
  ["app/page.tsx", "app/page.js"],
  ["preview-entry.tsx", "preview-entry.js"],
];

for (const [source, target] of files) {
  const input = fs.readFileSync(source, "utf8");
  const output = ts.transpileModule(input, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: source,
  });
  fs.writeFileSync(target, output.outputText.replace(/from "\.\/(poker-core|table-config|ai-psychology|legal-notice)"/g, 'from "./$1.js"'), "utf8");
}

console.log("Preview files generated.");
