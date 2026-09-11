import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import test from "node:test";
import { WebSocket } from "ws";

test("preview restricts files and room messages preserve readiness and membership", { timeout: 15000 }, async (t) => {
  const server = spawn(process.execPath, ["realtime-server.mjs"], { cwd: new URL("../", import.meta.url), env: { ...process.env, POKER_PORT: "0", POKER_HOST: "127.0.0.1" }, windowsHide: true });
  t.after(async () => { const closed = once(server, "exit"); server.kill(); await closed; });
  const url = await new Promise((resolve, reject) => {
    let output = "";
    server.on("error", reject);
    server.on("exit", (code) => reject(new Error(`Server exited: ${code}`)));
    server.stdout.on("data", (chunk) => { output += chunk; const match = output.match(/http:\/\/127\.0\.0\.1:\d+/); if (match) resolve(match[0]); });
  });
  for (const path of ["/package.json", "/realtime-server.mjs", "/.openai/hosting.json", "/app/page.tsx", "/poker-assets/%2e%2e%5c%2e%2e%5cpackage.json"]) {
    assert.equal((await fetch(`${url}${path}`)).status, 404, path);
  }
  assert.equal((await fetch(url)).status, 200);
  async function connect(id) {
    const ws = new WebSocket(url.replace("http", "ws") + "/ws");
    t.after(() => ws.terminate());
    const queue = [];
    const waiters = [];
    ws.on("message", (data) => { const message = JSON.parse(String(data)); const index = waiters.findIndex((w) => w.type === message.type); if (index >= 0) waiters.splice(index, 1)[0].resolve(message); else queue.push(message); });
    const next = (type) => {
      const index = queue.findIndex((m) => m.type === type);
      if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve) => waiters.push({ type, resolve }));
    };
    await once(ws, "open");
    const send = (data) => ws.send(JSON.stringify(data));
    send({ type: "hello", id }); await next("hello");
    return { send, next };
  }
  const owner = await connect("owner-test");
  owner.send(null); assert.match((await owner.next("error")).message, /格式/);
  owner.send({ type: "create_room" });
  const { room } = await owner.next("room_state");
  owner.send({ type: "join_room", code: room.code });
  assert.equal((await owner.next("room_state")).room.members.length, 1);
  assert.equal((await (await fetch(`${url}/health`)).json()).rooms, 1);
  const friend = await connect("friend-test");
  friend.send({ type: "join_room", code: room.code });
  await friend.next("room_state"); await owner.next("room_state");
  owner.send({ type: "start_room" });
  assert.match((await owner.next("error")).message, /没有准备/);
  friend.send({ type: "toggle_ready", ready: true });
  await friend.next("room_state"); await owner.next("room_state");
  owner.send({ type: "start_room" });
  const [a,b] = await Promise.all([owner.next("game_start"), friend.next("game_start")]);
  assert.equal(a.seed, b.seed);
  assert.equal(a.room.members.length, 2);
});
