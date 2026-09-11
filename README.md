# 软糖扑克

六人桌虚拟筹码 AI 训练游戏。好友房服务同步成员、准备与开局；目前不支持真人下注同步或服务端统一结算。请勿将其用作公平竞技或真实资金系统。

## GitHub Pages 静态版

仓库中的 `docs/` 是可直接发布到 GitHub Pages 的静态站点。静态版保留完整 AI 单机对局、本地战绩、任务、装扮、筹码重置和首次免责声明，并隐藏依赖服务器的好友房入口。游戏进度只保存在访客当前浏览器的本地存储中。

- `npm run build:static`：重新生成 `docs/index.html`、脚本、样式和全部图片资源。
- GitHub Pages 发布源：`main` 分支的 `/docs` 目录。
- 站点使用相对资源路径，可部署在 `https://用户名.github.io/仓库名/` 下，无需购买域名。

每手结束后停留在结算页，由玩家选择下一局、复盘或返回大厅，不再自动跳转。首次进入需阅读并主动同意“使用规则与免责声明”，拒绝时不加载游戏；当前规则版本与确认时间仅保存在本机浏览器，规则版本变化后重新确认。该记录不等同于身份认证或服务端取证。

免责声明依据《刑法》第 303 条、2026 年施行的《治安管理处罚法》第 82 条及《民法典》第 496、497、506 条拟定，并保留官方来源链接。它不能保证具体使用方式合法，也不能免除开发者或运营者依法应承担的责任；正式运营前应结合实际功能和运营方式请中国大陆执业律师审查。

## 本地运行与检查

- `npm run build`：构建网站并更新本地预览文件。
- `npm run preview`：启动本机房间服务与预览，默认 `http://127.0.0.1:4173`。
- `npm test`：重新构建，并验证页面、洗牌与牌型、边池、筹码继承及房间协议。
- `npm run typecheck`：检查 TypeScript。
- `npm run typegen`：重新生成 Cloudflare 类型；`scripts/wrangler-types.jsonc` 仅用于类型生成，不用于部署。

房间中的盲注和操作时间用于训练牌桌，买入范围的下限作为训练买入。所有座位的筹码在连续牌局中保留。AI 归零后补至训练买入并提示；玩家归零后暂停自动下一局，可在结算页或大厅手动重置为 10,000，保留战绩、任务、装扮与设置。战绩和偏好保存在当前设备；刷新会丢失未结算的手牌。复盘提供实际行动统计，不提供策略评分。

AI 会根据本次打开游戏以来的输赢与玩家公开行动更新心理记忆，影响进攻、跟注、诈唬和思考时间；心理状态和策略说明仅用于内部决策，不在玩家界面展示。刷新页面会清除心理记忆，心理提示不代表底牌强弱。

规则计算位于 `app/poker-core.ts`，训练配置位于 `app/table-config.ts`。`app/*.js` 是本地预览生成文件，应通过构建更新。

后续真人联机需要服务端牌局状态机、按身份发放私有底牌、行动校验、快照恢复及持久化。目前的 Node 房间服务不会随 Cloudflare Worker 构建自动部署。

## 原始模板说明

A clean full-stack starter running on
[vinext](https://github.com/cloudflare/vinext), with optional Cloudflare D1 and
Drizzle support.

## Prerequisites

- Node.js `>=22.13.0`

## Quick Start

```bash
npm install
npm run dev
npm run build
```

This starter does not use `wrangler.jsonc`.

## Included Shape

- edit site code under `app/`
- `.openai/hosting.json` declares optional Sites D1 and R2 bindings
- `vite.config.ts` simulates declared bindings for local development
- `db/schema.ts` starts intentionally empty
- `examples/d1/` contains an optional D1 example surface
- `drizzle.config.ts` supports local migration generation when needed

## Workspace Auth Headers

Signed-in visitors receive both `oai-authenticated-user-id` and `oai-authenticated-user-email`. Private Sites require every visitor to sign in; public Sites may also have anonymous visitors, for whom neither header is present.

The user ID is stable for the same user on the same Site and different across Sites. Email and name are intended for display or contact purposes.

SIWC-authenticated workspace sites may also receive
`oai-authenticated-user-full-name` when the user's SIWC profile has a non-empty
`name` claim. The full-name value is percent-encoded UTF-8 and is accompanied by
`oai-authenticated-user-full-name-encoding: percent-encoded-utf-8`.

Treat the full name as optional and fall back to email when it is absent:

```tsx
import { headers } from "next/headers";

export default async function Home() {
  const requestHeaders = await headers();
  const userId = requestHeaders.get("oai-authenticated-user-id");
  const email = requestHeaders.get("oai-authenticated-user-email");
  const encodedFullName = requestHeaders.get("oai-authenticated-user-full-name");
  const fullName =
    encodedFullName &&
    requestHeaders.get("oai-authenticated-user-full-name-encoding") ===
      "percent-encoded-utf-8"
      ? decodeURIComponent(encodedFullName)
      : null;

  const displayName = fullName ?? email;
  // ...
}
```

## Optional Dispatch-Owned ChatGPT Sign-In

Import the ready-to-use helpers from `app/chatgpt-auth.ts` when the site needs
optional or required ChatGPT sign-in:

- Use `getChatGPTUser()` for optional signed-in UI.
- Use `requireChatGPTUser(returnTo)` for server-rendered pages that should send
  anonymous visitors through Sign in with ChatGPT.
- Use `chatGPTSignInPath(returnTo)` and `chatGPTSignOutPath(returnTo)` for
  browser links or actions.
- Pass a same-origin relative `returnTo` path for the destination after sign-in
  or sign-out. The helper validates and safely encodes it.
- Mark protected pages with `export const dynamic = "force-dynamic"` because
  they depend on per-request identity headers.

Dispatch owns `/signin-with-chatgpt`, `/signout-with-chatgpt`, `/callback`, the
OAuth cookies, and identity header injection. Do not implement app routes for
those reserved paths. Routes that do not import and call the helper remain
anonymous-compatible.

SIWC establishes identity only; it does not prove workspace membership. Use the
Sites hosting platform's access policy controls for workspace-wide restrictions,
or enforce explicit server-side membership or allowlist checks.

Use SIWC for account pages, user-specific dashboards, saved records, and write
actions tied to the current ChatGPT user. Leave public content anonymous.

## Useful Commands

- `npm run dev`: start local development
- `npm run build`: verify the vinext build output
- `npm test`: build the starter and verify its rendered loading skeleton
- `npm run db:generate`: generate Drizzle migrations after schema changes

## Learn More

- [vinext Documentation](https://github.com/cloudflare/vinext)
- [Drizzle D1 Guide](https://orm.drizzle.team/docs/get-started/d1-new)
