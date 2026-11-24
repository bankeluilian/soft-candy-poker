import { useEffect, useRef, useState, type ReactNode } from "react";
import { createLanPeer } from "./lan-peer";
import { applyLanAction, createLanHand, isLanView, LAN_TABLE, lanView, otherLanSeat, type LanActionType, type LanMove, type LanView } from "./lan-poker";

type Role = "host" | "guest";
type Peer = ReturnType<typeof createLanPeer>;
type Hand = ReturnType<typeof createLanHand>;
type Connection = "pairing" | "connected" | "disconnected";

const actionLabels = { fold: "弃牌", check: "过牌", call: "跟注", bet: "下注", raise: "加注" };
const streetLabels = ["翻牌前", "翻牌圈", "转牌圈", "河牌圈"];

function isLanMove(data: unknown): data is LanMove {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<LanMove>;
  return Number.isSafeInteger(value.revision) && Number.isSafeInteger(value.target) &&
    typeof value.type === "string" && Object.hasOwn(actionLabels, value.type);
}

export function LanRoom({ leave, renderCard }: { leave: () => void; renderCard: (card: string) => ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [connection, setConnection] = useState<Connection>("pairing");
  const [localCode, setLocalCode] = useState("");
  const [remoteCode, setRemoteCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [submitted, setSubmitted] = useState<number | null>(null);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const [copyFeedback, setCopyFeedback] = useState("");
  const [view, setView] = useState<LanView | null>(null);
  const [turnEndsAt, setTurnEndsAt] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const peer = useRef<Peer | null>(null);
  const hand = useRef<Hand | null>(null);
  const deadline = useRef(0);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const codeField = useRef<HTMLTextAreaElement>(null);
  const pairingAttempt = useRef(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    return () => {
      pairingAttempt.current++;
      peer.current?.close();
      clearTimeout(turnTimer.current);
    };
  }, []);

  function reset() {
    pairingAttempt.current++;
    peer.current?.close();
    peer.current = null;
    hand.current = null;
    deadline.current = 0;
    clearTimeout(turnTimer.current);
    setRole(null);
    setConnection("pairing");
    setLocalCode("");
    setRemoteCode("");
    setBusy(false);
    setWaiting(false);
    setSubmitted(null);
    setError("");
    setCopyFeedback("");
    setView(null);
    setTurnEndsAt(0);
    setConfirmExit(false);
  }

  function disconnect() {
    deadline.current = 0;
    clearTimeout(turnTimer.current);
    setTurnEndsAt(0);
    setConnection("disconnected");
  }

  function expireTurn(revision: number) {
    const current = hand.current;
    if (!current || current.revision !== revision || current.actingSeat === null) return;
    const player = current.actingSeat;
    const type = lanView(current, player).toCall > 0 ? "fold" : "check";
    const next = applyLanAction(current, player, { revision, type, target: 0 });
    if (next) publish(next);
  }

  function publish(next: Hand) {
    const ownView = lanView(next, 0);
    const duration = next.actingSeat === null ? 0 : LAN_TABLE.turnSeconds * 1000;
    if (!peer.current?.send({ kind: "view", view: lanView(next, 1) })) {
      peer.current?.close();
      disconnect();
      return;
    }
    hand.current = next;
    clearTimeout(turnTimer.current);
    deadline.current = duration ? Date.now() + duration : 0;
    if (duration) turnTimer.current = setTimeout(() => expireTurn(next.revision), duration);
    setTurnEndsAt(deadline.current);
    setView(ownView);
  }

  function handleMove(seat: 0 | 1, move: LanMove) {
    const current = hand.current;
    if (!current || !deadline.current || current.revision !== move.revision) return;
    if (Date.now() >= deadline.current) {
      expireTurn(current.revision);
      return;
    }
    const next = applyLanAction(current, seat, move);
    if (next) publish(next);
    else if (seat === 1) peer.current?.send({ kind: "invalid", revision: move.revision });
    else setError("这个操作不符合当前牌局，请重新选择。");
  }

  function connectAs(nextRole: Role) {
    const next = createLanPeer(nextRole, {
      open: () => {
        setError("");
        setConnection("connected");
      },
      disconnected: disconnect,
      message: (data) => {
        if (!data || typeof data !== "object") return;
        const message = data as { kind?: string; move?: unknown; view?: unknown; revision?: unknown };
        if (nextRole === "host" && message.kind === "move" && isLanMove(message.move)) handleMove(1, message.move);
        if (nextRole === "guest" && message.kind === "view" && isLanView(message.view)) {
          setView(message.view);
          setTurnEndsAt(message.view.actingSeat === null ? 0 : Date.now() + LAN_TABLE.turnSeconds * 1000);
          setSubmitted(null);
          setError("");
        }
        if (nextRole === "guest" && message.kind === "invalid") {
          setSubmitted((current) => current === message.revision ? null : current);
          setError("这个操作不符合当前牌局，请重新选择。");
        }
      },
    });
    peer.current = next;
    return next;
  }

  async function runPairing(mode: "invite" | "answer" | "accept") {
    const attempt = ++pairingAttempt.current;
    setBusy(true);
    setError("");
    let current: Peer | null = null;
    try {
      current = mode === "accept" ? peer.current : connectAs(mode === "invite" ? "host" : "guest");
      if (!current) return;
      if (mode === "accept") {
        await current.accept(remoteCode);
        if (pairingAttempt.current === attempt) setWaiting(true);
      } else {
        const code = mode === "invite" ? await current.invite() : await current.answer(remoteCode);
        if (pairingAttempt.current === attempt) setLocalCode(code);
      }
    } catch (cause) {
      if (pairingAttempt.current !== attempt) return;
      if (mode !== "accept") {
        current?.close();
        peer.current = null;
      }
      setError(cause instanceof Error && !(cause instanceof DOMException) ? cause.message : "无法使用这段配对信息，请复制好友当前显示的完整信息。");
    } finally {
      if (pairingAttempt.current === attempt) setBusy(false);
    }
  }

  async function copyCode() {
    try {
      await navigator.clipboard.writeText(localCode);
      setCopyFeedback("已复制");
    } catch {
      codeField.current?.focus();
      codeField.current?.select();
      setCopyFeedback("已选中，请用设备的复制功能。");
    }
  }

  function nextHand() {
    if (role !== "host" || connection !== "connected") return;
    const previous = hand.current;
    if (previous && !previous.result) return;
    const carry = previous?.stacks.every((stack) => stack > 0);
    setError("");
    publish(createLanHand(carry && previous ? previous.number : 0, carry ? previous?.stacks : undefined, (previous?.revision ?? 0) + 1));
  }

  function sendMove(type: LanActionType, target = 0) {
    if (connection !== "connected" || !view || view.actingSeat !== (role === "host" ? 0 : 1)) return;
    const move = { revision: view.revision, type, target };
    setError("");
    if (role === "host") handleMove(0, move);
    else if (submitted !== view.revision && peer.current?.send({ kind: "move", move })) setSubmitted(view.revision);
  }

  return <div className="page-content standard-page lan-room">
    <header className="page-heading lan-heading">
      <div><h1>局域网好友对战</h1><p>双人德州扑克 · {LAN_TABLE.smallBlind} / {LAN_TABLE.bigBlind} 盲注 · 每人 {LAN_TABLE.buyIn.toLocaleString()} 虚拟筹码</p></div>
      <button className="btn ghost" onClick={() => role ? setConfirmExit(true) : leave()}>{role ? "退出对战" : "返回大厅"}</button>
    </header>

    {confirmExit && <section className="lan-panel lan-exit" aria-label="退出确认">
      <p>退出会结束本次连接和牌局。</p>
      <button className="btn ghost" onClick={() => setConfirmExit(false)}>继续留在房间</button>
      <button className="btn primary" onClick={() => { reset(); leave(); }}>确认退出</button>
    </section>}

    {error && <p className="lan-feedback lan-error" role="alert">{error}</p>}

    {connection !== "connected" && <section className="lan-panel lan-pair">
      {connection === "disconnected" ? <>
        <h2>连接已断开</h2>
        <p>请确认双方连接同一个 Wi-Fi，保持网页打开，然后重新配对。本次未完成的牌局无法恢复。</p>
        <button className="btn primary" onClick={reset}>重新配对</button>
      </> : !role ? <>
        <h2>和好友开一桌</h2>
        <div className="lan-buttons">
          <button className="btn primary" onClick={() => { setRole("host"); void runPairing("invite"); }}>创建双人房</button>
          <button className="btn green" onClick={() => setRole("guest")}>加入双人房</button>
        </div>
      </> : <>
        <h2>{role === "host" ? "房主配对" : "好友配对"}</h2>
        {role === "guest" && !localCode && <>
          <label className="lan-field">好友的邀请信息<textarea rows={3} value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} /></label>
          <button className="btn primary" disabled={busy || !remoteCode.trim()} onClick={() => void runPairing("answer")}>{busy ? "正在生成…" : "生成应答"}</button>
        </>}
        {role === "host" && !localCode && (busy ? <p role="status">正在生成邀请信息…</p> :
          <button className="btn primary" onClick={() => void runPairing("invite")}>重新生成邀请</button>)}
        {localCode && <>
          <label className="lan-field">{role === "host" ? "我的邀请信息" : "我的应答信息"}<textarea ref={codeField} rows={3} readOnly value={localCode} onFocus={(event) => event.currentTarget.select()} /></label>
          <div className="lan-buttons">
            <button className="btn green" onClick={() => void copyCode()}>{role === "host" ? "复制邀请" : "复制应答"}</button>
            <span role="status">{copyFeedback}</span>
          </div>
          {role === "host" ? <>
            <label className="lan-field">好友的应答信息<textarea rows={3} value={remoteCode} disabled={waiting} onChange={(event) => setRemoteCode(event.target.value)} /></label>
            <button className="btn primary" disabled={busy || waiting || !remoteCode.trim()} onClick={() => void runPairing("accept")}>{waiting ? "正在连接…" : "连接好友"}</button>
          </> : <p role="status">把应答信息发回给房主，等待对方连接。</p>}
        </>}
        <button className="btn ghost lan-reset" onClick={reset}>返回配对选择</button>
      </>}
    </section>}

    {connection === "connected" && !view && <section className="lan-panel">
      <h2>好友已连接</h2>
      {role === "host" ? <button className="btn primary" onClick={nextHand}>开始对战</button> : <p role="status">等待房主开始对战。</p>}
    </section>}

    {connection === "connected" && view && role && <LanTable key={view.revision} view={view} role={role} turnEndsAt={turnEndsAt}
      pending={submitted === view.revision} renderCard={renderCard} sendMove={sendMove} nextHand={nextHand} />}

    {connection !== "connected" && <section className="lan-panel lan-guide">
      <h2>使用说明</h2>
      <ol>
        <li>两台设备连同一个 Wi-Fi，用浏览器打开软糖扑克，在大厅选择「和好友同桌」。</li>
        <li>房主点「创建双人房」，复制完整邀请信息发给好友。</li>
        <li>好友点「加入双人房」，粘贴邀请，点「生成应答」，再把完整应答发回给房主。</li>
        <li>房主粘贴应答，点「连接好友」。看到「好友已连接」后，房主点「开始对战」。</li>
      </ol>
      <p>轮到玩家时有 {LAN_TABLE.turnSeconds} 秒操作。超时会自动过牌或弃牌。离开页面或断开后需要重新配对。若同一 Wi-Fi 仍无法连接，请确认路由器允许设备互访，或换用另一组设备都能加入的 Wi-Fi。</p>
      <p>房主设备负责发牌与结算，适合互相信任的朋友娱乐。对战使用独立的虚拟筹码。</p>
    </section>}
  </div>;
}

