import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the legal consent gate before mounting the game", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>软糖扑克 · 纯虚拟筹码德州扑克<\/title>/i);
  assert.match(html, /使用规则与免责声明/);
  assert.match(html, /仅供娱乐，严禁赌博/);
  assert.match(html, /同意规则并进入/);
  assert.match(html, /不同意，停止使用/);
  assert.match(html, /type="checkbox"/);
  assert.doesNotMatch(html, /type="checkbox"[^>]*checked/);
  assert.match(html, /<button[^>]*disabled[^>]*>同意规则并进入/);
  assert.doesNotMatch(html, />\s*(登录|注册)\s*</i);
  assert.doesNotMatch(html, /Building your site|Your site is taking shape/i);
});

test("keeps realtime rooms, deterministic dealing, and offline fallback wired", async () => {
  const [page, server, css, packageText] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../realtime-server.mjs", import.meta.url), "utf8"),
    readFile(new URL("../app/globals.css", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  const packageJson = JSON.parse(packageText);

  assert.equal(packageJson.scripts.preview, "node realtime-server.mjs");
  assert.equal(packageJson.dependencies.ws, "8.18.0");
  assert.match(page, /function useRealtimeRoom\(/);
  assert.match(page, /create_room/);
  assert.match(page, /join_room/);
  assert.match(page, /toggle_ready/);
  assert.match(page, /new URLSearchParams\(window\.location\.search\)/);
  assert.match(page, /poker-core/);
  assert.match(page, /dealRandomHand\(seed\)/);
  assert.match(page, /当前使用离线好友房/);
  assert.match(page, /modal === "resetHistory"/);
  assert.match(page, /牌局记录与战绩统计已重置/);
  assert.match(page, /筹码、任务、装扮、设置与游客身份/);
  assert.doesNotMatch(page, /chat-button|快捷聊天/);

  assert.match(server, /new WebSocketServer/);
  assert.match(server, /message\.type === "start_room"/);
  assert.match(server, /message\.type === "leave_room"/);
  assert.match(server, /}, 30000\)/);
  assert.match(css, /\.room-live/);
  assert.match(css, /\.waiting-seat\.offline/);
  assert.match(css, /realtime-connecting/);
});
