import { WebSocket } from "ws";

const endpoint = process.env.POKER_WS || "ws://127.0.0.1:4173/ws";

function openGuest(id, name) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(endpoint);
    const messages = [];
    const pending = [];
    const timeout = setTimeout(() => reject(new Error(`${name} 连接超时`)), 5000);
    const waitFor = (test, label) => new Promise((done, fail) => {
      const existing = messages.find(test);
      if (existing) return done(existing);
      const timer = setTimeout(() => fail(new Error(`${name} 等待 ${label} 超时`)), 5000);
      pending.push({ test, done: (message) => { clearTimeout(timer); done(message); } });
    });
    socket.on("message", (raw) => {
      const message = JSON.parse(String(raw));
      messages.push(message);
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        if (pending[index].test(message)) pending.splice(index, 1)[0].done(message);
      }
    });
    socket.once("error", reject);
    socket.once("open", async () => {
      clearTimeout(timeout);
      socket.send(JSON.stringify({ type: "hello", id, name, avatar: "avatar-player-cream-bear.webp" }));
      await waitFor((message) => message.type === "hello", "游客会话");
      resolve({ socket, messages, waitFor });
    });
  });
}

const runId = Date.now();
const ownerId = `owner-${runId}`;
const guestId = `guest-${runId}`;
const owner = await openGuest(ownerId, "房主测试员");
const guest = await openGuest(guestId, "加入测试员");

owner.socket.send(JSON.stringify({ type: "create_room", name: "联机验收桌", settings: { blind: "50/100", buy: "5,000", seconds: "20 秒", allowAi: false } }));
const created = await owner.waitFor((message) => message.type === "room_state" && message.room?.name === "联机验收桌", "创建房间");
const code = created.room.code;

guest.socket.send(JSON.stringify({ type: "join_room", code }));
await Promise.all([
  owner.waitFor((message) => message.type === "room_state" && message.room?.members?.length === 2, "成员加入同步"),
  guest.waitFor((message) => message.type === "room_state" && message.room?.members?.length === 2, "加入房间"),
]);

guest.socket.send(JSON.stringify({ type: "toggle_ready", ready: true }));
await owner.waitFor((message) => message.type === "room_state" && message.room?.members?.every((member) => member.ready), "准备状态同步");

owner.socket.send(JSON.stringify({ type: "start_room" }));
const [ownerStart, guestStart] = await Promise.all([
  owner.waitFor((message) => message.type === "game_start", "开始牌局"),
  guest.waitFor((message) => message.type === "game_start", "开始牌局同步"),
]);

if (!ownerStart.seed || ownerStart.seed !== guestStart.seed) throw new Error("两端牌局种子不一致");

await new Promise((resolve) => {
  guest.socket.once("close", resolve);
  guest.socket.close();
});
const resumedGuest = await openGuest(guestId, "回座测试员");
const resumed = await resumedGuest.waitFor((message) => message.type === "game_start" && message.reconnected, "断线回座");
if (resumed.seed !== ownerStart.seed) throw new Error("回座后的牌局种子不一致");

owner.socket.send(JSON.stringify({ type: "leave_room" }));
await resumedGuest.waitFor((message) => message.type === "room_state" && message.room?.ownerId === guestId, "房主迁移");
resumedGuest.socket.send(JSON.stringify({ type: "leave_room" }));

console.log(JSON.stringify({ ok: true, room: code, members: 2, seed: ownerStart.seed, reconnected: true }));
await Promise.all([owner, resumedGuest].map(({ socket }) => new Promise((resolve) => {
  socket.once("close", resolve);
  socket.close();
})));
