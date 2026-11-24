import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = "/soft-candy-poker/";
const url = process.env.POKER_LAN_TEST_URL;
const server = url ? null : await preview({ configFile: "vite.static.config.ts", base, preview: { host: "127.0.0.1", port: 0 } });
const address = url ?? "http://127.0.0.1:" + server.httpServer.address().port + base;
const origin = new URL(address).origin;
let browser;
const errors = [];
const external = [];
const phone = { width: 390, height: 844 };

async function player(viewport = phone, clock = false) {
  const context = await browser.newContext({ viewport });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin === origin) return route.continue();
    external.push(route.request().url());
    return route.abort();
  });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  if (clock) await page.clock.install();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("websocket", (socket) => external.push(socket.url()));
  await page.goto(address);
  await page.getByRole("checkbox").check();
  await button(page, "同意规则并进入").click();
  await button(page, "和好友同桌").click();
  return page;
}

function button(page, name) { return page.getByRole("button", { name, exact: true }); }
function text(page, name) { return page.getByText(name, { exact: true }); }
function group(page, name) { return page.getByRole("group", { name, exact: true }); }

async function pair(host, guest, size, checkInvalid = false) {
  await button(host, size === 2 ? "创建好友房" : "邀请下一位好友").click();
  await button(guest, "加入好友房").click();
  const invite = guest.getByLabel("好友的邀请信息");
  if (checkInvalid) {
    await invite.fill("无效信息");
    await button(guest, "生成应答").click();
    await guest.getByRole("alert").getByText("配对信息格式不正确", { exact: false }).waitFor();
  }
  await invite.fill(await host.getByLabel("我的邀请信息").inputValue());
  await button(guest, "生成应答").click();
  await host.getByLabel("好友的应答信息").fill(await guest.getByLabel("我的应答信息").inputValue());
  await button(host, "连接好友").click();
  for (const page of [host, guest]) await text(page, size + " / 6 人已连接").waitFor();
}

async function leave(page) {
  await button(page, "退出对战").click();
  await button(page, "确认退出").click();
}

async function board(page) {
  return group(page, "公共牌").locator("img").evaluateAll((images) => images.map((image) => image.alt));
}

try {
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const host = await player({ width: 1180, height: 800 }, true);
  const guest = await player();
  await pair(host, guest, 2, true);
  await button(host, "开始对战").click();
  await text(guest, "第 1 手").waitFor();
  assert.equal(await group(guest, "你的底牌").locator("img").count(), 2);
  assert.equal(await group(guest, "房主底牌").locator("img").count(), 0);
  await button(host, "跟注 50").click();
  await button(guest, "过牌").click();
  await Promise.all([host, guest].map((page) => text(page, "翻牌圈").waitFor()));
  assert.deepEqual(await board(host), await board(guest));
  await button(guest, "弃牌").click();
  await text(host, "你赢得底池").waitFor();
  await text(guest, "好友赢得底池").waitFor();
  await button(host, "下一手").click();
  await text(guest, "第 2 手").waitFor();
  await button(guest, "跟注 50").waitFor();
  await host.clock.fastForward(20500);
  await text(host, "你赢得底池").waitFor();
  await text(guest, "好友赢得底池").waitFor();
  await leave(host);
  await text(guest, "连接已断开").waitFor();
  await Promise.all([host, guest].map((page) => page.context().close()));
  console.log("PASS two players: old heads-up blind order, full turn timeout and host exit.");

  const table = await Promise.all(Array.from({ length: 6 }, (_, index) => player(index ? phone : { width: 1180, height: 800 })));
  const [owner, departing, remaining] = table;
  for (let seat = 1; seat < table.length; seat++) await pair(owner, table[seat], seat + 1);
  await Promise.all(table.map((page) => text(page, "6 / 6 人已连接").waitFor()));
  assert.equal(await button(owner, "邀请下一位好友").count(), 0);
  await button(owner, "开始对战").click();
  await Promise.all(table.map((page) => text(page, "第 1 手").waitFor()));

  const hands = await Promise.all(table.map(async (page) => {
    assert.equal(await page.locator(".lan-opponents img").count(), 0);
    assert.equal(await page.locator(".lan-opponents .lan-seat").count(), 5);
    return group(page, "你的底牌").locator("img").evaluateAll((images) => images.map((image) => image.alt));
  }));
  assert.equal(new Set(hands.flat()).size, 12);
  for (const seat of [3, 4, 5, 0, 1]) await button(table[seat], seat === 1 ? "跟注 50" : "跟注 100").click();
  await button(remaining, "过牌").click();
  await Promise.all(table.map((page) => text(page, "翻牌圈").waitFor()));
  const boards = await Promise.all(table.map(board));
  assert.equal(boards[0].length, 3);
  assert.ok(boards.every((cards) => cards.join() === boards[0].join()));
  assert.equal(await remaining.locator(".lan-room").evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);

  await leave(departing);
  await text(owner, "5 人在线").waitFor();
  await button(remaining, "下注").click();
  for (const seat of [3, 4, 5, 0]) await button(table[seat], "弃牌").click();
  await text(remaining, "你赢得底池").waitFor();
  await text(owner, "好友赢得底池").waitFor();
  await button(owner, "下一手").click();
  await text(remaining, "第 2 手").waitFor();
  assert.equal(await remaining.locator(".lan-opponents .lan-seat").count(), 4);
  assert.equal(await text(remaining, "庄家 你").count(), 1);
  await leave(owner);
  await Promise.all(table.slice(2).map((page) => text(page, "连接已断开").waitFor()));
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS six players: pair individually, agree on bets and boards, continue after a guest leaves, and rotate dealer.");
} finally {
  if (browser) await browser.close();
  if (server) await new Promise((resolve) => server.httpServer.close(resolve));
}