const secondsRemaining = (endsAt: number) => Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));

function TurnClock({ endsAt }: { endsAt: number }) {
  const [seconds, setSeconds] = useState(() => secondsRemaining(endsAt));
  useEffect(() => {
    const timer = setInterval(() => setSeconds(secondsRemaining(endsAt)), 250);
    return () => clearInterval(timer);
  }, [endsAt]);
  return <span className="lan-time" aria-label="剩余操作时间">{seconds} 秒</span>;
}

function LanTable({ view, role, turnEndsAt, pending, renderCard, sendMove, nextHand }: {
  view: LanView; role: Role; turnEndsAt: number; pending: boolean; renderCard: (card: string) => ReactNode;
  sendMove: (type: LanActionType, target?: number) => void; nextHand: () => void;
}) {
  const ownSeat = role === "host" ? 0 : 1;
  const opponent = otherLanSeat(ownSeat);
  const yourTurn = view.actingSeat === ownSeat;
  const nextTarget = view.minTarget ?? 0;
  const [target, setTarget] = useState(String(nextTarget));
  const amount = Number(target);
  const legalTarget = view.minTarget !== null && Number.isSafeInteger(amount) && amount >= view.minTarget && amount <= view.maxTarget;
  const raiseType = Math.max(...view.streetBets) > 0 ? "raise" : "bet";
  const winnerText = view.result?.winners.length === 2 ? "平分底池" : view.result?.winners.includes(ownSeat) ? "你赢得底池" : "好友赢得底池";
  const canContinue = view.stacks.every((stack) => stack > 0);

  return <section className="lan-panel lan-game">
    <div className="lan-handbar"><strong>第 {view.number} 手</strong><span>{streetLabels[view.street]}</span><span>庄家 {view.dealer === ownSeat ? "你" : "好友"}</span></div>
    <div className="lan-felt">
      <div className="lan-seat" data-acting={view.actingSeat === opponent}>
        <p><strong>好友</strong><span>剩余 {view.stacks[opponent].toLocaleString()}</span><span>本轮投入 {view.streetBets[opponent].toLocaleString()}</span></p>
        <div className="lan-cards" role="group" aria-label="好友底牌">
          {view.opponentCards.length ? view.opponentCards.map(renderCard) : <><i className="lan-card-back" /><i className="lan-card-back" /></>}
        </div>
      </div>
      <div className="lan-board">
        <strong>底池 {view.pot.toLocaleString()}</strong>
        <div className="lan-cards" role="group" aria-label="公共牌">
          {view.board.map(renderCard)}
          {Array.from({ length: 5 - view.board.length }, (_, index) => <i className="lan-card-slot" key={index} />)}
        </div>
      </div>
      <div className="lan-seat" data-acting={yourTurn}>
        <div className="lan-cards" role="group" aria-label="你的底牌">{view.cards.map(renderCard)}</div>
        <p><strong>你</strong><span>剩余 {view.stacks[ownSeat].toLocaleString()}</span><span>本轮投入 {view.streetBets[ownSeat].toLocaleString()}</span></p>
      </div>
    </div>

    {view.result ? <section className="lan-result" role="status">
      <h2>{winnerText}</h2>
      <p>{view.result.reason === "fold" ? "本手以弃牌结束" : view.result.handLabel}</p>
      {!canContinue && <p>一方筹码已用完，重新开桌会为双方补发 {LAN_TABLE.buyIn.toLocaleString()} 筹码。</p>}
      {role === "host" ? <button className="btn primary" onClick={nextHand}>{canContinue ? "下一手" : "重新开桌"}</button> : <p>等待房主开始下一手。</p>}
    </section> : <>
      <div className="lan-turn">
        <strong role="status">{pending ? "正在提交操作…" : yourTurn ? "轮到你操作" : "等待好友操作"}</strong>
        {view.lastMove && <span>{view.lastMove.seat === ownSeat ? "你" : "好友"}{actionLabels[view.lastMove.type]}</span>}
        {turnEndsAt > 0 && <TurnClock endsAt={turnEndsAt} />}
      </div>
      {yourTurn && <div className="lan-buttons lan-actions">
        <button className="btn ghost" disabled={pending} onClick={() => sendMove("fold")}>弃牌</button>
        {view.toCall > 0
          ? <button className="btn green" disabled={pending} onClick={() => sendMove("call")}>跟注 {Math.min(view.toCall, view.stacks[ownSeat]).toLocaleString()}</button>
          : <button className="btn green" disabled={pending} onClick={() => sendMove("check")}>过牌</button>}
        {view.minTarget !== null && <>
          <label className="lan-bet">{actionLabels[raiseType]}金额
            <input type="number" inputMode="numeric" min={view.minTarget} max={view.maxTarget} value={target}
              onChange={(event) => setTarget(event.target.value)} disabled={pending} />
          </label>
          <button className="btn primary" disabled={pending || !legalTarget} onClick={() => sendMove(raiseType, amount)}>
            {amount === view.maxTarget ? "全下" : actionLabels[raiseType]}
          </button>
        </>}
      </div>}
    </>}
  </section>;
}
