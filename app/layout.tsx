import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "软糖扑克 · 纯虚拟筹码德州扑克",
  description: "无需登录，快速开始好友德州扑克与 AI 新手训练。",
  icons: { icon: "/poker-assets/brand/favicon.svg", shortcut: "/poker-assets/brand/favicon.svg" },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body>{children}</body></html>;
}
