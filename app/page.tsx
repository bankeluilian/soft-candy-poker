"use client";

import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { dealRandomHand, bestOfSeven, settlePots, estimateEquity, actionTarget, canRaise as canPlayerRaise } from "./poker-core";
import { tableConfig, carryStacks, resetEmptyChips, RESET_CHIPS, type TableConfig } from "./table-config";

import { freshAiMemories, learnFromHand, aiPsychology, aiSeats, type AiMemories } from "./ai-psychology";

import { LegalNotice, TERMS_STORAGE_KEY, hasAcceptedTerms, createTermsAcceptance } from "./legal-notice";

type Page = "lobby" | "room" | "table" | "friends" | "history" | "tasks" | "profile" | "store" | "tutorial" | "settings" | "messages";
type Modal = "matching" | "join" | "create" | "settlement" | "nextHand" | "replay" | "leave" | "rules" | "reconnect" | "resetHistory" | "resetChips" | "legal" | null;
type Toast = { id: number; text: string };
type SettingsState = { music: number; musicEnabled: boolean; effects: number; prompts: number; dealAnimation: boolean; chipAnimation: boolean; handHint: boolean; skipRepeat: boolean; confirmAllIn: boolean; fourColor: boolean; onlineVisible: boolean; strangerRequests: boolean; publicStats: boolean };
type DealtHand = { id: string; players: string[][]; board: string[] };
type HandAction = { street: number; seat: number; type: string; amount: number; target: number; pot: number; text: string };
type HandResult = { handId: string; heroWon: boolean; winnerName: string; winnerAvatar: string; heroCards: string[]; winnerCards: string[]; board: string[]; bestFive: string[]; handLabel: string; pot: number; sidePots?: number[]; heroDelta: number; stackAfter: number; finalStacks?: number[]; reason: string; actions?: HandAction[] };
type ShowdownState = { result: HandResult; winnerSeats: number[] };
type AiProfile = { style: string; aggression: number; looseness: number; patience: number; bluff: number; lines: Record<"check" | "call" | "fold" | "bet" | "raise", string[]> };
type EngineActionType = "check" | "call" | "fold" | "bet" | "raise";
type EngineState = { street: number; stacks: number[]; streetBets: number[]; totalBets: number[]; active: number[]; allIn: number[]; actingSeat: number; currentBet: number; minRaise: number; acted: number[]; actedAt: Record<number, number>; actions: HandAction[] };
type PendingHeroAction = { type: EngineActionType; target: number; label: string };
type RealtimeStatus = "connecting" | "online" | "offline";
type RealtimeMember = { id: string; name: string; avatar: string; ready: boolean; connected: boolean; seat: number };
type RealtimeRoom = { code: string; name: string; ownerId: string; status: "waiting" | "playing"; settings: { blind: string; buy: string; seconds: string; allowAi: boolean }; members: RealtimeMember[] };
type RoomOptions = { name?: string; blind?: string; buy?: string; seconds?: string; allowAi?: boolean };

const STATIC_BUILD = typeof document !== "undefined" && document.documentElement.dataset.runtime === "static";
const A = typeof document === "undefined"
  ? "/poker-assets"
  : new URL("poker-assets/", document.baseURI).pathname.replace(/\/$/, "");
const rankNames: Record<string, string> = { A: "ace", K: "king", Q: "queen", J: "jack", "10": "ten", "9": "nine", "8": "eight", "7": "seven", "6": "six", "5": "five", "4": "four", "3": "three", "2": "two" };
const suitNames: Record<string, string> = { "♠": "spades", "♥": "hearts", "♦": "diamonds", "♣": "clubs" };
const navItems: { page: Page; icon: string; label: string }[] = [
  { page: "lobby", icon: "⌂", label: "游戏大厅" },
  { page: "friends", icon: "♧", label: "好友" },
  { page: "history", icon: "♕", label: "战绩" },
  { page: "tasks", icon: "✓", label: "任务" },
  { page: "profile", icon: "◎", label: "个人资料" },
  { page: "store", icon: "▢", label: "商店" },
  { page: "tutorial", icon: "◇", label: "教学" },
  { page: "settings", icon: "⚙", label: "设置" },
];


const defaultSettings: SettingsState = {
  music: 60, musicEnabled: true, effects: 80, prompts: 70, dealAnimation: true, chipAnimation: true,
  handHint: true, skipRepeat: false, confirmAllIn: true, fourColor: false,
  onlineVisible: true, strangerRequests: true, publicStats: false,
};

const tableTiming = {
  matching: 7600,
  dealing: 2800,
  aiNormal: 1850,
  aiSkipped: 1100,
  streetPause: 1200,
  streetPauseSkipped: 700,
  foldResolve: 900,
  showdown: 4600,
};

const cardRanks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const cardSuits = ["♠", "♥", "♦", "♣"];
const seatNames = ["奶盖兔兔", "喵小灰", "柚子茶", "榴莲同学", "薄荷糖", "小熊软糖"];
const seatAvatars = ["avatar-white-rabbit.webp", "avatar-gray-cat.webp", "avatar-orange-shiba.webp", "avatar-player-cream-bear.webp", "avatar-mint-candy.webp", "avatar-caramel-bear.webp"];
const categoryLabels = ["高牌", "一对", "两对", "三条", "顺子", "同花", "葫芦", "四条", "同花顺"];
const cardBackFiles: Record<string, string> = { "经典红": "card-back-classic-red.svg", "鼠尾草": "card-back-sage-leaf.svg", "奶油小熊": "card-back-cream-bear.svg", "雾霾蓝": "card-back-mist-blue.svg", "晚霞粉": "card-back-dusk-pink.svg", "幸运四叶草": "card-back-lucky-clover.svg" };
const aiProfiles: Record<number, AiProfile> = {
  0: { style: "谨慎观察", aggression: .26, looseness: .34, patience: .9, bluff: .08, lines: { check: ["先看看下一张。", "不急。"], call: ["这个价格能看。", "我跟一手。"], fold: ["这次不勉强。", "让给你。"], bet: ["我试一下。", "给点压力。"], raise: ["这个池我想争。", "再加一点。"] } },
  1: { style: "稳健派", aggression: .43, looseness: .4, patience: .72, bluff: .13, lines: { check: ["我过。", "先控制底池。"], call: ["赔率还可以。", "继续。"], fold: ["没必要硬撑。", "这手到此为止。"], bet: ["该收点价值了。", "轮到我下注。"], raise: ["你的价格太便宜了。", "我再抬一点。"] } },
  2: { style: "直觉派", aggression: .72, looseness: .68, patience: .28, bluff: .29, lines: { check: ["看你怎么打。", "免费牌当然要。"], call: ["有意思，我跟。", "想看下一张。"], fold: ["啧，算了。", "这次你赢。"], bet: ["我先开火。", "别太舒服。"], raise: ["就这点？再来。", "我可没那么好赶走。"] } },
  4: { style: "好奇派", aggression: .34, looseness: .76, patience: .48, bluff: .18, lines: { check: ["再看一张吧。", "先不把池做大。"], call: ["有点想知道后面。", "我买张牌看。"], fold: ["好奇心也有价钱。", "太贵了，不看了。"], bet: ["试探一下。", "看看谁愿意留下。"], raise: ["那我反问一次。", "你真的有吗？"] } },
  5: { style: "老练派", aggression: .57, looseness: .47, patience: .78, bluff: .24, lines: { check: ["轮到后面说话。", "我保留意见。"], call: ["这个下注说明不了太多。", "我陪你走一段。"], fold: ["信息够了。", "这局不值得。"], bet: ["该收费了。", "给你一个决定。"], raise: ["你的故事还不完整。", "我把问题还给你。"] } },
};

function clamp(value: number, min: number, max: number) { return Math.max(min, Math.min(max, value)); }

function estimateHandProbabilities(heroCards: string[], visibleBoard: string[], trials = 700) {
  const known = new Set([...heroCards, ...visibleBoard]);
  const remaining = cardSuits.flatMap((suit) => cardRanks.map((rank) => `${rank}${suit}`)).filter((card) => !known.has(card));
  const cardsNeeded = 5 - visibleBoard.length;
  const counts = Array(9).fill(0) as number[];
  const runs = cardsNeeded === 0 ? 1 : trials;
  for (let run = 0; run < runs; run += 1) {
    const sample = [...remaining];
    for (let index = 0; index < cardsNeeded; index += 1) {
      const swapIndex = index + Math.floor(Math.random() * (sample.length - index));
      [sample[index], sample[swapIndex]] = [sample[swapIndex], sample[index]];
    }
    const finalBoard = [...visibleBoard, ...sample.slice(0, cardsNeeded)];
    counts[bestOfSeven([...heroCards, ...finalBoard]).category] += 1;
  }
  return counts.map((count, category) => ({ category, label: categoryLabels[category], probability: count / runs * 100 })).reverse();
}

/* ---- Background music: a synthesized lounge loop, no audio files needed ---- */
const musicStepMs = 248;
const midiToFreq = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);
// C - G - Am - F: a bright, upbeat pop progression.
const musicChords: number[][] = [
  [48, 52, 55, 60],
  [43, 47, 50, 55],
  [45, 48, 52, 57],
  [41, 45, 48, 53],
];

function playMusicNote(ctx: AudioContext, master: GainNode, midi: number, duration: number, type: OscillatorType, peak: number) {
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = midiToFreq(midi);
  const now = ctx.currentTime;
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(peak, now + .04);
  gain.gain.exponentialRampToValueAtTime(.0001, now + duration);
  oscillator.connect(gain); gain.connect(master);
  oscillator.start(now); oscillator.stop(now + duration + .05);
}

function useBackgroundMusic(volume: number, enabled: boolean) {
  const audioRef = useRef<{ ctx: AudioContext; master: GainNode; timer: number | null } | null>(null);

  useEffect(() => {
    const targetGain = enabled && volume > 0 ? Math.min(1, volume / 100) * .14 : 0;
    if (!enabled || volume <= 0) {
      const session = audioRef.current;
      audioRef.current = null;
      if (session) {
        if (session.timer) window.clearInterval(session.timer);
        try {
          session.master.gain.cancelScheduledValues(session.ctx.currentTime);
          session.master.gain.linearRampToValueAtTime(0, session.ctx.currentTime + .35);
        } catch { /* Context may already be closed. */ }
        window.setTimeout(() => session.ctx.close().catch(() => {}), 600);
      }
      return;
    }
    const session = audioRef.current;
    if (session) {
      try { session.master.gain.linearRampToValueAtTime(targetGain, session.ctx.currentTime + .25); } catch { /* Keep playing at current volume. */ }
      return;
    }
    // Browsers only allow audio after a user gesture, so arm one-time listeners.
    const launch = () => {
      if (audioRef.current) return;
      try {
        const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioContextCtor();
        const master = ctx.createGain();
        master.gain.value = 0;
        master.connect(ctx.destination);
        master.gain.linearRampToValueAtTime(targetGain, ctx.currentTime + 1.4);
        const created = { ctx, master, timer: null as number | null };
        audioRef.current = created;
        let step = 0;
        const tick = () => {
          if (audioRef.current !== created) return;
          const chord = musicChords[Math.floor(step / 8) % musicChords.length];
          const noteIndex = step % 8;
          // Bouncy arpeggio over the chord, one octave up.
          const order = [0, 2, 1, 3, 2, 3, 1, 2];
          playMusicNote(ctx, master, chord[order[noteIndex]] + 12, .4, "triangle", .5);
          // Off-beat sparkle keeps the groove light.
          if (noteIndex % 2 === 1) playMusicNote(ctx, master, chord[order[noteIndex]] + 24, .2, "sine", .16);
          // Pulse the root on beats 1 and 3.
          if (noteIndex === 0 || noteIndex === 4) playMusicNote(ctx, master, chord[0], .52, "sine", .5);
          // Lift into the next chord.
          if (noteIndex === 7) playMusicNote(ctx, master, chord[3] + 12, .26, "triangle", .3);
          step += 1;
        };
        created.timer = window.setInterval(tick, musicStepMs);
        tick();
      } catch { /* Audio unavailable in this browser. */ }
    };
    const gestureHandler = () => launch();
    window.addEventListener("pointerdown", gestureHandler, { once: true });
    window.addEventListener("keydown", gestureHandler, { once: true });
    return () => {
      window.removeEventListener("pointerdown", gestureHandler);
      window.removeEventListener("keydown", gestureHandler);
    };
  }, [enabled, volume]);

  // Unmount: stop the loop for good.
  useEffect(() => () => {
    const session = audioRef.current;
    if (session) {
      if (session.timer) window.clearInterval(session.timer);
      session.ctx.close().catch(() => {});
      audioRef.current = null;
    }
  }, []);
}

