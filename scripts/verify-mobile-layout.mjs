import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { preview } from "vite";

// Optional browser regression check: set PLAYWRIGHT_MODULE when Playwright is supplied by the host.
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const server = await preview({ configFile: "vite.static.config.ts", preview: { host: "127.0.0.1", port: 0 } });
const address = server.httpServer.address();
const browser = await chromium.launch({ headless: true, channel: process.env.BROWSER_CHANNEL || undefined });
await mkdir("outputs/mobile-layout", { recursive: true });
const failures = [];
try {
  for (const [width, height] of [[390, 844], [844, 390], [667, 375], [568, 320], [932, 430]]) {
    const context = await browser.newContext({ viewport: { width, height }, isMobile: true, hasTouch: true });
    // Isolated test-user consent and preferences, never the user's browser profile.
    await context.addInitScript(() => {
      localStorage.setItem("poker-terms-acceptance", JSON.stringify({ version: "2026-09-11.1", accepted: true, acceptedAt: Date.now() }));
      localStorage.setItem("poker-mvp-state", JSON.stringify({ settings: { musicEnabled: false, effects: 0, dealAnimation: false, skipRepeat: true } }));
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole("button", { name: /开始一局/ }).click();
    await page.locator(".table-screen").waitFor({ timeout: 20000 });
    await page.screenshot({ path: `outputs/mobile-layout/${width}x${height}-table.png` });
    const geometry = await page.evaluate(() => {
      const app = document.querySelector(".game-app");
      const rect = (e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height }; };
      const intersects = (a, b) => a.x < b.right - 1 && a.right > b.x + 1 && a.y < b.bottom - 1 && a.bottom > b.y + 1;
      const buttons = [...document.querySelectorAll(".table-head-actions button")].filter(e => getComputedStyle(e).display !== "none").map(rect);
      const avatars = [...document.querySelectorAll(".table-seat > img")].map(rect);
      const collisions = [];
      for (const [kind, boxes] of [["toolbar", buttons], ["avatars", avatars]]) {
        boxes.forEach((a, i) => boxes.slice(i + 1).forEach((b, j) => { if (intersects(a, b)) collisions.push(`${kind} ${i}/${i + j + 1}`); }));
      }
      for (const seat of document.querySelectorAll(".table-seat")) {
        const info = seat.querySelector(":scope > div:not(.card-pair):not(.seat-bet)");
        for (const child of seat.querySelectorAll(":scope > .card-pair, :scope > .seat-bet")) {
          if (getComputedStyle(child).display !== "none" && intersects(rect(info), rect(child))) collisions.push(`${seat.className} info/cards/chips`);
        }
      }
      const outside = [...buttons, ...avatars].some(r => r.x < -1 || r.y < -1 || r.right > innerWidth + 1 || r.bottom > innerHeight + 1);
      return { width: app.clientWidth, height: app.clientHeight, collisions, outside };
    });
    try {
      assert.ok(geometry.width > geometry.height, "phone table must use a landscape canvas even while the phone is portrait");
      assert.deepEqual(geometry.collisions, [], "avatars, seat information, cards, chips and toolbar buttons must not overlap");
      assert.equal(geometry.outside, false, "avatars and toolbar controls must stay on screen");
      const showdownFits = await page.evaluate(() => {
        // Exercise the real footer styles without waiting for a random hand to finish.
        const table = document.querySelector(".table-screen");
        const footer = document.createElement("section");
        footer.className = "showdown-footer";
        footer.innerHTML = "<div><span>全员亮牌</span><b>奶油小熊 · 同花顺</b></div><p>主池和边池已独立结算，正在核对最佳五张牌。</p>";
        table.append(footer);
        const fits = footer.scrollWidth <= footer.clientWidth + 1;
        footer.remove();
        return fits;
      });
      assert.equal(showdownFits, true, "showdown result must fit its mobile dock without horizontal scrolling");
      await page.locator(".action-panel.expanded").waitFor({ state: "visible", timeout: 30000 });
      const overlaps = await page.evaluate(() => {
        const dock = document.querySelector(".action-panel").getBoundingClientRect();
        return [...document.querySelectorAll(".table-seat > img, .hero-cards .playing-card")].some(el => {
          const r = el.getBoundingClientRect();
          return r.left < dock.right && r.right > dock.left && r.top < dock.bottom && r.bottom > dock.top;
        });
      });
      assert.equal(overlaps, false, "betting dock must not cover avatars or hero cards");
      await page.screenshot({ path: `outputs/mobile-layout/${width}x${height}-actions.png` });
      const hand = await page.locator(".table-header > div:first-child b").innerText();
      await page.setViewportSize({ width: height, height: width });
      await page.waitForFunction(rotated => document.querySelector(".game-app").classList.contains("mobile-rotated") === rotated, width > height);
      assert.equal(await page.locator(".table-header > div:first-child b").innerText(), hand, "turning the phone must preserve the current hand");
      await page.getByRole("button", { name: "离开牌桌", exact: true }).click();
      const modalOnScreen = await page.locator(".modal-card").evaluate(el => {
        const r = el.getBoundingClientRect();
        return r.left >= -1 && r.top >= -1 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
      });
      assert.equal(modalOnScreen, true, "leave confirmation must fit the rotated screen");
      console.log(`PASS ${width}x${height}`);
    } catch (error) {
      failures.push(`${width}x${height}: ${error.message}; ${JSON.stringify(geometry)}`);
    }
    await context.close();
  }
  assert.deepEqual(failures, []);
} finally {
  await browser.close();
  await new Promise(resolve => server.httpServer.close(resolve));
}
