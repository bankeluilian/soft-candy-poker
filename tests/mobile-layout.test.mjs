import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

const source = await readFile(new URL("../app/mobile-layout.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } });
const { mobileTableLayout, tableLocalCenter } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("portrait and landscape phones share the same landscape canvas", () => {
  const portrait = mobileTableLayout(390, 844);
  const landscape = mobileTableLayout(844, 390);
  assert.deepEqual(portrait, { width: 844, height: 390, scale: 1, rotated: true });
  assert.deepEqual(landscape, { ...portrait, rotated: false });
});

test("small phone canvas fits both dimensions without squeezing the seat layout", () => {
  for (const [width, height] of [[320, 568], [375, 667]]) {
    const layout = mobileTableLayout(width, height);
    assert.ok(layout.width >= 740 && layout.height >= 390);
    assert.ok(Math.abs(layout.width * layout.scale - height) < .01);
    assert.ok(Math.abs(layout.height * layout.scale - width) < .01);
  }
  assert.equal(mobileTableLayout(1440, 900), null);
  assert.equal(mobileTableLayout(0, 844), null);
});

test("chip animation coordinates account for scale and a rotated phone canvas", () => {
  assert.deepEqual(tableLocalCenter(
    { left: 50, top: 40, right: 70, width: 20, height: 10 },
    { left: 10, top: 20, right: 210, width: 200, height: 100 }, .5,
  ), { x: 100, y: 50 });
  assert.deepEqual(tableLocalCenter(
    { left: 70, top: 60, right: 90, width: 20, height: 20 },
    { left: 10, top: 20, right: 110, width: 100, height: 200 }, .5, true,
  ), { x: 100, y: 60 });
});
