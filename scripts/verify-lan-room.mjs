import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { preview } from "vite";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const base = "/soft-candy-poker/";
const server = await preview({ configFile: "vite.static.config.ts", base, preview: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  const { port } = server.httpServer.address();
  const origin = "http://127.0.0.1:" + port;
  browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
  const pages = [];
  const errors = [];
  const external = [];
  for (const viewport of [{ width: 1180, height: 800 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport });
    await context.route("**/*", (route) => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      external.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(6000);
    if (pages.length === 0) await page.clock.install();
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("websocket", (socket) => external.push(socket.url()));
    await page.goto(origin + base);
    await page.getByRole("checkbox").check();
    await page.getByRole("button", { name: "同意规则并进入" }).click();
    await page.getByRole("button", { name: "和好友同桌", exact: true }).click();
    pages.push(page);
  }

  const [host, guest] = pages;
  await host.getByRole("button", { name: "创建双人房" }).click();
  await guest.getByRole("button", { name: "加入双人房" }).click();
  await guest.getByLabel("好友的邀请信息").fill("无效信息");
  await guest.getByRole("button", { name: "生成应答" }).click();
  await guest.getByRole("alert").getByText("配对信息格式不正确", { exact: false }).waitFor();
  await guest.getByLabel("好友的邀请信息").fill(await host.getByLabel("我的邀请信息").inputValue());
  await guest.getByRole("button", { name: "生成应答" }).click();
  await host.getByLabel("好友的应答信息").fill(await guest.getByLabel("我的应答信息").inputValue());
  await host.getByRole("button", { name: "连接好友" }).click();
  await host.getByRole("button", { name: "开始对战" }).click();
  await guest.getByText("第 1 手", { exact: true }).waitFor();
  assert.equal(await guest.getByRole("group", { name: "你的底牌" }).locator("img").count(), 2);
  assert.equal(await guest.getByRole("group", { name: "好友底牌" }).locator("img").count(), 0);
  await host.getByRole("button", { name: "跟注 50", exact: true }).click();
  await guest.getByRole("button", { name: "过牌", exact: true }).click();
  const community = (page) => page.getByRole("group", { name: "公共牌" });
  await host.getByText("翻牌圈", { exact: true }).waitFor();
  const cards = (page) => community(page).locator("img").evaluateAll((images) => images.map((image) => image.alt));
  assert.deepEqual(await cards(host), await cards(guest));
  assert.equal((await cards(host)).length, 3);

  await guest.getByRole("button", { name: "弃牌", exact: true }).click();
  await host.getByText("你赢得底池", { exact: true }).waitFor();
  await guest.getByText("好友赢得底池", { exact: true }).waitFor();
  await host.getByRole("button", { name: "下一手" }).click();
  await guest.getByText("第 2 手", { exact: true }).waitFor();
  assert.ok(await guest.getByRole("button", { name: "跟注 50", exact: true }).isEnabled());
  assert.equal(await guest.locator(".lan-room").evaluate((element) => element.scrollWidth > element.clientWidth + 1), false);
  await host.clock.fastForward(20500);
  await host.getByText("你赢得底池", { exact: true }).waitFor();
  await guest.getByText("好友赢得底池", { exact: true }).waitFor();
  await host.getByRole("button", { name: "退出对战", exact: true }).click();
  await host.getByRole("button", { name: "确认退出" }).click();
  await guest.getByText("连接已断开", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log("PASS Pages subpath: two browser contexts paired, shared a live hand and settlement, rotated dealer, enforced the turn deadline, and disconnected cleanly.");
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
