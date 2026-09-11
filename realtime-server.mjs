import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, WebSocket } from "ws";

const ROOT = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.POKER_PORT || 4173);
const HOST = process.env.POKER_HOST || "127.0.0.1";
const rooms = new Map();
const guests = new Map();
const sockets = new Map();

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".ico": "image/x-icon",
};

// Strip control characters from untrusted room/profile labels.
// eslint-disable-next-line no-control-regex
const cleanText = (value, fallback, length = 18) => String(value || fallback).replace(/[<>\u0000-\u001f]/g, "").trim().slice(0, length) || fallback;
const roomCode = () => {
  let code;
  do code = String(Math.floor(100000 + Math.random() * 900000)); while (rooms.has(code));
  return code;
};
const send = (socket, payload) => {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(payload));
};
const publicRoom = (room) => ({
  code: room.code,
  name: room.name,
  ownerId: room.ownerId,
  status: room.status,
  settings: room.settings,
  members: room.members.map((member) => ({
    id: member.id,
    name: member.name,
    avatar: member.avatar,
    ready: member.ready,
    connected: member.connected,
    seat: member.seat,
  })),
});
const broadcastRoom = (room, type = "room_state", extra = {}) => {
  const payload = { type, room: publicRoom(room), ...extra };
  room.members.forEach((member) => send(guests.get(member.id)?.socket, payload));
};
const broadcastPresence = () => {
  const online = [...guests.values()].filter((guest) => guest.socket?.readyState === WebSocket.OPEN).length;
  sockets.forEach((guest, socket) => send(socket, { type: "presence", online }));
};
const leaveRoom = (guestId, notify = true) => {
  const guest = guests.get(guestId);
  if (!guest?.roomCode) return;
  const room = rooms.get(guest.roomCode);
  guest.roomCode = null;
  if (!room) return;
  room.members = room.members.filter((member) => member.id !== guestId);
  if (!room.members.length) {
    rooms.delete(room.code);
    return;
  }
  if (room.ownerId === guestId) {
    room.ownerId = room.members[0].id;
    room.members[0].ready = true;
  }
  room.members.forEach((member, seat) => { member.seat = seat; });
  if (notify) broadcastRoom(room);
};

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
    if (url.pathname === "/health") {
      const body = JSON.stringify({ ok: true, rooms: rooms.size, online: [...guests.values()].filter((guest) => guest.connected).length });
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Length": Buffer.byteLength(body) });
      response.end(body);
      return;
    }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname === "/") pathname = "/index.html";
    if (pathname === "/preview.css") {
      const css = (await readFile(resolve(ROOT, "app/globals.css"), "utf8")).replace('@import "tailwindcss";', "");
      response.writeHead(200, { "Content-Type": mime[".css"], "Content-Length": Buffer.byteLength(css) });
      response.end(css);
      return;
    }
    if (!(["/index.html", "/preview-entry.js", "/app/page.js", "/app/poker-core.js", "/app/table-config.js", "/app/ai-psychology.js", "/app/legal-notice.js"].includes(pathname) || pathname.startsWith("/poker-assets/"))) throw new Error("Not public");
    const assetRequest = pathname.startsWith("/poker-assets/");
    if (assetRequest) pathname = `/public${pathname}`;
    const target = resolve(ROOT, `.${pathname}`);
    const allowedRoot = assetRequest ? resolve(ROOT, "public/poker-assets") : ROOT;
    const within = relative(allowedRoot, target);
    if (within.startsWith("..") || isAbsolute(within)) throw new Error("Invalid path");
    const body = await readFile(target);
    response.writeHead(200, { "Content-Type": mime[extname(target).toLowerCase()] || "application/octet-stream", "Content-Length": body.length, "Cache-Control": "no-store" });
    response.end(body);
  } catch {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 8192 });
server.on("upgrade", (request, socket, head) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname !== "/ws") return socket.destroy();
  if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}` && request.headers.origin !== `https://${request.headers.host}`) return socket.destroy();
  wss.handleUpgrade(request, socket, head, (client) => wss.emit("connection", client, request));
});

