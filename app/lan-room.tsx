import { useEffect, useRef, useState, type ReactNode } from "react";
import { createLanPeer } from "./lan-peer";
import { applyLanAction, createLanHand, isLanRoster, isLanView, LAN_MAX_PLAYERS, LAN_TABLE, lanView, type LanActionType, type LanMove, type LanView } from "./lan-poker";

type Role = "host" | "guest";
type Peer = ReturnType<typeof createLanPeer>;
type Hand = ReturnType<typeof createLanHand>;
type GuestLink = { peer: Peer; ready: boolean };

const actionLabels = { fold: "弃牌", check: "过牌", call: "跟注", bet: "下注", raise: "加注" };
const streetLabels = ["翻牌前", "翻牌圈", "转牌圈", "河牌圈"];
const guestSeats = Array.from({ length: LAN_MAX_PLAYERS - 1 }, (_, index) => index + 1);
const seatName = (seat: number) => seat === 0 ? "房主" : "好友 " + seat;

function isLanMove(data: unknown): data is LanMove {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<LanMove>;
  return Number.isSafeInteger(value.revision) && Number.isSafeInteger(value.target) &&
    typeof value.type === "string" && Object.hasOwn(actionLabels, value.type);
}

export function LanRoom({ leave, renderCard }: { leave: () => void; renderCard: (card: string) => ReactNode }) {
  const [role, setRole] = useState<Role | null>(null);
  const [roster, setRoster] = useState<number[]>([0]);
  const [guestSeat, setGuestSeat] = useState<number | null>(null);
  const [disconnected, setDisconnected] = useState(false);
  const [pairing, setPairing] = useState(false);
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

  const links = useRef(new Map<number, GuestLink>());
  const hostPeer = useRef<Peer | null>(null);
  const pendingSeat = useRef<number | null>(null);
  const localSeat = useRef<number | null>(null);
  const hand = useRef<Hand | null>(null);
  const deadline = useRef(0);
  const turnTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const codeField = useRef<HTMLTextAreaElement>(null);
  const pairingAttempt = useRef(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
    const peers = links.current;
    return () => {
      pairingAttempt.current++;
      for (const link of peers.values()) link.peer.close();
      peers.clear();
      hostPeer.current?.close();
      clearTimeout(turnTimer.current);
    };
  }, []);

  function clearPairing() {
    pairingAttempt.current++;
    pendingSeat.current = null;
    setPairing(false);
    setLocalCode("");
    setRemoteCode("");
    setBusy(false);
    setWaiting(false);
    setCopyFeedback("");
  }

  function cancelInvite() {
    const seat = pendingSeat.current;
    if (seat !== null) {
      links.current.get(seat)?.peer.close();
      links.current.delete(seat);
    }
    clearPairing();
    setError("");
  }

  function reset() {
    for (const link of links.current.values()) link.peer.close();
    links.current.clear();
    hostPeer.current?.close();
    hostPeer.current = null;
    localSeat.current = null;
    hand.current = null;
    deadline.current = 0;
    clearTimeout(turnTimer.current);
    clearPairing();
    setRole(null);
    setRoster([0]);
    setGuestSeat(null);
    setDisconnected(false);
    setSubmitted(null);
    setError("");
    setView(null);
    setTurnEndsAt(0);
    setConfirmExit(false);
  }

  function connectedSeats() {
    return [0, ...guestSeats.filter((seat) => links.current.get(seat)?.ready)];
  }

  function syncRoster() {
    const seats = connectedSeats();
    setRoster(seats);
    for (const seat of seats.slice(1)) {
      links.current.get(seat)?.peer.send({ kind: "room", seat, seats });
    }
  }

  function expireTurn(revision: number) {
    const current = hand.current;
    if (!current || current.revision !== revision || current.actingSeat === null) return;
    const player = current.actingSeat;
    const move = lanView(current, player).toCall > 0 ? "fold" : "check";
    const next = applyLanAction(current, player, { revision, type: move, target: 0 });
    if (next) publish(next);
  }

  function scheduleTurn(next: Hand) {
    clearTimeout(turnTimer.current);
    const seat = next.actingSeat;
    const online = seat === 0 || (seat !== null && links.current.get(seat)?.ready);
    const duration = seat === null ? 0 : online ? LAN_TABLE.turnSeconds * 1000 : 250;
    deadline.current = duration ? Date.now() + duration : 0;
    if (duration) turnTimer.current = setTimeout(() => expireTurn(next.revision), duration);
    setTurnEndsAt(deadline.current);
  }

  function publish(next: Hand) {
    hand.current = next;
    for (const seat of connectedSeats().slice(1)) {
      if (next.seats.includes(seat)) links.current.get(seat)?.peer.send({ kind: "view", view: lanView(next, seat) });
    }
    scheduleTurn(next);
    setView(lanView(next, 0));
  }

  function handleMove(seat: number, move: LanMove) {
    const current = hand.current;
    if (!current || !deadline.current || current.revision !== move.revision) return;
    if (Date.now() >= deadline.current) {
      expireTurn(current.revision);
      return;
    }
    const next = applyLanAction(current, seat, move);
    if (next) publish(next);
    else if (seat !== 0) links.current.get(seat)?.peer.send({ kind: "invalid", revision: move.revision });
    else setError("这个操作不符合当前牌局，请重新选择。");
  }

  function connectGuest(seat: number) {
    const peer = createLanPeer("host", {
      open: () => {
        const link = links.current.get(seat);
        if (!link || link.peer !== peer) return;
        link.ready = true;
        if (pendingSeat.current === seat) clearPairing();
        setError("");
        syncRoster();
      },
      disconnected: () => {
        const link = links.current.get(seat);
        if (!link || link.peer !== peer) return;
        links.current.delete(seat);
        if (pendingSeat.current === seat) {
          clearPairing();
          setError("这次连接未成功，请确认双方在同一 Wi-Fi，再邀请好友。");
        }
        syncRoster();
        if (hand.current?.actingSeat === seat) scheduleTurn(hand.current);
      },
      message: (data) => {
        if (!data || typeof data !== "object" || links.current.get(seat)?.peer !== peer) return;
        const message = data as { kind?: string; move?: unknown };
        if (message.kind === "move" && isLanMove(message.move)) handleMove(seat, message.move);
      },
    });
    links.current.set(seat, { peer, ready: false });
    pendingSeat.current = seat;
    return peer;
  }

  function connectToHost() {
    const peer = createLanPeer("guest", {
      open: () => { setError(""); },
      disconnected: () => { setDisconnected(true); },
      message: (data) => {
        if (!data || typeof data !== "object") return;
        const message = data as { kind?: string; seat?: number; seats?: unknown; view?: unknown; revision?: unknown };
        if (message.kind === "room" && isLanRoster(message.seats) && message.seat !== undefined &&
          message.seat !== 0 && message.seats.includes(message.seat) &&
          (localSeat.current === null || localSeat.current === message.seat)) {
          localSeat.current = message.seat;
          setGuestSeat(message.seat);
          setRoster(message.seats);
        }
        if (message.kind === "view" && localSeat.current !== null && isLanView(message.view) && message.view.seats.includes(localSeat.current)) {
          setView(message.view);
          setTurnEndsAt(message.view.actingSeat === null ? 0 : Date.now() + LAN_TABLE.turnSeconds * 1000);
          setSubmitted(null);
          setError("");
        }
        if (message.kind === "invalid") {
          setSubmitted((current) => current === message.revision ? null : current);
          setError("这个操作不符合当前牌局，请重新选择。");
        }
      },
    });
    hostPeer.current = peer;
    return peer;
  }

  async function runPairing(mode: "invite" | "answer" | "accept") {
    const attempt = ++pairingAttempt.current;
    setBusy(true);
    setError("");
    try {
      if (mode === "invite") {
        setPairing(true);
        const seat = guestSeats.find((position) => !links.current.has(position));
        if (seat === undefined || hand.current) return;
        const code = await connectGuest(seat).invite();
        if (pairingAttempt.current === attempt) setLocalCode(code);
      } else if (mode === "answer") {
        const code = await connectToHost().answer(remoteCode);
        if (pairingAttempt.current === attempt) setLocalCode(code);
      } else {
        const seat = pendingSeat.current;
        if (seat === null) return;
        await links.current.get(seat)?.peer.accept(remoteCode);
        if (pairingAttempt.current === attempt) setWaiting(true);
      }
    } catch (cause) {
      if (pairingAttempt.current !== attempt) return;
      if (mode === "invite" && pendingSeat.current !== null) {
        links.current.get(pendingSeat.current)?.peer.close();
        links.current.delete(pendingSeat.current);
        pendingSeat.current = null;
      }
      if (mode === "answer") {
        hostPeer.current?.close();
        hostPeer.current = null;
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
    const seats = connectedSeats();
    const previous = hand.current;
    if (role !== "host" || seats.length < 2 || pendingSeat.current !== null || (previous && !previous.result)) return;
    const headsUpReset = seats.length === 2 && previous?.seats.length === 2 && seats.some((seat) => previous.stacks[seat] === 0);
    const chips = Array.from({ length: seats.at(-1)! + 1 }, (_, seat) =>
      seats.includes(seat) ? (headsUpReset ? LAN_TABLE.buyIn : previous?.stacks[seat] || LAN_TABLE.buyIn) : 0);
    setError("");
    publish(createLanHand(headsUpReset ? 0 : previous?.number ?? 0, chips, (previous?.revision ?? 0) + 1, headsUpReset ? undefined : previous?.dealer));
  }

  function sendMove(type: LanActionType, target = 0) {
    if (disconnected || !view || view.actingSeat !== (role === "host" ? 0 : guestSeat)) return;
    const move = { revision: view.revision, type, target };
    setError("");
    if (role === "host") handleMove(0, move);
    else if (submitted !== view.revision && hostPeer.current?.send({ kind: "move", move })) setSubmitted(view.revision);
  }

  const inRoom = role === "host" || guestSeat !== null;
  const isHost = role === "host";
  const showPairing = isHost ? pairing : role === "guest" && !inRoom;

  return <div className="page-content standard-page lan-room">
    <header className="page-heading lan-heading">
      <div><h1>局域网好友对战</h1><p>2～{LAN_MAX_PLAYERS} 人德州扑克 · {LAN_TABLE.smallBlind} / {LAN_TABLE.bigBlind} 盲注 · 每人 {LAN_TABLE.buyIn.toLocaleString()} 虚拟筹码</p></div>
      <button className="btn ghost" onClick={() => role ? setConfirmExit(true) : leave()}>{role ? "退出对战" : "返回大厅"}</button>
    </header>

    {confirmExit && <section className="lan-panel lan-exit" aria-label="退出确认">
      <p>{isHost ? "房主退出会结束整个房间。" : "退出后，你的座位将离线。"}</p>
      <button className="btn ghost" onClick={() => setConfirmExit(false)}>继续留在房间</button>
      <button className="btn primary" onClick={() => { reset(); leave(); }}>确认退出</button>
    </section>}

    {error && <p className="lan-feedback lan-error" role="alert">{error}</p>}

    {disconnected ? <section className="lan-panel">
      <h2>连接已断开</h2>
      <p>请确认双方连接同一个 Wi-Fi，保持网页打开，然后重新配对。对局开始后需要等房主另开房间。</p>
      <button className="btn primary" onClick={reset}>重新配对</button>
    </section> : <>
      {!role && <section className="lan-panel lan-pair">
        <h2>和好友开一桌</h2>
        <div className="lan-buttons">
          <button className="btn primary" onClick={() => { setRole("host"); void runPairing("invite"); }}>创建好友房</button>
          <button className="btn green" onClick={() => setRole("guest")}>加入好友房</button>
        </div>
      </section>}

      {inRoom && !view && <section className="lan-panel">
        <h2>好友房等候区</h2>
        <p role="status">{roster.length} / {LAN_MAX_PLAYERS} 人已连接</p>
        <ul className="lan-roster">{roster.map((seat) => <li key={seat}>{seatName(seat)}{seat === (isHost ? 0 : guestSeat) && "（你）"}</li>)}</ul>
        {isHost ? <div className="lan-buttons">
          {!pairing && roster.length < LAN_MAX_PLAYERS && <button className="btn green" onClick={() => void runPairing("invite")}>{roster.length > 1 ? "邀请下一位好友" : "邀请好友"}</button>}
          <button className="btn primary" disabled={roster.length < 2 || pairing} onClick={nextHand}>开始对战</button>
        </div> : <p>等待房主邀请其他好友或开始对战。</p>}
      </section>}

      {showPairing && <section className="lan-panel lan-pair">
        <h2>{isHost ? "邀请一位好友" : "好友配对"}</h2>
        {!isHost && !localCode && <>
          <label className="lan-field">好友的邀请信息<textarea rows={3} value={remoteCode} onChange={(event) => setRemoteCode(event.target.value)} /></label>
          <button className="btn primary" disabled={busy || !remoteCode.trim()} onClick={() => void runPairing("answer")}>{busy ? "正在生成…" : "生成应答"}</button>
        </>}
        {isHost && !localCode && (busy ? <p role="status">正在生成邀请信息…</p> :
          <button className="btn primary" onClick={() => void runPairing("invite")}>重新生成邀请</button>)}
        {localCode && <>
          <label className="lan-field">{isHost ? "我的邀请信息" : "我的应答信息"}<textarea ref={codeField} rows={3} readOnly value={localCode} onFocus={(event) => event.currentTarget.select()} /></label>
          <div className="lan-buttons">
            <button className="btn green" onClick={() => void copyCode()}>{isHost ? "复制邀请" : "复制应答"}</button>
            <span role="status">{copyFeedback}</span>
          </div>
          {isHost ? <>
            <label className="lan-field">好友的应答信息<textarea rows={3} value={remoteCode} disabled={waiting} onChange={(event) => setRemoteCode(event.target.value)} /></label>
            <button className="btn primary" disabled={busy || waiting || !remoteCode.trim()} onClick={() => void runPairing("accept")}>{waiting ? "正在连接…" : "连接好友"}</button>
          </> : <p role="status">把应答信息发回给房主，等待对方连接。</p>}
        </>}
        <button className="btn ghost lan-reset" onClick={isHost ? cancelInvite : reset}>{isHost ? "取消这次邀请" : "返回配对选择"}</button>
      </section>}

      {view && inRoom && <LanTable key={view.revision} view={view} ownSeat={isHost ? 0 : guestSeat!} roster={roster} turnEndsAt={turnEndsAt}
        pending={submitted === view.revision} renderCard={renderCard} sendMove={sendMove} nextHand={nextHand} />}
      {isHost && view && roster.length < 2 && <section className="lan-panel">
        <h2>其他玩家已离线</h2><p>至少两人才能继续。请回到配对选择重新开房。</p>
        <button className="btn primary" onClick={reset}>重新开房</button>
      </section>}
    </>}

    {!view && <section className="lan-panel lan-guide">
      <h2>使用说明</h2>
      <ol>
        <li>所有设备连同一个 Wi-Fi，在游戏大厅选择「和好友同桌」。房间最多 6 人，至少 2 人可开局。</li>
        <li>房主点「创建好友房」，把当前完整邀请发给一位好友。</li>
        <li>好友点「加入好友房」，粘贴邀请，点「生成应答」，把完整应答发回房主。</li>
        <li>房主粘贴应答并点「连接好友」。需要更多人时，点「邀请下一位好友」，每位好友使用自己的邀请和应答。人齐后点「开始对战」。</li>
      </ol>
      <p>每次轮到玩家有 {LAN_TABLE.turnSeconds} 秒。玩家掉线后会自动过牌或弃牌，剩余玩家可以继续。对战开始后无法再加入，房主退出会结束房间。</p>
      <p>全下时按投入拆分主池和边池，由房主设备发牌和结算。同一 Wi-Fi 仍无法连接时，请检查路由器是否允许设备互访。</p>
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

function LanTable({ view, ownSeat, roster, turnEndsAt, pending, renderCard, sendMove, nextHand }: {
  view: LanView; ownSeat: number; roster: number[]; turnEndsAt: number; pending: boolean;
  renderCard: (card: string) => ReactNode; sendMove: (type: LanActionType, target?: number) => void; nextHand: () => void;
}) {
  const yourTurn = view.actingSeat === ownSeat;
  const nextTarget = view.minTarget ?? 0;
  const [target, setTarget] = useState(String(nextTarget));
  const amount = Number(target);
  const legalTarget = view.minTarget !== null && Number.isSafeInteger(amount) && amount >= view.minTarget && amount <= view.maxTarget;
  const raiseType = Math.max(...view.streetBets) > 0 || view.toCall > 0 ? "raise" : "bet";
  const label = (seat: number) => seat === ownSeat ? "你" : seatName(seat);
  const result = view.result;
  const splitPots = !!result && result.pots.length > 1;
  const won = result?.winners.includes(ownSeat);
  let winnerText = won ? "你赢得底池" : "好友赢得底池";
  if (result && result.winners.length > 1) {
    if (!splitPots) winnerText = "平分底池";
    else if (won) winnerText = "你赢得部分底池";
  }
  const busted = roster.filter((seat) => view.stacks[seat] === 0);
  const resetChips = view.seats.length === 2 && roster.length === 2 && busted.length > 0;

  function drawSeat(seat: number) {
    const own = seat === ownSeat;
    const cards = own ? view.cards : view.revealed[seat];
    const status = !roster.includes(seat) ? "已离线" : !view.active.includes(seat) ? "已弃牌" : !result && view.stacks[seat] === 0 ? "全下" : "";
    return <div className="lan-seat" key={seat} data-acting={view.actingSeat === seat}>
      <p><strong>{label(seat)}</strong><span>剩余 {view.stacks[seat].toLocaleString()}</span><span>本轮投入 {view.streetBets[seat].toLocaleString()}</span>{status && <span>{status}</span>}</p>
      <div className="lan-cards" role="group" aria-label={own ? "你的底牌" : seatName(seat) + "底牌"}>
        {cards.length ? cards.map(renderCard) : <><i className="lan-card-back" /><i className="lan-card-back" /></>}
      </div>
    </div>;
  }

  return <section className="lan-panel lan-game">
    <div className="lan-handbar"><strong>第 {view.number} 手</strong><span>{streetLabels[view.street]}</span><span>庄家 {label(view.dealer)}</span><span>{roster.length} 人在线</span></div>
    <div className="lan-felt">
      <div className="lan-opponents">{view.seats.filter((seat) => seat !== ownSeat).map(drawSeat)}</div>
      <div className="lan-board">
        <strong>底池 {view.pot.toLocaleString()}</strong>
        <div className="lan-cards" role="group" aria-label="公共牌">
          {view.board.map(renderCard)}
          {Array.from({ length: 5 - view.board.length }, (_, index) => <i className="lan-card-slot" key={index} />)}
        </div>
      </div>
      {drawSeat(ownSeat)}
    </div>

    {result ? <section className="lan-result" role="status">
      <h2>{winnerText}</h2>
      <p>{result.reason === "fold" ? "本手以弃牌结束" : "主池获胜牌型 · " + result.handLabel}</p>
      {splitPots && <ul className="lan-roster">{result.pots.map((pot, index) => <li key={index}>{index ? "边池 " + index : "主池"} · {pot.toLocaleString()}</li>)}</ul>}
      {result.payouts[ownSeat] > 0 && <p>本手收到 {result.payouts[ownSeat].toLocaleString()} 筹码（含退回的未跟注部分）</p>}
      {busted.length > 0 && roster.length > 1 && <p>{resetChips ? "重新开桌会为双方补发" : "下一手会为筹码用完的玩家补发"} {LAN_TABLE.buyIn.toLocaleString()} 筹码。</p>}
      {ownSeat === 0 ? <button className="btn primary" disabled={roster.length < 2} onClick={nextHand}>{resetChips ? "重新开桌" : "下一手"}</button> : <p>等待房主开始下一手。</p>}
    </section> : <>
      <div className="lan-turn">
        <strong role="status">{pending ? "正在提交操作…" : yourTurn ? "轮到你操作" : view.actingSeat === null ? "正在结算" : "等待" + label(view.actingSeat) + "操作"}</strong>
        {view.lastMove && <span>{label(view.lastMove.seat)}{actionLabels[view.lastMove.type]}</span>}
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