function useRealtimeRoom(callbacks: { room: (room: RealtimeRoom, id: string) => void; start: (room: RealtimeRoom, seed: string) => void; error: (message: string) => void }) {
  const onRoom = useEffectEvent(callbacks.room);
  const onStart = useEffectEvent(callbacks.start);
  const onError = useEffectEvent(callbacks.error);
  const [status, setStatus] = useState<RealtimeStatus>(() => STATIC_BUILD ? "offline" : "connecting");
  const [room, setRoom] = useState<RealtimeRoom | null>(null);
  const [guestId, setGuestId] = useState("");
  const [onlineCount, setOnlineCount] = useState(0);
  const [latency, setLatency] = useState<number | null>(null);
  const socketRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (STATIC_BUILD) return;
    let disposed = false;
    let reconnectTimer: number | null = null;
    let pingTimer: number | null = null;
    let id = `guest-${crypto.randomUUID()}`;
    try { id = localStorage.getItem("poker-guest-id") || id; localStorage.setItem("poker-guest-id", id); } catch { /* Ephemeral identity when storage is blocked. */ }

    const connect = () => {
      if (disposed) return;
      const scheme = window.location.protocol === "https:" ? "wss" : "ws";
      const socket = new WebSocket(`${scheme}://${window.location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        setStatus("online"); setGuestId(id);
        socket.send(JSON.stringify({ type: "hello", id, name: "榴莲同学", avatar: "avatar-player-cream-bear.webp" }));
        pingTimer = window.setInterval(() => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: "ping", at: Date.now() })), 5000);
      };
      socket.onmessage = (event) => {
        let message: { type?: string; room?: RealtimeRoom; seed?: string; online?: number; at?: number; message?: string };
        try { const parsed: unknown = JSON.parse(event.data); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return; message = parsed; } catch { return; }
        const nextRoom = message.room;
        if ((message.type === "room_state" || message.type === "game_start") && nextRoom && typeof nextRoom.code === "string" && nextRoom.settings && Array.isArray(nextRoom.members)) {
          setRoom(nextRoom); onRoom(nextRoom, id);
          if (message.type === "game_start" && typeof message.seed === "string") onStart(nextRoom, message.seed);
        }
        if (message.type === "presence" && Number.isFinite(message.online)) setOnlineCount(Math.max(0, message.online!));
        if (message.type === "pong" && Number.isFinite(message.at)) setLatency(Math.max(1, Date.now() - message.at!));
        if (message.type === "error") onError(typeof message.message === "string" ? message.message : "联机服务暂时不可用");
      };
      socket.onclose = () => {
        if (pingTimer) window.clearInterval(pingTimer);
        if (disposed) return;
        setStatus("offline");
        reconnectTimer = window.setTimeout(connect, 1600);
      };
      socket.onerror = () => socket.close();
    };
    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) window.clearTimeout(reconnectTimer);
      if (pingTimer) window.clearInterval(pingTimer);
      socketRef.current?.close();
    };
  }, []);

  const send = (payload: Record<string, unknown>) => {
    if (STATIC_BUILD) { callbacks.error("静态版仅支持 AI 单机对局"); return false; }
    if (socketRef.current?.readyState !== WebSocket.OPEN) { callbacks.error("联机服务正在重连，请稍后再试"); return false; }
    socketRef.current.send(JSON.stringify(payload));
    return true;
  };

  return {
    status, room, guestId, onlineCount, latency,
    createRoom: (options: RoomOptions) => send({ type: "create_room", name: options.name, settings: { blind: options.blind, buy: options.buy, seconds: options.seconds, allowAi: options.allowAi } }),
    joinRoom: (code: string) => send({ type: "join_room", code }),
    toggleReady: (ready: boolean) => send({ type: "toggle_ready", ready }),
    startRoom: () => send({ type: "start_room" }),
    leaveRoom: () => {
      if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "leave_room" }));
      setRoom(null);
    },
  };
}

export default function PokerEntry() {
  const [accepted, setAccepted] = useState(false);
  const [checked, setChecked] = useState(false);
  const [declined, setDeclined] = useState(false);
  useEffect(() => {
    let disposed = false;
    queueMicrotask(() => {
      if (disposed) return;
      try { setAccepted(hasAcceptedTerms(localStorage.getItem(TERMS_STORAGE_KEY))); } catch { /* Require consent again if storage is unavailable. */ }
    });
    return () => { disposed = true; };
  }, []);
  if (accepted) return <PokerGame />;
  const accept = () => {
    if (!checked) return;
    const record = createTermsAcceptance(checked);
    try { localStorage.setItem(TERMS_STORAGE_KEY, JSON.stringify(record)); } catch { /* Consent remains valid only for this open page. */ }
    setAccepted(true);
  };
  if (declined) return <main className="legal-entry"><section className="legal-card"><h1>已停止进入游戏</h1><p>只有同意合法娱乐使用规则后，才能开始游戏。你可以关闭此页面。</p><button className="btn primary" onClick={() => { setDeclined(false); setChecked(false); }}>重新查看规则</button></section></main>;
  return <main className="legal-entry"><section className="legal-card"><span className="modal-label">软糖扑克</span><h1>使用规则与免责声明</h1><LegalNotice />
    <div className="legal-consent"><label><input type="checkbox" checked={checked} onChange={(event) => setChecked(event.target.checked)} /><span>我已阅读并同意上述规则，特别是禁止赌博、虚拟筹码和责任说明。</span></label><div><button className="btn apple-secondary" onClick={() => setDeclined(true)}>不同意，停止使用</button><button className="btn primary" disabled={!checked} onClick={accept}>同意规则并进入</button></div></div>
  </section></main>;
}

function PokerGame() {
  const [page, setPage] = useState<Page>("lobby");
  const [modal, setModal] = useState<Modal>(null);
  const legalReturnModal = useRef<Modal>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [chips, setChips] = useState(10000);
  const [aiMemories, setAiMemories] = useState(freshAiMemories);
  const lastFinished = useRef("");
  const [xp, setXp] = useState(340);
  const [claimed, setClaimed] = useState<number[]>([]);
  const [owned, setOwned] = useState<string[]>(["经典红"]);
  const [equipped, setEquipped] = useState("经典红");
  const [roomCode, setRoomCode] = useState("825731");
  const [settings, setSettings] = useState<SettingsState>(defaultSettings);
  const [roomOwner, setRoomOwner] = useState(false);
  const [handNo, setHandNo] = useState(1);
  const [tableStack, setTableStack] = useState(10000);
  const [config, setConfig] = useState<TableConfig>(() => tableConfig({}));
  const [previousStacks, setPreviousStacks] = useState<number[] | null>(null);
  const [localOptions, setLocalOptions] = useState<RoomOptions>({});
  const startedSeed = useRef("");
  const [tableSeed, setTableSeed] = useState(() => `local-${Date.now()}-${crypto.randomUUID()}`);
  const [handResult, setHandResult] = useState<HandResult | null>(null);
  const [handHistory, setHandHistory] = useState<HandResult[]>([]);
  const [storageReady, setStorageReady] = useState(false);
  const matchTimer = useRef<number | null>(null);
  const inviteHandled = useRef(false);
  const realtime = useRealtimeRoom({
    room: (room, id) => {
      setRoomCode(room.code); setRoomOwner(room.ownerId === id);
      if (room.status === "waiting") { setModal(null); setPage("room"); }
    },
    start: (room, seed) => {
      if (startedSeed.current === seed) return;
      startedSeed.current = seed;
      const nextConfig = tableConfig(room.settings);
      setConfig(nextConfig); setPreviousStacks(null); setTableStack(nextConfig.buyIn);
      setTableSeed(seed); setHandNo((value) => value + 1); setPage("table"); setModal(null);
    },
    error: (message) => toast(message),
  });
  useBackgroundMusic(settings.music, settings.musicEnabled);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
    if (cancelled) return;
    try {
      const raw = localStorage.getItem("poker-mvp-state");
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (typeof saved.chips === "number" && Number.isFinite(saved.chips)) setChips(Math.max(0, Math.floor(saved.chips)));
      if (typeof saved.xp === "number") setXp(saved.xp);
      if (Array.isArray(saved.claimed)) setClaimed(saved.claimed);
      if (Array.isArray(saved.owned)) setOwned(saved.owned);
      if (saved.equipped) setEquipped(saved.equipped);
      if (saved.settings) setSettings({ ...defaultSettings, ...saved.settings });
      if (Array.isArray(saved.handHistory)) setHandHistory(saved.handHistory.slice(0, 40));
    } catch { /* Storage may be disabled or malformed. */ } finally { setStorageReady(true); }
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try { localStorage.setItem("poker-mvp-state", JSON.stringify({ chips, xp, claimed, owned, equipped, settings, handHistory })); } catch { /* Keep training usable without storage. */ }
  }, [storageReady, chips, xp, claimed, owned, equipped, settings, handHistory]);

  useEffect(() => () => { if (matchTimer.current) window.clearTimeout(matchTimer.current); }, []);

  const toast = (text: string) => {
    const id = Date.now() + Math.random();
    setToasts((items) => [...items, { id, text }]);
    window.setTimeout(() => setToasts((items) => items.filter((item) => item.id !== id)), 2400);
  };

  const go = (next: Page) => {
    if (matchTimer.current) window.clearTimeout(matchTimer.current);
    matchTimer.current = null;
    if (realtime.room && next !== "room" && next !== "table") realtime.leaveRoom();
    setPage(next); setModal(null);
  };
  const startMatch = () => {
    if (chips <= 0) { setModal("resetChips"); return; }
    if (matchTimer.current) window.clearTimeout(matchTimer.current);
    setConfig(tableConfig({})); setPreviousStacks(null);
    setModal("matching");
    matchTimer.current = window.setTimeout(() => { matchTimer.current = null; setTableStack(Math.max(2000, Math.min(10000, chips))); setTableSeed(`match-${Date.now()}-${crypto.randomUUID()}`); setHandNo((value) => value + 1); setModal(null); setPage("table"); }, tableTiming.matching);
  };
  const cancelMatch = () => { if (matchTimer.current) window.clearTimeout(matchTimer.current); matchTimer.current = null; setModal(null); toast("已取消本次匹配"); };
  const createRoom = (options: RoomOptions = {}) => {
    setLocalOptions(options); setConfig(tableConfig(options)); setPreviousStacks(null);
    if (realtime.status === "online") {
      realtime.createRoom({ name: "榴莲的牌桌", blind: "50/100", buy: "5,000～20,000", seconds: "20 秒", allowAi: true, ...options });
      return;
    }
    setRoomCode(String(Math.floor(100000 + Math.random() * 900000)));
    setRoomOwner(true); setModal(null); setPage("room"); toast("当前使用离线好友房");
  };
  const joinRoom = (code: string) => {
    if (realtime.status === "online") { realtime.joinRoom(code); return; }
    toast("联机服务不可用，暂时无法加入好友房；可使用快速开始训练。");
  };

  const acceptRoomInvite = useEffectEvent(() => {
    if (inviteHandled.current || realtime.status !== "online") return;
    const code = new URLSearchParams(window.location.search).get("room")?.trim() || "";
    inviteHandled.current = true;
    if (!/^\d{6}$/.test(code)) return;
    realtime.joinRoom(code);
    window.history.replaceState({}, "", window.location.pathname);
  });
  useEffect(() => { acceptRoomInvite(); }, [realtime.status]);

  const startFriendRoom = () => {
    if (chips <= 0) { setModal("resetChips"); return; }
    if (realtime.room) { realtime.startRoom(); return; }
    if (localOptions.allowAi === false) { toast("当前训练模式需要 AI 对手，请启用 AI 后创建房间。"); return; }
    setTableStack(config.buyIn); setPreviousStacks(null);
    setTableSeed(`friend-${Date.now()}-${Math.random()}`);
    setHandNo((value) => value + 1);
    go("table");
  };
  const claimTask = (id: number, reward: number) => {
    if (claimed.includes(id)) return;
    setClaimed((v) => [...v, id]); setChips((v) => v + reward); setXp((v) => v + 40);
    toast(`奖励已领取：+${reward} 筹码、+40 XP`);
  };
  const buy = (name: string, price: number) => {
    if (owned.includes(name)) { setEquipped(name); toast(`已装备「${name}」`); return; }
    if (chips < price) { toast("虚拟筹码不足，可通过任务获得"); return; }
    setChips((v) => v - price); setOwned((v) => [...v, name]); setEquipped(name); toast(`购买成功，已装备「${name}」`);
  };
  const finishHand = (result: HandResult) => {
    if (lastFinished.current === result.handId) return;
    lastFinished.current = result.handId;
    if (result.finalStacks) {
      const starting = previousStacks || [config.buyIn, config.buyIn, config.buyIn, tableStack, config.buyIn, config.buyIn];
      setAiMemories((current) => learnFromHand(current, starting, result.finalStacks!, result.actions || []));
    }
    setHandResult(result);
    setHandHistory((items) => [result, ...items.filter((item) => item.handId !== result.handId)].slice(0, 40));
    setPreviousStacks(result.finalStacks || null);
    setTableStack(result.stackAfter);
    setChips(result.stackAfter);
    setXp((value) => value + (result.heroWon ? 28 : 12));
    setModal("settlement");
  };
  const startNextHand = () => {
    if (tableStack <= 0) { setModal("resetChips"); return; }
    const carried = carryStacks(previousStacks || [config.buyIn, config.buyIn, config.buyIn, tableStack, config.buyIn, config.buyIn], config, false);
    setPreviousStacks(carried.stacks); setTableStack(carried.stacks[3]);
    if (carried.refilled.length) { setChips(carried.stacks[3]); toast(`训练补码：${carried.refilled.map((seat) => seatNames[seat]).join("、")} 已补至 ${config.buyIn.toLocaleString()}`); }
    setHandNo((value) => value + 1);
    setTableSeed(`next-${Date.now()}-${Math.random()}`);
    setHandResult(null);
    setModal(null);
  };
  const resetChips = () => {
    if (chips > 0 || (page === "table" && (!handResult || tableStack > 0))) return;
    const restored = resetEmptyChips(chips);
    setChips(restored); setTableStack(restored);
    setPreviousStacks((stacks) => stacks ? stacks.map((stack, seat) => seat === 3 ? restored : stack) : null);
    setModal(page === "table" && handResult ? "nextHand" : null);
    toast(`筹码已重置为 ${restored.toLocaleString()}，战绩和装扮已保留`);
  };
  const resetHistory = () => {
    setHandHistory([]);
    setHandResult(null);
    setModal(null);
    toast("牌局记录与战绩统计已重置");
  };

  const bare = page === "table";
  return (
    <main className={`game-app ${bare ? "table-mode" : ""}`}>
      {!bare && <Sidebar page={page} go={go} taskBadge={buildTasks(handHistory).filter((task, index) => task.progress >= task.max && !claimed.includes(index)).length} />}
      <section className="main-shell">
        {!bare && <Topbar resetChips={() => setModal("resetChips")} chips={chips} xp={xp} messages={() => go("messages")} settings={() => go("settings")} />}
        <div className="page-stage">
          {page === "lobby" && <Lobby chips={chips} startMatch={startMatch} create={() => setModal("create")} join={() => setModal("join")} go={go} toast={toast} networkStatus={realtime.status} onlineCount={realtime.onlineCount} latency={realtime.latency} />}
          {page === "room" && <FriendRoom code={roomCode} owner={roomOwner} room={realtime.room} localOptions={localOptions} guestId={realtime.guestId} networkStatus={realtime.status} start={startFriendRoom} toggleReady={realtime.toggleReady} leave={() => go("lobby")} toast={toast} />}
          {page === "table" && <PokerTable key={`${handNo}-${tableSeed}`} seed={tableSeed} handNo={handNo} initialStack={tableStack} config={config} previousStacks={previousStacks} aiMemories={aiMemories} settings={settings} equipped={equipped} leave={() => setModal("leave")} finish={finishHand} rules={() => setModal("rules")} reconnect={() => setModal("reconnect")} toast={toast} toggleMusic={() => { setSettings((v) => ({ ...v, musicEnabled: !v.musicEnabled })); toast(settings.musicEnabled ? "背景音乐已关闭" : "背景音乐已开启"); }} />}
          {page === "friends" && <Friends toast={toast} invite={() => { setRoomOwner(true); createRoom(); }} />}
          {page === "history" && <History results={handHistory} replay={(result) => { setHandResult(result); setModal("replay"); }} />}
          {page === "tasks" && <Tasks results={handHistory} claimed={claimed} claim={claimTask} />}
          {page === "profile" && <Profile xp={xp} equipped={equipped} results={handHistory} toast={toast} />}
          {page === "store" && <Store chips={chips} owned={owned} equipped={equipped} buy={buy} />}
          {page === "tutorial" && <Tutorial goTable={() => go("table")} toast={toast} />}
          {page === "settings" && <Settings values={settings} historyCount={handHistory.length} networkStatus={realtime.status} latency={realtime.latency} guestId={realtime.guestId} resetHistory={() => setModal("resetHistory")} update={(patch) => { setSettings((v) => ({ ...v, ...patch })); toast("设置已自动保存"); }} />}
          {page === "messages" && <Messages toast={toast} />}
        </div>
      </section>

      {modal === "matching" && <Matching cancel={cancelMatch} />}
      {modal === "join" && <JoinRoom close={() => setModal(null)} join={joinRoom} />}
      {modal === "create" && <CreateRoom close={() => setModal(null)} create={createRoom} />}
      {modal === "settlement" && handResult && <Settlement result={handResult} review={() => { setModal("replay"); }} lobby={() => go("lobby")} next={startNextHand} />}
      {modal === "nextHand" && handResult && <NextHand config={config} result={handResult} handNo={handNo + 1} stack={tableStack} start={startNextHand} lobby={() => go("lobby")} />}
      {modal === "replay" && <Replay result={handResult} close={() => setModal(page === "table" && handResult ? "settlement" : null)} />}
      {modal === "leave" && <ConfirmLeave close={() => setModal(null)} leave={() => go("lobby")} />}
      {modal === "rules" && <Rules config={config} close={() => setModal(null)} />}
      {modal === "reconnect" && <Reconnect close={() => setModal(null)} />}
      {modal === "legal" && <ModalShell close={() => setModal(legalReturnModal.current)} wide><h2>使用规则与免责声明</h2><LegalNotice /></ModalShell>}
      {modal === "resetChips" && <ModalShell close={() => setModal(page === "table" && handResult ? "settlement" : null)}><span className="modal-label">训练筹码补给</span><h2>筹码用完了，重新出发</h2><p>将虚拟筹码恢复至 {RESET_CHIPS.toLocaleString()}。战绩、等级、任务、装扮与设置都会保留。</p><button className="btn primary full" disabled={chips > 0} onClick={resetChips}>重置为 {RESET_CHIPS.toLocaleString()} 筹码</button></ModalShell>}
      {modal === "resetHistory" && <ResetHistory count={handHistory.length} close={() => setModal(null)} reset={resetHistory} />}
      <footer className="legal-footer"><span>仅供娱乐 · 严禁赌博 · 虚拟筹码不可兑换财物</span><button onClick={() => { legalReturnModal.current = modal; setModal("legal"); }}>使用规则与免责声明</button></footer>
      <div className="toast-stack">{toasts.map((item) => <div className="toast" key={item.id}>✓ {item.text}</div>)}</div>
    </main>
  );
}

function Sidebar({ page, go, taskBadge = 0 }: { page: Page; go: (page: Page) => void; taskBadge?: number }) {
  return <aside className="sidebar">
    <button className="logo-button" onClick={() => go("lobby")} aria-label="返回游戏大厅"><img src={`${A}/brand/logo-primary.svg`} alt="软糖扑克" /></button>
    <nav>{navItems.filter((item) => !STATIC_BUILD || item.page !== "friends").map((item) => <button key={item.page} className={page === item.page || (page === "room" && item.page === "lobby") ? "active" : ""} onClick={() => go(item.page)}><span>{item.icon}</span>{item.label}{item.page === "tasks" && taskBadge > 0 && <em>{taskBadge}</em>}</button>)}</nav>
    <img className="sidebar-decor" src={`${A}/illustrations/decor-playing-cards-leaves.webp`} alt="" />
    <p className="virtual-note">纯虚拟筹码<br/>不可充值、交易或提现</p>
  </aside>;
}

function Topbar({ chips, xp, messages, settings, resetChips }: { resetChips: () => void; chips: number; xp: number; messages: () => void; settings: () => void }) {
  return <header className="topbar">
    <button className="player-mini"><img src={`${A}/avatars/avatar-player-cream-bear.webp`} alt="榴莲同学"/><span><b>榴莲同学</b><small>Lv. 8 · {xp}/600 XP</small></span></button>
    <div className="top-actions">{chips <= 0 && <button className="btn primary" onClick={resetChips}>重置筹码</button>}<button className="chip-balance"><Chip value="1K"/><span>虚拟筹码</span><b>{chips.toLocaleString()}</b></button><button className="icon-button" onClick={messages} aria-label="消息">✉<em>2</em></button><button className="icon-button" onClick={settings} aria-label="设置">⚙</button></div>
  </header>;
}

function Lobby({ chips, startMatch, create, join, go, toast, networkStatus, onlineCount, latency }: { chips: number; startMatch: () => void; create: () => void; join: () => void; go: (p: Page) => void; toast: (s: string) => void; networkStatus: RealtimeStatus; onlineCount: number; latency: number | null }) {
  return <div className="lobby page-content">
    <div className="page-heading"><div><p>欢迎回来，榴莲同学</p><h1>游戏大厅</h1></div><span className={`service-ok realtime-${networkStatus}`}><i/> {STATIC_BUILD ? "静态娱乐版 · AI 单机对局" : networkStatus === "online" ? `实时服务已连接 · ${latency ?? "—"} ms · ${onlineCount} 人在线` : networkStatus === "connecting" ? "正在连接实时服务…" : "离线模式 · 自动重连中"}</span></div>
    <div className="lobby-layout">
      <section className="lobby-main">
        <article className="quick-start">
          <div className="quick-copy"><span className="soft-label">6 人快速桌</span><h2>快速开始</h2><ul><li><Chip value="100"/>盲注 50/100</li><li><Chip value="10K"/>默认买入 10,000</li><li>◷ 预计等待 8 秒</li></ul><button className="btn primary large" onClick={startMatch}>开始匹配</button></div>
          <img src={`${A}/characters/mascot-dealer-cards.webp`} alt="小熊荷官" />
        </article>
        <div className="lobby-cards">
          {STATIC_BUILD ? <>
            <article className="mode-card green"><div><h3>AI 娱乐对局</h3><p>完整六人牌桌，数据只保存在当前浏览器</p></div><img src={`${A}/characters/mascot-study-notebook.webp`} alt=""/><button className="btn green" onClick={startMatch}>开始对局</button></article>
            <article className="mode-card blue"><div><h3>本地战绩</h3><p>查看最近牌局、胜率和虚拟筹码变化</p></div><img src={`${A}/characters/mascot-magnifier.webp`} alt=""/><button className="btn blue" onClick={() => go("history")}>查看战绩</button></article>
          </> : <>
            <article className="mode-card green"><div><h3>创建好友房</h3><p>2～6 人，自定义盲注、买入和操作时间</p></div><img src={`${A}/characters/mascot-study-notebook.webp`} alt=""/><button className="btn green" onClick={create}>创建房间</button></article>
            <article className="mode-card blue"><div><h3>加入好友房</h3><p>输入好友分享的 6 位房间码</p></div><img src={`${A}/characters/mascot-magnifier.webp`} alt=""/><button className="btn blue" onClick={join}>加入房间</button></article>
          </>}
          <article className="mode-card coral"><div><h3>新手训练</h3><p>熟悉牌型与基本操作</p></div><img src={`${A}/characters/mascot-reading-rules.webp`} alt=""/><button className="btn coral" onClick={() => go("tutorial")}>开始训练</button></article>
        </div>
      </section>
      <aside className="lobby-side">
        {STATIC_BUILD ? <section className="side-card invite-card"><h3>无需安装即可游玩</h3><p><b>打开网页直接开始</b><span>进度保存在本机浏览器中</span></p><div><button className="btn purple" onClick={startMatch}>开始 AI 对局</button></div></section> : <><section className="side-card online-friends"><div className="card-title"><h3>在线好友</h3><button onClick={() => go("friends")}>全部好友 ›</button></div>{[
          ["avatar-caramel-bear.webp", "小熊软糖"], ["avatar-white-rabbit.webp", "奶盖兔兔"], ["avatar-gray-cat.webp", "喵小灰"]
        ].map(([avatar, name]) => <div className="online-row" key={name}><img src={`${A}/avatars/${avatar}`} alt=""/><span><b>{name}</b><small><i/> 在线</small></span><button onClick={() => toast(`已向${name}发送牌桌邀请`)}>邀请</button></div>)}</section>
        <section className="side-card invite-card"><h3>最近邀请</h3><p><b>好友房 · 盲注 50/100</b><span>3/6 人 · 来自奶盖兔兔</span></p><div><button className="btn purple" onClick={() => toast("邀请已接受，正在进入房间")}>接受</button><button className="btn ghost" onClick={() => toast("已拒绝邀请")}>拒绝</button></div></section></>}
        <section className="side-card task-peek"><div className="card-title"><h3>今日任务</h3><button onClick={() => go("tasks")}>查看 ›</button></div><p>完成 3 手牌局 <b>1/3</b></p><div className="progress"><i style={{ width: "33%" }}/></div></section>
        <section className="streak-card"><span>♕</span><p>本周连胜 <b>2</b></p><small>余额 {chips.toLocaleString()}</small></section>
      </aside>
    </div>
  </div>;
}

function FriendRoom({ code, owner, room, localOptions, guestId, networkStatus, start, toggleReady, leave, toast }: { code: string; owner: boolean; room: RealtimeRoom | null; localOptions: RoomOptions; guestId: string; networkStatus: RealtimeStatus; start: () => void; toggleReady: (ready: boolean) => boolean; leave: () => void; toast: (s: string) => void }) {
  const fallback: RealtimeMember[] = [
    { id: "local", name: "榴莲同学", avatar: "avatar-player-cream-bear.webp", ready: true, connected: true, seat: 0 },
    { id: "bot", name: "小熊软糖", avatar: "avatar-caramel-bear.webp", ready: true, connected: true, seat: 1 },
  ];
  const members = room?.members || fallback;
  const isOwner = room ? room.ownerId === guestId : owner;
  const currentMember = members.find((member) => member.id === guestId);
  const settings = room?.settings || { blind: "50/100", buy: "5,000～20,000", seconds: "20 秒", allowAi: true, ...localOptions };
  const canStart = isOwner && settings.allowAi && members.every((member) => member.ready && member.connected);
  const seats = Array.from({ length: 6 }, (_, index) => members.find((member) => member.seat === index) || null);
  const inviteUrl = `${typeof window === "undefined" ? "" : window.location.origin}/?room=${code}`;
  return <div className="room-page page-content"><div className="room-heading"><button className="back" onClick={leave}>‹</button><div><p>好友房等待区</p><h1>{room?.name || "榴莲的牌桌"}</h1></div><span className={`room-live realtime-${networkStatus}`}><i/>{networkStatus === "online" ? "实时同步中" : networkStatus === "connecting" ? "正在连接" : "离线房间"}</span></div>
    <section className="room-info"><div><small>房间码</small><b>{code}</b><button onClick={() => { navigator.clipboard?.writeText(code); toast("房间码已复制"); }}>复制</button></div><div className="invite-link"><small>邀请链接</small><span>{inviteUrl}</span><button onClick={() => { navigator.clipboard?.writeText(inviteUrl); toast("邀请链接已复制，可在另一个浏览器加入"); }}>复制链接</button></div><button className="btn green" onClick={() => { navigator.clipboard?.writeText(inviteUrl); toast("邀请链接已复制"); }}>♧ 邀请好友</button><button className="btn danger-outline" onClick={leave}>离开房间</button><footer><span>♧ 6 人桌</span><span><Chip value="100"/>盲注 {settings.blind}</span><span><Chip value="5K"/>买入 {settings.buy}</span><span>◷ 操作时间 {settings.seconds}</span><span>▣ {settings.allowAi ? "允许" : "禁止"} AI 补位</span></footer></section>
    <div className="room-body"><div className="waiting-table"><div className="mini-felt"><span>♣</span><p>等待玩家准备<small>{isOwner ? "房主可开始游戏" : currentMember?.ready ? "已准备，等待房主开始" : "请先点击准备"}</small></p></div>{seats.map((member, i) => <article key={member?.id || i} className={`waiting-seat s${i+1} ${member ? "filled" : "empty"} ${member && !member.connected ? "offline" : ""}`}>{member ? <img src={`${A}/avatars/${member.avatar}`} alt=""/> : <i>＋</i>}<div><b>{member?.name || "空余座位"}</b><small>{member ? <><Chip value="10K"/>10,000</> : "通过房间码加入"}</small></div><em className={member?.id === room?.ownerId || (!room && i === 0) ? "owner" : member?.ready ? "ready" : "waiting"}>{member ? member.id === room?.ownerId || (!room && i === 0) ? "房主" : !member.connected ? "重连中" : member.ready ? "已准备" : "未准备" : "空位"}</em></article>)}</div>
      <aside className="room-panel"><section><h3>训练房说明</h3><p>开局后各自与 AI 训练，下注不会同步。</p><p>✓ 游客身份无需登录</p><p>✓ 成员状态实时同步</p><p>✓ 断线 30 秒内自动回座</p></section><section><h3>房间成员 · {members.length}/6</h3><div className="member-faces">{members.map((member) => <img src={`${A}/avatars/${member.avatar}`} title={member.name} alt="" key={member.id}/>)}</div></section>{!isOwner && <button className={`btn large ${currentMember?.ready ? "soft" : "green"}`} onClick={() => toggleReady(!currentMember?.ready)}>{currentMember?.ready ? "取消准备" : "我已准备"}</button>}<button className="btn primary large" disabled={!canStart} onClick={start}>{isOwner ? canStart ? "开始游戏" : "等待玩家准备" : "等待房主开始"}</button></aside>
    </div>
  </div>;
}

function PokerTable({ seed, handNo, initialStack, config, previousStacks, aiMemories, settings, equipped, leave, finish, rules, reconnect, toast, toggleMusic }: { seed: string; handNo: number; initialStack: number; config: TableConfig; previousStacks: number[] | null; aiMemories: AiMemories; settings: SettingsState; equipped: string; leave: () => void; finish: (result: HandResult) => void; rules: () => void; reconnect: () => void; toast: (s: string) => void; toggleMusic: () => void }) {
  const dealerSeat = (handNo - 1) % 6;
  const smallBlindSeat = (dealerSeat + 1) % 6;
  const bigBlindSeat = (dealerSeat + 2) % 6;
  const [deal] = useState<DealtHand>(() => dealRandomHand(seed));
  const tableRef = useRef<HTMLDivElement>(null);
  const potRef = useRef<HTMLDivElement>(null);
  const seatRefs = useRef<(HTMLElement | null)[]>([]);
  const tossSeq = useRef(0);
  const prevStreetBets = useRef<number[]>([]);
  const [chipTosses, setChipTosses] = useState<{ id: number; value: string; fromX: number; fromY: number; dx: number; dy: number }[]>([]);

  const [engine, setEngine] = useState<EngineState>(() => {
    const stacks = previousStacks ? [...previousStacks] : [config.buyIn, config.buyIn, config.buyIn, initialStack, config.buyIn, config.buyIn];
    const streetBets = Array(6).fill(0) as number[];
    const totalBets = Array(6).fill(0) as number[];
    const post = (seat: number, amount: number) => { const paid = Math.min(amount, stacks[seat]); stacks[seat] -= paid; streetBets[seat] = paid; totalBets[seat] = paid; };
    post(smallBlindSeat, config.smallBlind); post(bigBlindSeat, config.bigBlind);
    const allIn = stacks.map((value, seat) => value === 0 ? seat : -1).filter((seat) => seat >= 0);
    const eligible = (seat: number) => !allIn.includes(seat);
    let actingSeat = (bigBlindSeat + 1) % 6;
    for (let step = 0; step < 6 && !eligible(actingSeat); step += 1) actingSeat = (actingSeat + 1) % 6;
    return { street: 0, stacks, streetBets, totalBets, active: [0,1,2,3,4,5], allIn, actingSeat, currentBet: Math.max(...streetBets), minRaise: config.bigBlind, acted: [], actedAt: {}, actions: [] };
  });
  useEffect(() => {
    const bets = engine.streetBets;
    const prev = prevStreetBets.current;
    prevStreetBets.current = [...bets];
    const box = tableRef.current;
    const pot = potRef.current;
    if (!settings.chipAnimation || !box || !pot || prev.length !== bets.length) return;
    const boxRect = box.getBoundingClientRect();
    const potRect = pot.getBoundingClientRect();
    const targetX = potRect.left - boxRect.left + potRect.width / 2;
    const targetY = potRect.top - boxRect.top + potRect.height / 2;
    const created: { id: number; value: string; fromX: number; fromY: number; dx: number; dy: number }[] = [];
    bets.forEach((amount, seat) => {
      const delta = amount - (prev[seat] ?? 0);
      if (delta <= 0) return;
      const seatEl = seatRefs.current[seat];
      if (!seatEl) return;
      const rect = seatEl.getBoundingClientRect();
      const fromX = rect.left - boxRect.left + rect.width / 2;
      const fromY = rect.top - boxRect.top + rect.height / 2;
      created.push({ id: tossSeq.current, value: chipValueFor(delta), fromX, fromY, dx: targetX - fromX, dy: targetY - fromY });
      tossSeq.current += 1;
    });
    if (!created.length) return;
    setChipTosses((current) => [...current, ...created]);
    const ids = created.map((item) => item.id);
    window.setTimeout(() => setChipTosses((current) => current.filter((item) => !ids.includes(item.id))), 900);
  }, [engine, settings.chipAnimation]);
  const [dealing, setDealing] = useState(settings.dealAnimation);
  const [showdown, setShowdown] = useState<ShowdownState | null>(null);
  const [controlsCollapsed, setControlsCollapsed] = useState(true);
  const [secondsLeft, setSecondsLeft] = useState(config.turnSeconds);
  const [raiseTarget, setRaiseTarget] = useState(300);
  const [message, setMessage] = useState("随机牌序已锁定，等待首位玩家行动");
  const aiActingSeat = !dealing && !showdown && engine.actingSeat >= 0 && engine.actingSeat !== 3 ? engine.actingSeat : null;
  const [aiSeatStatus, setAiSeatStatus] = useState<Record<number, string>>({});
  const [pendingAllIn, setPendingAllIn] = useState<PendingHeroAction | null>(null);
  const [muted, setMuted] = useState(false);
  const psychology = Object.fromEntries(aiSeats.map((seat) => [seat, aiPsychology(aiMemories[seat], aiProfiles[seat], {
    stack: engine.stacks[seat], buyIn: config.buyIn, pot: engine.totalBets.reduce((sum, amount) => sum + amount, 0),
    toCall: Math.max(0, engine.currentBet - engine.streetBets[seat]), opponents: engine.active.length - 1,
    heroActive: engine.active.includes(3), actions: engine.actions,
  })]));
  const showdownTimer = useRef<number | null>(null);
  const concluding = useRef(false);
  const shownBoard = showdown ? 5 : engine.street === 0 ? 0 : engine.street + 2;
  const visibleBoard = deal.board.slice(0, shownBoard);
  const pot = engine.totalBets.reduce((sum, value) => sum + value, 0);
  const heroToCall = Math.max(0, engine.currentBet - engine.streetBets[3]);
  const heroMaxTarget = engine.streetBets[3] + engine.stacks[3];
  const minimumRaiseTarget = Math.min(heroMaxTarget, engine.currentBet + engine.minRaise);
  const canRaise = canPlayerRaise(engine, 3);
  const heroTurn = !dealing && !showdown && engine.actingSeat === 3 && engine.active.includes(3) && !engine.allIn.includes(3);
  const heroLabel = visibleBoard.length >= 3 ? bestOfSeven([...deal.players[3], ...visibleBoard]).label : `起手牌 · ${deal.players[3].join(" ")}`;
  const handOdds = useMemo(() => estimateHandProbabilities(deal.players[3], deal.board.slice(0, shownBoard)), [deal, shownBoard]);
  const cardBack = cardBackFiles[equipped] || cardBackFiles["经典红"];
  const dealOrder = Array.from({ length: 6 }, (_, offset) => (dealerSeat + 1 + offset) % 6);

  const nextActor = (state: EngineState, from: number) => {
    for (let step = 1; step <= 6; step += 1) {
      const seat = (from + step) % 6;
      if (state.active.includes(seat) && !state.allIn.includes(seat)) return seat;
    }
    return -1;
  };

  const roundComplete = (state: EngineState) => {
    if (state.active.length <= 1) return true;
    const eligible = state.active.filter((seat) => !state.allIn.includes(seat));
    if (eligible.length === 0) return true;
    if (eligible.length === 1) return state.streetBets[eligible[0]] >= state.currentBet;
    return eligible.every((seat) => state.acted.includes(seat) && state.streetBets[seat] === state.currentBet);
  };

  const playTone = (frequency: number, duration = .08) => {
    if (muted || settings.effects <= 0) return;
    try {
      const AudioContextCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const context = new AudioContextCtor(); const oscillator = context.createOscillator(); const gain = context.createGain();
      oscillator.frequency.value = frequency; gain.gain.value = settings.effects / 100 * .035; oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); gain.gain.exponentialRampToValueAtTime(.0001, context.currentTime + duration); oscillator.stop(context.currentTime + duration); window.setTimeout(() => context.close(), 350);
    } catch { /* Browser may block sound before the first gesture. */ }
  };

  const lastSubmitted = useRef<EngineState | null>(null);
  const submitAction = (seat: number, type: EngineActionType, requestedTarget: number, label?: string) => {
    const current = engine;
    if (lastSubmitted.current === current) return;
      if (current.actingSeat !== seat || showdown || concluding.current || !current.active.includes(seat) || current.allIn.includes(seat)) return current;
      const target = actionTarget(current, seat, type, requestedTarget);
      if (target === null) return;
      const next: EngineState = { ...current, stacks: [...current.stacks], streetBets: [...current.streetBets], totalBets: [...current.totalBets], active: [...current.active], allIn: [...current.allIn], acted: [...current.acted], actedAt: { ...current.actedAt }, actions: [...current.actions] };
      const beforeBet = next.streetBets[seat];
      if (type === "fold") next.active = next.active.filter((value) => value !== seat);
      const commit = Math.max(0, target - beforeBet);
      if (commit > 0) {
        next.stacks[seat] -= commit; next.streetBets[seat] += commit; next.totalBets[seat] += commit;
        if (next.stacks[seat] === 0 && !next.allIn.includes(seat)) next.allIn.push(seat);
      }
      const raisedBy = next.streetBets[seat] - next.currentBet;
      if (raisedBy > 0) {
        next.currentBet = next.streetBets[seat];
        if (raisedBy >= next.minRaise) { next.minRaise = raisedBy; next.acted = [seat]; }
        else if (!next.acted.includes(seat)) next.acted.push(seat);
      } else if (!next.acted.includes(seat)) next.acted.push(seat);
      next.actedAt[seat] = next.currentBet;
      const actionType = type === "bet" && current.currentBet > 0 ? "raise" : type;
      const actionLabel = label || (actionType === "fold" ? "弃牌" : actionType === "check" ? "过牌" : actionType === "call" ? `跟注 ${commit}` : `${actionType === "raise" ? "加注至" : "下注"} ${next.streetBets[seat]}`);
      const actionText = `${seatNames[seat]}${actionLabel}`;
      next.actions.push({ street: current.street, seat, type: actionType, amount: commit, target: next.streetBets[seat], pot: next.totalBets.reduce((sum, value) => sum + value, 0), text: actionText });
      next.actingSeat = nextActor(next, seat);
      setMessage(actionText);
      setAiSeatStatus((statuses) => ({ ...statuses, [seat]: actionLabel }));
      playTone(actionType === "fold" ? 220 : actionType === "check" ? 360 : actionType === "call" ? 440 : 560);
      lastSubmitted.current = current;
      setEngine(next);
  };

  const decideAi = (state: EngineState, seat: number) => {
    const profile = { ...aiProfiles[seat], ...psychology[seat] };
    const toCall = Math.max(0, state.currentBet - state.streetBets[seat]);
    const potNow = state.totalBets.reduce((sum, value) => sum + value, 0);
    const opponents = Math.max(1, state.active.filter((value) => value !== seat).length);
    const visibleBoard = deal.board.slice(0, state.street === 0 ? 0 : state.street + 2);
    // Equity backbone: Monte-Carlo win rate against random holdings, exactly
    // like the "vs random hand" percentages a training tool would show.
    const equity = estimateEquity(deal.players[seat], visibleBoard, opponents, state.street === 0 ? 260 : 340);
    const fairShare = 1 / (opponents + 1);
    // Position awareness: acting later means more information, so late seats
    // open wider and early seats tighten up, mirroring real table behaviour.
    const seatOffset = (seat - dealerSeat + 6) % 6;
    const positionBias = seatOffset >= 4 ? .05 : seatOffset <= 1 ? -.04 : 0;
    const noise = (Math.random() - .5) * .08;
    const effectiveEquity = clamp(equity + positionBias + noise, .02, .99);
    const potOdds = toCall / Math.max(1, potNow + toCall);
    const maxTarget = state.streetBets[seat] + state.stacks[seat];
    const minTarget = Math.min(maxTarget, state.currentBet + state.minRaise);
    const round50 = (value: number) => Math.round(value / 50) * 50;

    if (toCall > 0) {
      // Loose players keep calling thinner; drawing hands get one street of
      // implied odds credit, the way humans price in future betting.
      const loosenessMargin = 1.12 - profile.looseness * .55;
      const impliedOdds = state.street < 3 ? .1 : 0;
      const callFloor = clamp((potOdds - impliedOdds) * loosenessMargin, .02, .95);
      if (effectiveEquity < callFloor) return { type: "fold" as EngineActionType, target: state.streetBets[seat] };

      const valueRaise = effectiveEquity > fairShare + .16;
      const raiseUrge = clamp(profile.aggression * .38 + (effectiveEquity - fairShare) * .75 + profile.bluff * .1 - .1, .04, .6);
      const stackPressure = toCall / Math.max(1, state.stacks[seat] + toCall);
      if (canPlayerRaise(state, seat) && Math.random() < raiseUrge * (valueRaise ? 1.25 : .6 - stackPressure * .3) && (valueRaise || Math.random() < profile.bluff + .25)) {
        // Pot-relative raise sizing (0.45x–1.4x of the pot after calling).
        const fraction = clamp(.5 + profile.aggression * .55 + (effectiveEquity - .5) * .5, .45, 1.4);
        let sized = state.currentBet + Math.max(state.minRaise, round50((potNow + toCall) * fraction));
        // Low effective stacks with real hands: stop mincing, play for stacks.
        if (sized > maxTarget * .62 && effectiveEquity > .45) sized = maxTarget;
        return { type: "raise" as EngineActionType, target: clamp(Math.max(sized, minTarget), minTarget, maxTarget) };
      }
      return { type: "call" as EngineActionType, target: state.currentBet };
    }

    // Uncontested pot: bet when strength, aggression or a planned bluff says so.
    const betUrge = clamp(profile.aggression * .34 + (effectiveEquity - fairShare) * 1.1 + profile.bluff * .16 - .16, .05, .62);
    if (canPlayerRaise(state, seat) && Math.random() < betUrge) {
      const fraction = clamp(.32 + profile.aggression * .38 + (effectiveEquity - .5) * .5, .22, .95);
      let sized = Math.max(config.bigBlind, round50(Math.max(100, potNow) * fraction));
      if (sized > maxTarget * .62 && effectiveEquity > .45) sized = maxTarget;
      return { type: "bet" as EngineActionType, target: clamp(Math.max(sized, state.currentBet + state.minRaise), minTarget, maxTarget) };
    }
    return { type: "check" as EngineActionType, target: state.streetBets[seat] };
  };

  function concludeEngine(state: EngineState, reason: string) {
    if (concluding.current || showdown) return;
    concluding.current = true;
    const totalPot = state.totalBets.reduce((sum, value) => sum + value, 0);
    const payouts = Array(6).fill(0) as number[];
    const sidePots: number[] = [];
    const winningSeats = new Set<number>();
    let mainWinner = state.active[0] ?? 3;
    if (state.active.length === 1) {
      payouts[state.active[0]] = totalPot; sidePots.push(totalPot); winningSeats.add(state.active[0]); mainWinner = state.active[0];
    } else {
      const settled = settlePots(state.totalBets, state.active, deal.players, deal.board, dealerSeat);
      settled.payouts.forEach((amount, seat) => { payouts[seat] = amount; });
      sidePots.push(...settled.sidePots);
      settled.winningSeats.forEach((seat) => winningSeats.add(seat));
      mainWinner = settled.mainWinner;

    }
    const finalStacks = state.stacks.map((value, seat) => value + payouts[seat]);
    const mainScore = bestOfSeven([...deal.players[mainWinner], ...deal.board]);
    const payoutSeats = [...winningSeats];
    const result: HandResult = {
      handId: deal.id, heroWon: winningSeats.has(3), winnerName: payoutSeats.map((seat) => seatNames[seat]).join("、"), winnerAvatar: seatAvatars[mainWinner],
      heroCards: deal.players[3], winnerCards: deal.players[mainWinner], board: deal.board, bestFive: mainScore.bestFive, handLabel: mainScore.label,
      pot: totalPot, sidePots, heroDelta: finalStacks[3] - initialStack, stackAfter: finalStacks[3], finalStacks,
      reason: sidePots.length > 1 ? `${reason} · 已按 ${sidePots.length} 个底池分别结算` : reason, actions: state.actions,
    };
    setEngine({ ...state, street: 3, stacks: finalStacks, actingSeat: -1 });
    setMessage(`${result.winnerName} 以${result.handLabel}赢得底池`);
    setShowdown({ result, winnerSeats: payoutSeats });
    playTone(result.heroWon ? 720 : 260, .18);
    showdownTimer.current = window.setTimeout(() => finish(result), tableTiming.showdown);
  }

  useEffect(() => { window.scrollTo({ top: 0, left: 0 }); return () => { if (showdownTimer.current) window.clearTimeout(showdownTimer.current); }; }, []);
  useEffect(() => { const timer = window.setTimeout(() => setDealing(false), settings.dealAnimation ? tableTiming.dealing : 0); return () => window.clearTimeout(timer); }, [settings.dealAnimation]);
  const advanceStreet = useEffectEvent(() => {
    if (engine.active.length <= 1) { concludeEngine(engine, "其余玩家全部弃牌"); return; }
    if (engine.street === 3 || engine.active.filter((seat) => !engine.allIn.includes(seat)).length <= 1) { concludeEngine(engine, engine.allIn.length ? "全下后自动发完公共牌" : "河牌圈完成摊牌"); return; }
    const nextStreet = engine.street + 1;
    const reset: EngineState = { ...engine, street: nextStreet, streetBets: Array(6).fill(0), currentBet: 0, minRaise: config.bigBlind, acted: [], actedAt: {} };
    reset.actingSeat = nextActor(reset, dealerSeat);
    setAiSeatStatus({}); setMessage(`${["", "翻牌圈", "转牌圈", "河牌圈"][nextStreet]}开始`); playTone(510);
    setEngine(reset);
  });
  useEffect(() => {
    if (dealing || showdown || concluding.current || !roundComplete(engine)) return;
    const timer = window.setTimeout(advanceStreet, settings.skipRepeat ? tableTiming.streetPauseSkipped : tableTiming.streetPause);
    return () => window.clearTimeout(timer);
  }, [engine, dealing, showdown, settings.skipRepeat]);

  const takeAiTurn = useEffectEvent(() => {
    const seat = engine.actingSeat;
    const decision = decideAi(engine, seat);
    submitAction(seat, decision.type, decision.target);
  });
  const aiPatience = psychology[engine.actingSeat]?.patience || 0;
  useEffect(() => {
    if (dealing || showdown || concluding.current || roundComplete(engine) || engine.actingSeat < 0 || engine.actingSeat === 3) return;
    const delay = (settings.skipRepeat ? tableTiming.aiSkipped : tableTiming.aiNormal) + aiPatience * 520 + Math.random() * 420;
    const timer = window.setTimeout(takeAiTurn, delay);
    return () => window.clearTimeout(timer);
  }, [engine, dealing, showdown, settings.skipRepeat, aiPatience]);

  const turnKey = `${engine.street}-${engine.actions.length}-${engine.actingSeat}`;
  const [controlsTurn, setControlsTurn] = useState(turnKey);
  if (controlsTurn !== turnKey) {
    setControlsTurn(turnKey); setSecondsLeft(config.turnSeconds);
    setRaiseTarget(Math.min(heroMaxTarget, minimumRaiseTarget)); setPendingAllIn(null);
  }
  const expireHeroTurn = useEffectEvent(() => {
    if (!heroTurn) return;
    submitAction(3, heroToCall > 0 ? "fold" : "check", engine.streetBets[3], heroToCall > 0 ? "超时弃牌" : "超时过牌");
  });
  useEffect(() => {
    if (!heroTurn) return;
    const interval = window.setInterval(() => setSecondsLeft((value) => Math.max(0, value - 1)), 1000);
    const timeout = window.setTimeout(expireHeroTurn, config.turnSeconds * 1000);
    return () => { window.clearInterval(interval); window.clearTimeout(timeout); };
  }, [heroTurn, turnKey, config.turnSeconds]);

  const requestHeroAction = (type: EngineActionType, target: number, label: string) => {
    if (!heroTurn) return;
    if (actionTarget(engine, 3, type, target) === null) { toast("本次行动不符合当前跟注或加注条件"); return; }
    const commit = Math.max(0, Math.min(heroMaxTarget, target) - engine.streetBets[3]);
    if (settings.confirmAllIn && commit >= engine.stacks[3] && engine.stacks[3] > 0) { setPendingAllIn({ type, target, label }); return; }
    submitAction(3, type, target, label);
  };

  const positions = ["p1", "p2", "p3", "p4", "p5", "p6"];
  const roleFor = (index: number) => !engine.active.includes(index) ? "已弃牌" : engine.allIn.includes(index) ? "全下" : aiActingSeat === index ? "思考中" : aiSeatStatus[index] || (index === dealerSeat ? "庄家" : index === smallBlindSeat ? "小盲" : index === bigBlindSeat ? "大盲" : "等待");
  // Quick bet targets use the standard pot-fraction formula: call the current
  // bet first, then raise by a fraction of the resulting pot.
  const potAfterCall = pot + heroToCall;
  const fractionTarget = (fraction: number) => clamp(Math.round((engine.streetBets[3] + heroToCall + potAfterCall * fraction) / 50) * 50, minimumRaiseTarget, heroMaxTarget);
  const quickTargets: [string, number][] = [["1/3 底池", fractionTarget(1 / 3)], ["1/2 底池", fractionTarget(1 / 2)], ["2/3 底池", fractionTarget(2 / 3)], ["1 倍底池", fractionTarget(1)], ["全下", heroMaxTarget]];

  return <div className={`table-screen ${dealing ? "is-dealing" : ""} ${!heroTurn && !showdown ? "is-busy" : ""} ${showdown ? "is-showdown" : ""} ${settings.fourColor ? "four-color" : ""} ${settings.chipAnimation ? "" : "no-chip-animation"}`}><header className="table-header"><div><img src={`${A}/avatars/avatar-player-cream-bear.webp`} alt=""/><b>第 {handNo} 手 · #{deal.id}</b></div><span className="blind-label"><Chip value="100"/>盲注 {config.smallBlind}/{config.bigBlind}</span><span className="ping"><i/> 休闲对局</span><div className="table-head-actions"><button onClick={reconnect} aria-label="连接说明"><span aria-hidden="true">↻</span><em>连接说明</em></button><button onClick={rules}><span aria-hidden="true">◇</span><em>牌局规则</em></button><button aria-label={settings.musicEnabled ? "关闭背景音乐" : "开启背景音乐"} onClick={toggleMusic}><span aria-hidden="true" style={{ textDecoration: settings.musicEnabled ? "none" : "line-through" }}>♪</span><em>{settings.musicEnabled ? "音乐开" : "音乐关"}</em></button><button aria-label={muted ? "开启声音" : "静音"} onClick={() => { setMuted((value) => !value); toast(muted ? "牌桌声音已开启" : "牌桌声音已静音"); }}><span aria-hidden="true">{muted ? "♩" : "♬"}</span><em>{muted ? "开启声音" : "静音"}</em></button><button onClick={leave}><span aria-hidden="true">⇥</span><em>离桌</em></button></div></header>
    <div className="table-area"><div className="wood-table" ref={tableRef}><div className="felt">{dealing && <div className="dealer-deck" aria-hidden="true"><img src={`${A}/card-backs/${cardBack}`} alt=""/><img src={`${A}/card-backs/${cardBack}`} alt=""/></div>}{dealing && <div className="deal-status"><i/>随机洗牌完成 · 正在发牌</div>}{showdown && <div className="showdown-banner"><span>SHOWDOWN · 全员亮牌</span><b>{showdown.result.winnerName}</b><small>{showdown.result.handLabel} · {showdown.result.sidePots && showdown.result.sidePots.length > 1 ? `${showdown.result.sidePots.length} 个底池` : "主池结算"}</small></div>}<div className="pot" ref={potRef}><span>{showdown ? "全员亮牌" : ["翻牌前", "翻牌", "转牌", "河牌"][engine.street]}</span><div className="pot-stack"><ChipStack amount={pot}/><b>底池 {pot.toLocaleString()}</b></div><small>{showdown ? "正在核对最佳五张牌" : `当前最高下注 ${engine.currentBet}`}</small></div><div className="community-cards">{[0,1,2,3,4].map((index) => index < shownBoard ? <PlayingCard key={index} card={deal.board[index]} className={settings.dealAnimation ? "board-deal" : ""}/> : <i key={index}/>)}</div><div className="last-action">◷ {dealing ? "正在依次发放两轮底牌" : message}</div></div>{dealing && <div className="deal-flight-layer" aria-hidden="true">{[0,1].flatMap((round) => dealOrder.map((seat, order) => <img key={`${round}-${seat}`} className={`deal-flight-card to-${positions[seat]} round-${round + 1}`} src={`${A}/card-backs/${cardBack}`} alt="" style={{ "--deal-delay": `${(round * 6 + order) * .16}s` } as React.CSSProperties}/>))}</div>}{seatNames.map((name, index) => <article ref={(node) => { seatRefs.current[index] = node; }} className={`table-seat ${positions[index]} ${index === 3 ? "hero" : ""} ${engine.active.includes(index) ? "" : "folded"} ${aiActingSeat === index ? "ai-thinking" : ""} ${showdown?.winnerSeats.includes(index) ? "showdown-winner" : showdown ? "showdown-loser" : ""}`} key={name}><img src={`${A}/avatars/${seatAvatars[index]}`} alt=""/><div><b>{name}</b><span><Chip value={chipValueFor(engine.stacks[index])}/>{engine.stacks[index].toLocaleString()}</span><small>{showdown ? bestOfSeven([...deal.players[index], ...deal.board]).label : roleFor(index)}</small></div>{index !== 3 && <div className="card-pair">{showdown ? <><PlayingCard card={deal.players[index][0]} className="showdown-card"/><PlayingCard card={deal.players[index][1]} className="showdown-card"/></> : <><img className={settings.dealAnimation ? "deal-card" : ""} src={`${A}/card-backs/${cardBack}`} alt="牌背"/><img className={settings.dealAnimation ? "deal-card" : ""} src={`${A}/card-backs/${cardBack}`} alt="牌背"/></>}</div>}{!showdown && engine.streetBets[index] > 0 && <div className="seat-bet"><ChipStack amount={engine.streetBets[index]}/><em>{engine.streetBets[index]}</em></div>}</article>)}<div className="chip-toss-layer" aria-hidden="true">{chipTosses.map((toss) => <img key={toss.id} className="chip-toss" src={`${A}/chips/chip-${toss.value.toLowerCase()}.svg`} alt="" style={{ left: toss.fromX, top: toss.fromY, "--toss-dx": `${toss.dx}px`, "--toss-dy": `${toss.dy}px` } as React.CSSProperties} />)}</div></div>
      <div className={`hero-cards ${showdown?.winnerSeats.includes(3) ? "showdown-winner" : showdown ? "showdown-loser" : ""}`}><PlayingCard card={deal.players[3][0]} className={settings.dealAnimation ? "deal-card" : ""}/><PlayingCard card={deal.players[3][1]} className={settings.dealAnimation ? "deal-card" : ""}/><span>{showdown ? bestOfSeven([...deal.players[3], ...deal.board]).label : settings.handHint ? heroLabel : "牌力提示已关闭"}</span></div>
    </div>

    {showdown ? <section className="showdown-footer"><div><span>全员亮牌</span><b>{showdown.result.winnerName} · {showdown.result.handLabel}</b></div><p>{showdown.result.sidePots && showdown.result.sidePots.length > 1 ? `主池和 ${showdown.result.sidePots.length - 1} 个边池已经分别结算。` : "六位玩家底牌均已公开，稍后进入本手结算。"}</p><div className="showdown-progress"><i/></div></section> : <section className={`action-panel ${controlsCollapsed ? "collapsed" : "expanded"}`}><div className="hand-info"><div className="hand-info-head"><b>{settings.handHint ? heroLabel : "当前手牌"}</b><button className="panel-collapse" aria-expanded={!controlsCollapsed} onClick={() => setControlsCollapsed((value) => !value)}>{controlsCollapsed ? "更多下注选项⌃" : "精简操作区⌄"}</button></div><div className="hand-metrics"><span>剩余筹码<strong>{engine.stacks[3].toLocaleString()}</strong></span><span>本手已投入<strong>{engine.totalBets[3]}</strong></span><span>需要跟注<strong>{heroToCall}</strong></span></div><section className="odds-row" aria-label="成牌概率">{handOdds.map((item) => <span className={item.probability > 0 ? "possible" : ""} key={item.category}><b>{item.label}</b><em>{item.probability < .01 && item.probability > 0 ? "<0.01" : item.probability.toFixed(item.probability < 1 ? 2 : 1)}%</em></span>)}</section></div><div className={`countdown ${secondsLeft <= 5 ? "urgent" : ""}`}>{heroTurn ? secondsLeft : "…"}<small>{heroTurn ? "秒" : "等待"}</small></div><div className="bet-controls"><div className="main-actions"><button className="fold" disabled={!heroTurn} onClick={() => requestHeroAction("fold", engine.streetBets[3], "选择弃牌")}>弃牌</button>{heroToCall === 0 ? <button className="check" disabled={!heroTurn} onClick={() => requestHeroAction("check", engine.streetBets[3], "选择过牌")}>过牌</button> : <button className="check" disabled={!heroTurn} onClick={() => requestHeroAction("call", engine.currentBet, `跟注 ${Math.min(heroToCall, engine.stacks[3])}`)}>跟注 {Math.min(heroToCall, engine.stacks[3])}</button>}<button className="raise" disabled={!heroTurn || !canRaise} onClick={() => requestHeroAction(engine.currentBet > 0 ? "raise" : "bet", Math.max(minimumRaiseTarget, raiseTarget), `${engine.currentBet > 0 ? "加注至" : "下注"} ${Math.max(minimumRaiseTarget, raiseTarget)}`)}>{canRaise ? `${engine.currentBet > 0 ? "加注" : "下注"} ${Math.max(minimumRaiseTarget, raiseTarget)}` : "无法加注"}</button></div><div className="slider-row"><button disabled={!canRaise} onClick={() => setRaiseTarget(Math.max(minimumRaiseTarget, raiseTarget - 100))}>−</button><input type="range" min={Math.max(0, minimumRaiseTarget)} max={Math.max(minimumRaiseTarget, heroMaxTarget)} step="50" value={Math.min(Math.max(raiseTarget, minimumRaiseTarget), Math.max(minimumRaiseTarget, heroMaxTarget))} onChange={(event) => setRaiseTarget(Number(event.target.value))}/><button disabled={!canRaise} onClick={() => setRaiseTarget(Math.min(heroMaxTarget, raiseTarget + 100))}>＋</button><input aria-label="加注金额" disabled={!canRaise} value={Math.max(minimumRaiseTarget, raiseTarget)} onChange={(event) => setRaiseTarget(clamp(Number(event.target.value) || minimumRaiseTarget, minimumRaiseTarget, heroMaxTarget))}/></div><div className="quick-bets">{quickTargets.map(([label, value]) => <button disabled={!canRaise} key={label} onClick={() => setRaiseTarget(clamp(value, minimumRaiseTarget, heroMaxTarget))}>{label}</button>)}</div></div></section>}
    {pendingAllIn && <div className="all-in-confirm"><section><span>ALL IN</span><h2>确认全下？</h2><p>将投入剩余的 {engine.stacks[3].toLocaleString()} 筹码。本次操作无法撤回。</p><div><button onClick={() => setPendingAllIn(null)}>再想想</button><button onClick={() => { const action = pendingAllIn; setPendingAllIn(null); submitAction(3, action.type, action.target, action.label); }}>确认全下</button></div></section></div>}
  </div>;
}


function PlayingCard({ card, className = "" }: { card: string; className?: string }) {
  const suit = suitNames[card.slice(-1)];
  const rank = rankNames[card.slice(0, -1)];
  return <img className={`playing-card suit-${suit} ${className}`} src={`${A}/cards/${suit}/card-${suit}-${rank}.svg`} alt={card}/>;
}
function Chip({ value, className = "" }: { value: string; className?: string }) {
  const file = value.toLowerCase();
  return <img className={`chip-icon ${className}`} src={`${A}/chips/chip-${file}.svg`} alt={`${value} 筹码`}/>;
}
function chipValueFor(amount: number) { if (amount >= 10000) return "10K"; if (amount >= 5000) return "5K"; if (amount >= 1000) return "1K"; if (amount >= 500) return "500"; if (amount >= 100) return "100"; if (amount >= 50) return "50"; return "25"; }
function ChipStack({ amount }: { amount: number }) {
  const primary = chipValueFor(amount);
  const secondary = amount >= 500 ? (amount >= 5000 ? "1K" : "100") : amount >= 100 ? "50" : "25";
  return <span className="chip-stack-ui"><Chip value={primary}/><Chip value={secondary}/>{amount >= 1000 && <Chip value="500"/>}</span>;
}

function cardsForStraightFlush() { return ["10♠", "J♠", "Q♠", "K♠", "A♠"]; }

function Friends({ toast, invite }: { toast: (s: string) => void; invite: () => void }) {
  const [tab, setTab] = useState("全部好友"); const [query, setQuery] = useState(""); const [requests,setRequests]=useState([["avatar-wise-owl.webp","竹叶熊猫"],["avatar-orange-shiba.webp","松鼠泡泡"]]);
  const friends = [["avatar-caramel-bear.webp","小熊软糖","1002001","在线","正在玩：快速开始"],["avatar-white-rabbit.webp","奶盖兔兔","1002002","在线","正在创建房间"],["avatar-gray-cat.webp","喵小灰","1002003","在线","正在加入房间"],["avatar-orange-shiba.webp","柴柴同学","1002004","离线","2 小时前在线"],["avatar-wise-owl.webp","猫头鹰博士","1002005","离线","昨天在线"]];
  const shown = friends.filter((f) => (f[1].includes(query) || f[2].includes(query)) && (tab!=="在线好友" || f[3]==="在线") && (tab!=="最近同桌" || ["1002001","1002002","1002003"].includes(f[2])));
  const removeRequest=(name:string,accepted:boolean)=>{setRequests(items=>items.filter(item=>item[1]!==name));toast(`${accepted?"已接受":"已拒绝"}${name}的好友申请`)};
  const emptyTab=tab==="黑名单"||tab==="发出的申请";
  return <Page title="好友" subtitle="和熟悉的牌友一起开桌"><div className="friend-search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="搜索玩家昵称或 ID"/><button className="btn soft" onClick={() => query ? toast(`已按“${query}”筛选好友`) : toast("请输入昵称或玩家 ID")}>搜索</button><button className="btn primary" onClick={() => query ? toast(`已向“${query}”发送好友申请`) : toast("先输入昵称或玩家 ID")}>♧ 添加好友</button></div><div className="tabs">{["全部好友","在线好友","最近同桌","收到的申请","发出的申请","黑名单"].map((x) => <button className={tab===x?"active":""} onClick={() => setTab(x)} key={x}>{x}{x==="收到的申请"&&requests.length>0&&<em>{requests.length}</em>}</button>)}</div><div className="friend-layout"><section className="list-panel">{tab==="收到的申请" ? (requests.length?requests.map((request)=><div className="friend-item" key={request[1]}><img src={`${A}/avatars/${request[0]}`} alt=""/><div><b>{request[1]}</b><small>想和你成为好友</small></div><span className="online-text">● 新申请</span><p>等待你的处理</p><button className="btn green" onClick={()=>removeRequest(request[1],true)}>接受</button><button className="more" onClick={()=>removeRequest(request[1],false)}>拒绝</button></div>):<EmptyState image="mascot-magnifier.webp" title="申请已处理完" text="新的好友申请会显示在这里"/>) : emptyTab ? <EmptyState image="mascot-security-shield.webp" title={tab==="黑名单"?"黑名单为空":"暂无发出的申请"} text={tab==="黑名单"?"被屏蔽的玩家会出现在这里":"通过上方搜索即可添加牌友"}/> : shown.map((f,i) => <div className="friend-item" key={f[2]}><img src={`${A}/avatars/${f[0]}`} alt=""/><div><b>{f[1]}</b><small>ID：{f[2]}</small></div><span className={f[3]==="在线"?"online-text":"offline-text"}>● {f[3]}</span><p>{f[4]}</p><button className="btn green" disabled={f[3]!=="在线"} onClick={invite}>邀请入桌</button><button className="more" onClick={() => toast(i < 3 ? `已打开${f[1]}的资料菜单` : `已打开${f[1]}的管理菜单`)}>⋮</button></div>)}</section><aside className="requests"><h3>好友申请 <em>{requests.length}</em></h3>{requests.length?requests.map((request) => <article key={request[1]}><img src={`${A}/avatars/${request[0]}`} alt=""/><div><b>{request[1]}</b><small>想和你成为好友</small></div><button onClick={() => removeRequest(request[1],true)}>接受</button><button onClick={() => removeRequest(request[1],false)}>拒绝</button></article>):<p>申请已处理完</p>}</aside></div></Page>;
}

function History({ results, replay }: { results: HandResult[]; replay: (result: HandResult) => void }) {
  const [tab, setTab] = useState("数据总览");
  const totalDelta = results.reduce((sum, result) => sum + result.heroDelta, 0); const wins = results.filter((result) => result.heroWon).length;
  const raises = results.flatMap((result) => result.actions || []).filter((action) => action.seat === 3 && (action.type === "raise" || action.type === "bet")).length;
  const played = Math.max(1, results.length); const recent = [...results].slice(0, 7).reverse(); const maxDelta = Math.max(100, ...recent.map((result) => Math.abs(result.heroDelta)));
  return <Page title="战绩" subtitle="只展示当前设备真实完成的牌局"><div className="tabs big-tabs"><button className={tab==="数据总览"?"active":""} onClick={() => setTab("数据总览")}>数据总览</button><button className={tab==="手牌记录"?"active":""} onClick={() => setTab("手牌记录")}>手牌记录</button></div>{tab==="数据总览" ? <><div className="stat-grid"><Stat value={String(results.length)} label="总手牌"/><Stat value={`${totalDelta>=0?"+":""}${totalDelta.toLocaleString()}`} label="净赢筹码" positive={totalDelta>=0}/><Stat value={`${Math.round(raises/played*100)}%`} label="主动下注频率"/><Stat value={String(raises)} label="下注 / 加注次数"/><Stat value={`${Math.round(wins/played*100)}%`} label="本地胜率"/><Stat value={results.length ? String(Math.round(results.reduce((sum,result)=>sum+(result.heroWon?86:72),0)/results.length)) : "—"} label="平均决策分" positive={results.length>0}/></div><section className="analytics-card"><div><h3>最近 {recent.length || 0} 手牌局结果</h3>{recent.length ? <div className="simple-chart">{recent.map((result) => <i title={`${result.heroDelta>=0?"+":""}${result.heroDelta}`} style={{height:`${24+Math.abs(result.heroDelta)/maxDelta*70}%`,background:result.heroDelta>=0?"#72a65f":"#d98a78"}} key={result.handId}/>)}</div> : <p>完成一手牌后，这里会生成真实走势。</p>}</div><div><h3>结算完整性</h3><p><span>全下牌局</span><b>{results.filter((result)=>(result.sidePots?.length||0)>1).length}</b></p><p><span>已保存复盘</span><b>{results.length}</b></p><p><span>最近胜局</span><b>{wins}</b></p></div></section></> : results.length ? <div className="hand-list">{results.map((result) => <button key={result.handId} onClick={() => replay(result)}><span><b>#{result.handId}</b><small>本地牌桌 · 50/100</small></span><em>{result.heroCards.join(" ")}</em><span><b>{result.handLabel}</b><small>{result.actions?.length || 0} 条真实事件</small></span><strong className={result.heroDelta>=0?"positive":"negative"}>{result.heroDelta>=0?"+":""}{result.heroDelta.toLocaleString()}</strong><i>›</i></button>)}</div> : <EmptyState image="mascot-magnifier.webp" title="还没有真实牌局记录" text="完成一手牌后，结算和每次行动会自动保存到这里。"/>}</Page>;
}

function Stat({ value, label, positive }: { value: string; label: string; positive?: boolean }) { return <article className="stat-card"><b className={positive?"positive":""}>{value}</b><span>{label}</span></article>; }

function buildTasks(results: HandResult[]) {
  const raiseCount = results.flatMap((result) => result.actions || []).filter((action) => action.seat === 3 && (action.type === "raise" || action.type === "bet")).length;
  return [{title:"完成 3 手牌局",progress:Math.min(3,results.length),max:3,reward:500},{title:"赢下 1 个底池",progress:results.some((result)=>result.heroWon)?1:0,max:1,reward:700},{title:"成功下注或加注 5 次",progress:Math.min(5,raiseCount),max:5,reward:900}];
}

function Tasks({ results, claimed, claim }: { results: HandResult[]; claimed: number[]; claim: (id: number, reward: number) => void }) {
  const tasks = buildTasks(results);
  return <Page title="今日任务" subtitle="完成小目标，领取虚拟筹码与经验"><section className="daily-banner"><img src={`${A}/illustrations/decor-reward-gift.webp`} alt="奖励"/><div><span>连续活跃 4 天</span><h2>今天已经完成 2 项任务</h2><p>每日 00:00 刷新，未领取奖励会保留到次日</p></div><div className="day-dots">{[1,2,3,4,5,6,7].map((x) => <i className={x<=4?"done":""} key={x}>{x}</i>)}</div></section><div className="task-list">{tasks.map((t,i) => <article key={t.title}><span className="task-number">0{i+1}</span><div><h3>{t.title}</h3><p>{t.progress} / {t.max}</p><div className="progress"><i style={{width:`${t.progress/t.max*100}%`}}/></div></div><strong><Chip value={chipValueFor(t.reward)}/>{t.reward}<small>+40 XP</small></strong><button className="btn primary" disabled={t.progress<t.max || claimed.includes(i)} onClick={() => claim(i,t.reward)}>{claimed.includes(i)?"已领取":t.progress===t.max?"领取奖励":"进行中"}</button></article>)}</div><section className="weekly-card"><div><span>每周挑战</span><h2>累计赢取 10,000 筹码</h2><p>8,420 / 10,000</p></div><div className="circle-progress">84<small>%</small></div><p>奖励：限定头像框「幸运叶」</p></section></Page>;
}

function Profile({ xp, equipped, results, toast }: { xp: number; equipped: string; results: HandResult[]; toast: (s: string) => void }) {
  const [editing, setEditing] = useState(false); const [name, setName] = useState("榴莲同学");
  const wins = results.filter((result)=>result.heroWon).length; const net = results.reduce((sum,result)=>sum+result.heroDelta,0); let streak=0; for(const result of results){if(!result.heroWon)break;streak+=1;}
  return <Page title="个人资料" subtitle="记录你的每一点进步"><section className="profile-hero"><img src={`${A}/avatars/avatar-player-cream-bear.webp`} alt="头像"/><div><span>PLAYER PROFILE</span><h2>{name}</h2><p>ID：1001008 · 本地游客身份</p><div className="level-progress"><i style={{width:`${Math.min(100,xp/6)}%`}}/><em>Lv.8 · {xp}/600 XP</em></div></div><button className="btn soft" onClick={() => setEditing(true)}>编辑资料</button></section><div className="profile-stats"><Stat value={String(results.length)} label="总手牌"/><Stat value={`${Math.round(wins/Math.max(1,results.length)*100)}%`} label="本地胜率"/><Stat value={`${net>=0?"+":""}${net.toLocaleString()}`} label="生涯净赢" positive={net>=0}/><Stat value={String(streak)} label="当前连胜"/></div><div className="section-title"><div><h2>成就收藏</h2><p>根据真实牌局解锁</p></div><span>当前卡背：<b>{equipped}</b></span></div><div className="badge-grid">{[["♠","初露锋芒","赢下第一手牌",wins>0],["◎","行动派","完成 10 次行动",results.flatMap(r=>r.actions||[]).filter(a=>a.seat===3).length>=10],["♕","手感火热","连胜 3 手",streak>=3],["?","大底池猎人","赢取 10K+ 底池",results.some(r=>r.heroWon&&r.pot>=10000)]].map((x) => <article className={x[3]?"":"locked"} key={String(x[1])}><i>{String(x[0])}</i><b>{String(x[1])}</b><small>{String(x[2])}</small></article>)}</div>{editing&&<div className="inline-modal"><div><button className="close" onClick={() => setEditing(false)}>×</button><h2>编辑个人资料</h2><img src={`${A}/avatars/avatar-player-cream-bear.webp`} alt=""/><label>昵称<input value={name} maxLength={12} onChange={(e) => setName(e.target.value)}/></label><button className="btn primary" onClick={() => {setEditing(false);toast("个人资料已保存");}}>保存修改</button></div></div>}</Page>;
}

function Store({ chips, owned, equipped, buy }: { chips: number; owned: string[]; equipped: string; buy: (n: string, p: number) => void }) {
  const items = [["经典红",0,"card-back-classic-red.svg"],["鼠尾草",1200,"card-back-sage-leaf.svg"],["奶油小熊",2000,"card-back-cream-bear.svg"],["雾霾蓝",1500,"card-back-mist-blue.svg"],["晚霞粉",1500,"card-back-dusk-pink.svg"],["幸运四叶草",2500,"card-back-lucky-clover.svg"]] as const;
  return <Page title="商店" subtitle="使用虚拟筹码解锁外观装扮"><div className="store-top"><div className="tabs"><button className="active">卡背</button><button disabled>更多装扮后续开放</button></div><span><Chip value="1K"/>虚拟筹码 <b>{chips.toLocaleString()}</b></span></div><div className="store-layout"><div className="store-grid">{items.map((item) => <article key={item[0]} className={equipped===item[0]?"selected":""}><img src={`${A}/card-backs/${item[2]}`} alt={item[0]}/><h3>{item[0]}</h3><p>{item[1]===0?"默认收藏":<><Chip value={chipValueFor(item[1])}/>{item[1].toLocaleString()}</>}</p><button className={`btn ${equipped===item[0]?"green":"primary"}`} onClick={() => buy(item[0],item[1])}>{equipped===item[0]?"已装备":owned.includes(item[0])?"装备":"购买"}</button></article>)}</div><aside><span>ⓘ</span><h2>装扮说明</h2><p>所有商品只改变外观，不影响发牌概率、匹配结果、AI 强度、胜率或操作时间。</p><img src={`${A}/characters/mascot-card-back.webp`} alt="卡背展示"/></aside></div><p className="compliance">纯虚拟筹码不可充值、转账、出售或提现。</p></Page>;
}

function Tutorial({ goTable, toast }: { goTable: () => void; toast: (s: string) => void }) {
  const [step,setStep]=useState(0); const lessons=["认识底牌与公共牌","行动：过牌、跟注和加注","九种牌型大小","位置与盲注","完成模拟牌局"];
  return <Page title="新手教学" subtitle="五个短章节，十分钟掌握第一手牌"><div className="tutorial-layout"><aside className="lesson-nav">{lessons.map((x,i)=><button key={x} className={step===i?"active":i<step?"done":""} onClick={()=>setStep(i)}><i>{i<step?"✓":i+1}</i><span>{x}<small>{i<step?"已完成":i===step?"正在学习":"约 2 分钟"}</small></span></button>)}</aside><section className="lesson-content"><span>第 {step+1} 课</span><h2>{lessons[step]}</h2><div className="lesson-board">{step===2?cardsForStraightFlush().map(card=><PlayingCard key={card} card={card}/>):<><PlayingCard card="A♠"/><PlayingCard card="K♥"/><b>＋</b><PlayingCard card="Q♣"/><PlayingCard card="J♦"/><PlayingCard card="10♠"/></>}<p>{step===2?"同花顺 > 四条 > 葫芦 > 同花 > 顺子 > 三条 > 两对 > 一对 > 高牌":"从两张底牌和五张公共牌中，选出最强的五张组合"}</p></div><p>{["每位玩家获得两张只有自己可见的底牌。牌桌中央最多发出五张所有人共享的公共牌。","无人下注时可以过牌；有人下注时可以跟注、加注或弃牌。合法按钮会根据牌局自动变化。","比较牌型时先看牌型级别；牌型相同再依次比较关键点数和踢脚牌，花色没有大小。","越靠近庄家按钮，行动通常越晚，能看到的信息越多。庄家按钮每手牌顺时针移动。","进入无战绩压力的模拟牌局。你可以暂停、重来或跳过动画，提示会默认开启。"][step]}</p><button className="btn primary large" onClick={()=>{if(step<4)setStep(step+1);else{toast("训练模式已开启，不消耗筹码");goTable();}}}>{step<4?"下一课 ›":"开始模拟牌局"}</button></section><img className="tutorial-mascot" src={`${A}/characters/mascot-reading-rules.webp`} alt="教学小熊"/></div></Page>;
}

function Settings({ values, update, networkStatus, latency, guestId, historyCount, resetHistory }: { values: SettingsState; update: (p: Partial<SettingsState>) => void; networkStatus: RealtimeStatus; latency: number | null; guestId: string; historyCount: number; resetHistory: () => void }) {
  const [tab,setTab]=useState("音频");
  return <Page title="设置" subtitle="设置会自动保存在当前设备"><div className="settings-layout"><aside>{["音频","牌桌体验","网络","隐私","本地资料"].map(x=><button className={tab===x?"active":""} onClick={()=>setTab(x)} key={x}>{x}</button>)}</aside><section>{tab==="音频"&&<><h2>音频</h2><Range label="背景音乐" value={values.music} set={(v)=>update({music:v})}/><Range label="游戏音效" value={values.effects} set={(v)=>update({effects:v})}/><Range label="提示音" value={values.prompts} set={(v)=>update({prompts:v})}/><p className="setting-note">牌桌操作音会按游戏音效音量实时播放；顶部音符按钮可临时静音。</p></>}{tab==="牌桌体验"&&<><h2>牌桌体验</h2><Toggle label="发牌动画" value={values.dealAnimation} set={(v)=>update({dealAnimation:v})}/><Toggle label="筹码动画" value={values.chipAnimation} set={(v)=>update({chipAnimation:v})}/><Toggle label="牌力提示" value={values.handHint} set={(v)=>update({handHint:v})}/><Toggle label="跳过重复动画" value={values.skipRepeat} set={(v)=>update({skipRepeat:v})}/><Toggle label="全下二次确认" value={values.confirmAllIn} set={(v)=>update({confirmAllIn:v})}/><Toggle label="四色牌模式" value={values.fourColor} set={(v)=>update({fourColor:v})}/></>}{tab==="网络"&&<><h2>网络</h2><Info label="当前身份" value="游客会话 · 无需登录"/><Info label="实时连接" value={networkStatus === "online" ? "已连接" : networkStatus === "connecting" ? "连接中" : "离线重连中"}/><Info label="网络延迟" value={latency == null ? "检测中" : `${latency} ms`}/><Info label="断线回座" value="30 秒内自动恢复"/><button className="btn soft" onClick={()=>window.location.reload()}>重新检测连接</button></>}{tab==="隐私"&&<><h2>隐私</h2><Toggle label="允许好友查看在线状态" value={values.onlineVisible} set={(v)=>update({onlineVisible:v})}/><Toggle label="允许陌生人发送好友申请" value={values.strangerRequests} set={(v)=>update({strangerRequests:v})}/><Toggle label="公开牌局统计" value={values.publicStats} set={(v)=>update({publicStats:v})}/><p className="setting-note">底牌、牌堆和未公开牌局信息永远不会展示给其他玩家。</p></>}{tab==="本地资料"&&<><h2>本地玩家资料</h2><Info label="玩家昵称" value="榴莲同学"/><Info label="游客 ID" value={guestId ? guestId.slice(-12) : "生成中"}/><Info label="数据保存" value="当前浏览器设备"/><Info label="牌局记录" value={`${historyCount} 手`}/><p className="setting-note">本版本没有登录入口。游客 ID 用于断线回座；筹码、任务、装扮、牌局历史和设置仍保存在当前设备。</p><div className="reset-records"><div><b>重置牌局记录</b><small>清空牌局历史和战绩统计，不影响筹码、任务、装扮、设置与游客身份。</small></div><button className="btn danger-outline" onClick={resetHistory} disabled={historyCount === 0}>{historyCount === 0 ? "暂无记录" : "重置记录"}</button></div></>}</section><div className="settings-preview"><div className="preview-table"><span>♠</span><i/><i/><i/></div><p>更改设置后立即生效</p><img src={`${A}/illustrations/decor-suits-leaves.webp`} alt=""/></div></div></Page>;
}
function Range({label,value,set}:{label:string;value:number;set:(v:number)=>void}){return <label className="range-setting"><span>{label}</span><input type="range" value={value} onChange={e=>set(Number(e.target.value))}/><b>{value}%</b></label>}
function Toggle({label,value,set}:{label:string;value:boolean;set:(v:boolean)=>void}){return <button className="toggle-setting" role="switch" aria-checked={value} onClick={()=>set(!value)}><span>{label}</span><i className={value?"on":""}><em/></i></button>}
function Info({label,value}:{label:string;value:string}){return <div className="info-row"><span>{label}</span><b>{value}</b></div>}

function Messages({ toast }: { toast: (s: string) => void }) { const [read,setRead]=useState<number[]>([]); const items=[["好友邀请","奶盖兔兔邀请你加入好友房","刚刚"],["任务奖励","今日任务已刷新，完成即可领取筹码","10 分钟前"],["系统通知","牌桌服务状态良好，祝你玩得开心","昨天"]]; return <Page title="消息中心" subtitle="牌局、好友和系统消息"><div className="message-list">{items.map((m,i)=><button className={read.includes(i)?"read":""} key={m[0]} onClick={()=>{setRead(v=>[...v,i]);toast(`已查看：${m[0]}`)}}><span>{i===0?"♧":i===1?"✓":"ⓘ"}</span><div><b>{m[0]}</b><p>{m[1]}</p></div><small>{m[2]}</small>{!read.includes(i)&&<em/>}</button>)}</div></Page> }

function Page({title,subtitle,children}:{title:string;subtitle:string;children:React.ReactNode}){return <div className="page-content standard-page"><div className="page-heading"><div><h1>{title}</h1><p>{subtitle}</p></div></div>{children}</div>}
function EmptyState({image,title,text}:{image:string;title:string;text:string}){return <div className="empty-state"><img src={`${A}/characters/${image}`} alt=""/><h3>{title}</h3><p>{text}</p></div>}

function ModalShell({ children, close, wide = false }: { children: React.ReactNode; close?: () => void; wide?: boolean }) {
  const panel = useRef<HTMLElement>(null);
  const onClose = useEffectEvent(() => close?.());
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const node = panel.current;
    node?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); }
      if (event.key !== "Tab" || !node) return;
      const controls = [...node.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]')];
      if (!controls.length) { event.preventDefault(); node.focus(); return; }
      const first = controls[0], last = controls[controls.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === node)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || document.activeElement === node)) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keydown);
    return () => { document.removeEventListener("keydown", keydown); previous?.focus(); };
  }, []);
  return <div className="modal-backdrop">
    {close && <button className="modal-dismiss" tabIndex={-1} aria-label="关闭弹窗" onClick={close}/>}
    <section ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="扑克游戏对话框" className={`modal-card ${wide ? "wide" : ""}`}>
      {close && <button className="close" aria-label="关闭弹窗" onClick={close}>×</button>}{children}
    </section>
  </div>;
}

function Matching({cancel}:{cancel:()=>void}){const[found,setFound]=useState(1);const order=useMemo(()=>[3,0,1,2,4,5].sort((a,b)=>a===3?-1:b===3?1:a-b),[]);useEffect(()=>{const delays=[900,2100,3400,4900,6200];const timers=delays.map((delay,index)=>window.setTimeout(()=>setFound(index+2),delay));return()=>timers.forEach((timer)=>window.clearTimeout(timer))},[]);const latest=order[Math.max(0,found-1)];return <ModalShell><img className="modal-mascot" src={`${A}/characters/mascot-magnifier.webp`} alt=""/><span className="modal-label">快速开始 · 50/100</span><h2>{found<6?"正在准备 AI 对手":"AI 已就绪，准备入座"}</h2><p>{found<6?`${seatNames[latest]} 已就绪，继续准备训练桌…`:"AI 对手准备完成，正在创建随机牌序。"}</p><div className="matching-players">{order.map((seat,index)=><div className={`${index<found?"found":""} ${index===found-1?"latest":""}`} key={seat}><img src={`${A}/avatars/${seatAvatars[seat]}`} alt=""/><span>{index<found?seatNames[seat]:"等待中"}</span></div>)}</div><div className="match-progress"><i style={{width:`${found/6*100}%`}}/></div><small>已找到 {found} / 6 位玩家 · {Math.round(found/6*100)}%</small><button className="btn apple-secondary full" onClick={cancel}>取消匹配</button></ModalShell>}
function JoinRoom({close,join}:{close:()=>void;join:(c:string)=>void}){const[code,setCode]=useState("");const[error,setError]=useState("");return <ModalShell close={close}><img className="modal-mascot small" src={`${A}/characters/mascot-magnifier.webp`} alt=""/><h2>加入好友房</h2><p>输入好友分享的 6 位房间码</p><input className={`room-code-input ${error?"error":""}`} value={code} maxLength={6} onChange={e=>{setCode(e.target.value.replace(/\D/g,""));setError("")}} placeholder="000 000"/><p className="field-error">{error}</p><button className="btn primary full" onClick={()=>code.length===6?join(code):setError("请输入完整的 6 位房间码")}>加入房间</button></ModalShell>}
function CreateRoom({close,create}:{close:()=>void;create:(options?:RoomOptions)=>void}){const[name,setName]=useState("榴莲的牌桌");const[blind,setBlind]=useState("50/100");const[buy,setBuy]=useState("5,000～20,000");const[seconds,setSeconds]=useState("20 秒");const[ai,setAi]=useState(true);return <ModalShell close={close} wide><span className="modal-label">PRIVATE TABLE</span><h2>创建好友房</h2><div className="form-grid"><label>房间名称<input value={name} maxLength={24} onChange={e=>setName(e.target.value)}/></label><label>桌型<select><option>6 人训练桌</option></select></label><label>盲注<select value={blind} onChange={e=>setBlind(e.target.value)}><option>10/20</option><option>50/100</option><option>100/200</option></select></label><label>买入范围<select value={buy} onChange={e=>setBuy(e.target.value)}><option>2,000～10,000</option><option>5,000～20,000</option></select></label><label>操作时间<select value={seconds} onChange={e=>setSeconds(e.target.value)}><option>10 秒</option><option>15 秒</option><option>20 秒</option></select></label><div className="form-toggle"><Toggle label="允许 AI 补位" value={ai} set={setAi}/></div></div><div className="form-summary">实时好友房 · 盲注 {blind} · 买入 {buy} · 操作 {seconds} · {ai?"允许":"禁止"} AI 补位</div><button className="btn primary full" onClick={()=>create({name,blind,buy,seconds,allowAi:ai})}>创建房间</button></ModalShell>}
function Settlement({result,review,lobby,next}:{result:HandResult;review:()=>void;lobby:()=>void;next:()=>void}){const pots=result.sidePots?.length?result.sidePots:[result.pot];return <ModalShell><img className="celebrate result-avatar" src={`${A}/${result.heroWon?"characters/mascot-waving.webp":`avatars/${result.winnerAvatar}`}`} alt="本手赢家"/><span className="modal-label">#{result.handId} · 本手牌结算</span><h2>{result.heroWon?"你赢下本手牌":`${result.winnerName} 赢下底池`}</h2><strong className={`prize ${result.heroDelta>=0?"win":"loss"}`}><Chip value={chipValueFor(Math.abs(result.heroDelta))}/>{result.heroDelta>=0?"+":""}{result.heroDelta.toLocaleString()}</strong><p>{result.handLabel} · {result.reason}</p><div className="result-section"><small>公共牌</small><div className="settlement-cards">{result.board.map((card)=><PlayingCard key={card} card={card}/>)}</div></div><div className="result-showdown"><span><small>你的底牌</small><b>{result.heroCards.join(" ")}</b></span><span><small>主池获胜底牌</small><b>{result.winnerCards.join(" ")}</b></span></div><div className="pot-split">{pots.map((amount,index)=><span key={`${amount}-${index}`}><ChipStack amount={amount}/><b>{index===0?"主池":`边池 ${index}`} {amount.toLocaleString()}</b>{index===0?` → ${result.winnerName}`:" · 已独立比较合资格玩家"}</span>)}</div><div className="auto-next-note"><i/><span>{result.stackAfter <= 0 ? "筹码已耗尽，重置筹码后可继续" : "本手已结束，可查看复盘、开始下一局或返回大厅"}</span></div><div className="modal-actions"><button className="btn apple-secondary" onClick={review}>查看复盘</button><button className="btn apple-secondary" onClick={lobby}>返回大厅</button><button className="btn apple-primary" onClick={next}>{result.stackAfter <= 0 ? "筹码耗尽 · 重置筹码" : "下一局"}</button></div></ModalShell>}
function NextHand({config,result,handNo,stack,start,lobby}:{config:TableConfig;result:HandResult;handNo:number;stack:number;start:()=>void;lobby:()=>void}) {
  return <ModalShell><span className="modal-label">继续游戏</span><h2>第 {handNo} 手准备就绪</h2><p>筹码已经准备好，点击下方按钮再开始。</p><div className="next-hand-grid"><span><small>当前筹码</small><b>{stack.toLocaleString()}</b></span><span><small>盲注</small><b>{config.smallBlind} / {config.bigBlind}</b></span><span><small>上局结果</small><b>{result.heroDelta >= 0 ? "+" : ""}{result.heroDelta.toLocaleString()}</b></span></div><div className="modal-actions"><button className="btn apple-secondary" onClick={lobby}>返回大厅</button><button className="btn apple-primary" onClick={start}>开始下一局</button></div></ModalShell>;
}

function Replay({close,result}:{close:()=>void;result?:HandResult|null}){const[step,setStep]=useState(1);const streets=["翻牌前","翻牌","转牌","河牌"];const heroCards=result?.heroCards||["A♠","K♠"];const board=result?.board||["A♥","K♥","7♣","7♦","2♠"];const streetActions=(result?.actions||[]).filter(action=>action.street===step);const heroActions=(result?.actions||[]).filter(action=>action.seat===3);return <ModalShell close={close} wide><span className="modal-label">#{result?.handId||"训练示例"}</span><h2>决策复盘</h2><div className="replay-tabs">{streets.map((x,i)=><button className={step===i?"active":""} onClick={()=>setStep(i)} key={x}>{x}</button>)}</div><div className="replay-layout"><section><h3>当前牌局状态</h3><p>底牌（你）</p><div className="settlement-cards">{heroCards.map(card=><PlayingCard key={card} card={card}/>)}</div><p>公共牌</p><div className="settlement-cards">{board.slice(0,step===0?0:step+2).map(card=><PlayingCard key={card} card={card}/>)}</div><dl><dt>本街结束底池</dt><dd>{streetActions.at(-1)?.pot.toLocaleString()||result?.pot.toLocaleString()||"—"}</dd><dt>本手结果</dt><dd>{result?.heroDelta!=null?`${result.heroDelta>=0?"+":""}${result.heroDelta}`:"训练示例"}</dd><dt>获胜牌型</dt><dd>{result?.handLabel||"—"}</dd></dl></section><section><h3>真实事件时间线</h3>{streetActions.length?streetActions.map((action,index)=><p className={action.seat===3?"selected-event":""} key={`${action.street}-${index}-${action.text}`}><i/>{action.text}<small>底池 {action.pot}</small></p>):<p><i/>本街没有额外下注<small>自动发牌</small></p>}</section><aside><h3>本手行动统计</h3><strong>{heroActions.length}<small> 次行动</small></strong><b>结果不代表决策质量</b><ul><li>真实行动：{result?.actions?.length||0} 条</li><li>策略评分：暂未提供</li><li>边池数量：{result?.sidePots?.length||1}</li><li>结算依据：七选五</li></ul><p>复盘使用本手实际底牌、公共牌、下注额和结算结果，不会重新随机。</p></aside></div><div className="replay-actions"><button onClick={()=>setStep(Math.max(0,step-1))}>‹ 上一步</button><button className="btn apple-primary" onClick={()=>setStep((step+1)%4)}>▶ 播放下一步</button><button onClick={()=>setStep(Math.min(3,step+1))}>下一步 ›</button></div></ModalShell>}
function ConfirmLeave({close,leave}:{close:()=>void;leave:()=>void}){return <ModalShell close={close}><img className="modal-mascot small" src={`${A}/characters/mascot-waving.webp`} alt=""/><h2>确定离开牌桌？</h2><p>离开将结束本次本地训练，当前未结算手牌不会计入战绩。</p><div className="modal-actions"><button className="btn ghost" onClick={close}>继续游戏</button><button className="btn danger" onClick={leave}>确认离桌</button></div></ModalShell>}
function ResetHistory({count,close,reset}:{count:number;close:()=>void;reset:()=>void}){return <ModalShell close={close}><img className="modal-mascot small" src={`${A}/characters/mascot-reading-rules.webp`} alt=""/><span className="modal-label">本地数据管理</span><h2>确定重置牌局记录？</h2><p>将永久清空当前设备上的 {count} 手牌局历史和对应战绩统计。筹码、等级、任务、装扮、设置与游客身份不会受到影响。</p><div className="modal-actions"><button className="btn ghost" onClick={close}>取消</button><button className="btn danger" onClick={reset}>确认重置</button></div></ModalShell>}
function Rules({config,close}:{config:TableConfig;close:()=>void}){return <ModalShell close={close} wide><img className="modal-mascot small" src={`${A}/characters/mascot-reading-rules.webp`} alt=""/><h2>牌局规则</h2><div className="rules-grid"><section><h3>牌局信息</h3><p>6 人桌 · 无限注德州扑克</p><p>盲注 {config.smallBlind}/{config.bigBlind} · 训练买入 {config.buyIn.toLocaleString()}</p><p>操作时间 {config.turnSeconds} 秒</p></section><section><h3>牌型从强到弱</h3><p>同花顺、四条、葫芦、同花、顺子、三条、两对、一对、高牌</p><p>花色没有大小；完全平局时平分底池。</p></section><section><h3>超时规则</h3><p>无需跟注时自动过牌，需要跟注时自动弃牌。</p></section><section><h3>公平说明</h3><p>本模式在当前浏览器中与 AI 训练。好友房同步成员和开局，不同步下注或结算。</p></section></div><button className="btn primary full" onClick={close}>我知道了</button></ModalShell>}
function Reconnect({close}:{close:()=>void}){return <ModalShell><img className="modal-mascot" src={`${A}/illustrations/state-reconnect.webp`} alt="重连"/><h2>当前为本地训练</h2><p>牌局在此浏览器中继续运行。房间服务断线不会暂停训练；刷新页面会丢失未结算的牌局。</p><button className="btn primary full" onClick={close}>返回牌桌</button></ModalShell>}