wss.on("connection", (socket) => {
  socket.isAlive = true;
  socket.on("pong", () => { socket.isAlive = true; });
  send(socket, { type: "connected", protocol: 1 });
  socket.on("message", (raw) => {
    let message;
    try { message = JSON.parse(String(raw)); } catch { return send(socket, { type: "error", message: "消息格式不正确" }); }
    if (!message || typeof message !== "object" || Array.isArray(message)) return send(socket, { type: "error", message: "消息格式不正确" });
    if (message.type === "hello") {
      if (sockets.has(socket)) return send(socket, { type: "error", message: "会话已建立" });
      const id = cleanText(message.id, `guest-${Date.now()}`, 48);
      const previous = guests.get(id);
      if (previous?.removeTimer) clearTimeout(previous.removeTimer);
      if (previous?.socket && previous.socket !== socket) previous.socket.close(4001, "Reconnected");
      const guest = {
        id,
        name: cleanText(message.name, "游客玩家"),
        avatar: cleanText(message.avatar, "avatar-player-cream-bear.webp", 64),
        socket,
        connected: true,
        roomCode: previous?.roomCode || null,
        removeTimer: null,
      };
      guests.set(id, guest);
      sockets.set(socket, guest);
      send(socket, { type: "hello", guest: { id: guest.id, name: guest.name, avatar: guest.avatar } });
      if (guest.roomCode) {
        const room = rooms.get(guest.roomCode);
        const member = room?.members.find((item) => item.id === id);
        if (member) {
          member.connected = true;
          if (room.status === "playing") send(socket, { type: "game_start", room: publicRoom(room), seed: room.seed, reconnected: true });
          else broadcastRoom(room, "room_state", { reconnected: true });
        }
      }
      broadcastPresence();
      return;
    }
    const guest = sockets.get(socket);
    if (!guest) return send(socket, { type: "error", message: "请先建立游客会话" });
    if (message.type === "ping") return send(socket, { type: "pong", at: Number(message.at || Date.now()) });
    if (message.type === "create_room") {
      leaveRoom(guest.id);
      const code = roomCode();
      const room = {
        code,
        name: cleanText(message.name, `${guest.name}的牌桌`, 24),
        ownerId: guest.id,
        status: "waiting",
        settings: {
          blind: cleanText(message.settings?.blind, "50/100", 12),
          buy: cleanText(message.settings?.buy, "5,000～20,000", 24),
          seconds: cleanText(message.settings?.seconds, "20 秒", 12),
          allowAi: message.settings?.allowAi !== false,
        },
        members: [{ id: guest.id, name: guest.name, avatar: guest.avatar, ready: true, connected: true, seat: 0 }],
      };
      rooms.set(code, room);
      guest.roomCode = code;
      broadcastRoom(room);
      return;
    }
    if (message.type === "join_room") {
      const code = cleanText(message.code, "", 6);
      const room = rooms.get(code);
      if (!room) return send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: "没有找到这个房间" });
      if (guest.roomCode === code) return broadcastRoom(room);
      if (room.status !== "waiting") return send(socket, { type: "error", message: "牌局已经开始" });
      if (room.members.length >= 6) return send(socket, { type: "error", message: "房间已满" });
      leaveRoom(guest.id);
      const existing = room.members.find((member) => member.id === guest.id);
      if (existing) existing.connected = true;
      else room.members.push({ id: guest.id, name: guest.name, avatar: guest.avatar, ready: false, connected: true, seat: room.members.length });
      guest.roomCode = room.code;
      broadcastRoom(room);
      return;
    }
    const room = guest.roomCode ? rooms.get(guest.roomCode) : null;
    if (!room) return send(socket, { type: "error", message: "当前不在房间中" });
    if (message.type === "toggle_ready") {
      const member = room.members.find((item) => item.id === guest.id);
      if (member && guest.id !== room.ownerId) member.ready = Boolean(message.ready);
      broadcastRoom(room);
      return;
    }
    if (message.type === "start_room") {
      if (guest.id !== room.ownerId) return send(socket, { type: "error", message: "只有房主可以开始牌局" });
      if (room.status !== "waiting") return send(socket, { type: "error", message: "牌局已经开始" });
      const ready = room.members.every((member) => member.ready && member.connected);
      if (!ready) return send(socket, { type: "error", message: "还有玩家没有准备" });
      if (!room.settings.allowAi) return send(socket, { type: "error", message: "当前仅支持 AI 训练，请启用 AI 后创建房间" });
      room.status = "playing";
      room.seed = `${room.code}-${Date.now()}`;
      broadcastRoom(room, "game_start", { seed: room.seed });
      return;
    }
    if (message.type === "leave_room") leaveRoom(guest.id);
  });

  socket.on("close", () => {
    const guest = sockets.get(socket);
    sockets.delete(socket);
    const activeGuest = guest ? guests.get(guest.id) : null;
    if (!activeGuest || activeGuest.socket !== socket) return;
    activeGuest.connected = false;
    const room = activeGuest.roomCode ? rooms.get(activeGuest.roomCode) : null;
    const member = room?.members.find((item) => item.id === activeGuest.id);
    if (member) { member.connected = false; broadcastRoom(room); }
    activeGuest.removeTimer = setTimeout(() => {
      leaveRoom(activeGuest.id);
      guests.delete(activeGuest.id);
      broadcastPresence();
    }, 30000);
    broadcastPresence();
  });
});

const heartbeat = setInterval(() => {
  wss.clients.forEach((socket) => {
    if (socket.isAlive === false) return socket.terminate();
    socket.isAlive = false;
    socket.ping();
  });
}, 15000);
wss.on("close", () => clearInterval(heartbeat));

server.listen(PORT, HOST, () => {
  console.log(`Cream Poker realtime preview: http://${HOST}:${server.address().port}`);
});
