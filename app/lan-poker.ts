import { actionTarget, bestOfSeven, canRaise, dealRandomHand, settlePots, type DealtHand } from "./poker-core";
import { tableConfig } from "./table-config";

export const LAN_TABLE = tableConfig({});
export const LAN_MAX_PLAYERS = 6;
export type LanActionType = "fold" | "check" | "call" | "bet" | "raise";
export type LanMove = { revision: number; type: LanActionType; target: number };
type LanResult = { reason: "fold" | "showdown"; winners: number[]; handLabel: string; pots: number[]; payouts: number[] };
type LastMove = { seat: number; type: LanActionType; amount: number };
type LanHand = {
  number: number;
  revision: number;
  dealer: number;
  deal: DealtHand;
  seats: number[];
  active: number[];
  street: number;
  actingSeat: number | null;
  stacks: number[];
  streetBets: number[];
  totalBets: number[];
  currentBet: number;
  minRaise: number;
  actedAt: Record<number, number>;
  lastMove: LastMove | null;
  pot: number;
  result: LanResult | null;
};

const boardSizes = [0, 3, 4, 5];

function clockwise(after: number, seats: readonly number[]) {
  return seats.find((seat) => seat > after) ?? seats[0];
}

export function createLanHand(index: number, chips: readonly number[] = [LAN_TABLE.buyIn, LAN_TABLE.buyIn], revision = 1, previousDealer?: number): LanHand {
  const seats = chips.flatMap((stack, seat) => stack > 0 ? [seat] : []);
  if (seats.length < 2 || chips.length > LAN_MAX_PLAYERS) throw new Error("A LAN hand needs two to six seated players");
  const dealer = previousDealer === undefined ? seats[index % seats.length] : clockwise(previousDealer, seats);
  const small = seats.length === 2 ? dealer : clockwise(dealer, seats);
  const big = clockwise(small, seats);
  const blanks = chips.map(() => 0);
  const blinds = [...blanks];
  blinds[small] = Math.min(chips[small], LAN_TABLE.smallBlind);
  blinds[big] = Math.min(chips[big], LAN_TABLE.bigBlind);
  const deal = dealRandomHand("", { players: seats.length, random: secureRandom });
  const playerCards: string[][] = chips.map(() => []);
  seats.forEach((seat, index) => { playerCards[seat] = deal.players[index]; });
  const hand: LanHand = {
    number: index + 1, revision, dealer, deal: { ...deal, players: playerCards }, seats, active: seats,
    street: 0, actingSeat: null, stacks: chips.map((stack, seat) => stack - blinds[seat]),
    streetBets: blinds, totalBets: [...blinds],
    currentBet: LAN_TABLE.bigBlind, minRaise: LAN_TABLE.bigBlind,
    actedAt: {}, lastMove: null, pot: blinds[small] + blinds[big], result: null,
  };
  return advanceIfReady(hand, big);
}

function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
}

function settle(hand: LanHand): LanHand {
  const showdown = hand.active.length > 1;
  const { payouts, sidePots, winningSeats, mainWinner } = settlePots(
    hand.totalBets, hand.active, hand.deal.players, hand.deal.board, hand.dealer,
  );
  return {
    ...hand, actingSeat: null, street: showdown ? 3 : hand.street,
    stacks: hand.stacks.map((stack, seat) => stack + payouts[seat]),
    pot: sidePots.reduce((sum, amount) => sum + amount, 0),
    result: {
      reason: showdown ? "showdown" : "fold", winners: winningSeats, pots: sidePots, payouts,
      handLabel: showdown ? bestOfSeven([...hand.deal.players[mainWinner], ...hand.deal.board]).label : "",
    },
  };
}

function advanceIfReady(hand: LanHand, after: number): LanHand {
  if (hand.active.length === 1) return settle(hand);
  const eligible = hand.active.filter((seat) => hand.stacks[seat] > 0);
  if (eligible.length === 0) return settle(hand);
  if (eligible.length === 1) {
    const seat = eligible[0];
    const currentBet = Math.max(...hand.active.map((position) => hand.streetBets[position]));
    return hand.streetBets[seat] < currentBet ? { ...hand, currentBet, actingSeat: seat } : settle(hand);
  }

  const pending = eligible.filter((seat) => !Object.hasOwn(hand.actedAt, seat) || hand.streetBets[seat] < hand.currentBet);
  if (pending.length) return { ...hand, actingSeat: clockwise(after, pending) };
  if (hand.street === 3) return settle(hand);
  return {
    ...hand, street: hand.street + 1, actingSeat: clockwise(hand.dealer, eligible),
    streetBets: hand.stacks.map(() => 0), currentBet: 0, minRaise: LAN_TABLE.bigBlind, actedAt: {},
  };
}

function canLanRaise(hand: LanHand, seat: number) {
  return hand.active.some((position) => position !== seat && hand.stacks[position] > 0) && canRaise(hand, seat);
}

export function applyLanAction(hand: LanHand, seat: number, move: LanMove): LanHand | null {
  if (hand.actingSeat !== seat || hand.revision !== move.revision) return null;
  if (move.type === "call" && hand.currentBet <= hand.streetBets[seat]) return null;
  if ((move.type === "bet" || move.type === "raise") && !canLanRaise(hand, seat)) return null;
  const target = actionTarget(hand, seat, move.type, move.target);
  if (target === null) return null;

  const revision = hand.revision + 1;
  if (move.type === "fold") {
    return advanceIfReady({
      ...hand, revision, active: hand.active.filter((position) => position !== seat),
      lastMove: { seat, type: "fold", amount: 0 },
    }, seat);
  }

  const amount = target - hand.streetBets[seat];
  const stacks = [...hand.stacks];
  const streetBets = [...hand.streetBets];
  const totalBets = [...hand.totalBets];
  stacks[seat] -= amount;
  streetBets[seat] = target;
  totalBets[seat] += amount;
  const raisedBy = target - hand.currentBet;
  const currentBet = Math.max(hand.currentBet, target);
  const type = raisedBy > 0 ? (hand.currentBet > 0 ? "raise" : "bet") : move.type;
  return advanceIfReady({
    ...hand, revision, stacks, streetBets, totalBets, currentBet,
    minRaise: Math.max(hand.minRaise, raisedBy), actedAt: { ...hand.actedAt, [seat]: currentBet },
    lastMove: { seat, type, amount }, pot: hand.pot + amount,
  }, seat);
}

export function lanView(hand: LanHand, seat: number) {
  const maxTarget = hand.streetBets[seat] + hand.stacks[seat];
  const canReveal = hand.result?.reason === "showdown";
  return {
    number: hand.number, revision: hand.revision, dealer: hand.dealer, actingSeat: hand.actingSeat,
    seats: hand.seats, active: hand.active, stacks: hand.stacks, streetBets: hand.streetBets,
    street: hand.street, board: hand.deal.board.slice(0, boardSizes[hand.street]),
    cards: hand.deal.players[seat],
    revealed: hand.deal.players.map((cards, position) => canReveal && position !== seat && hand.active.includes(position) ? cards : []),
    pot: hand.pot, result: hand.result, lastMove: hand.lastMove,
    toCall: Math.max(0, hand.currentBet - hand.streetBets[seat]),
    minTarget: hand.actingSeat === seat && canLanRaise(hand, seat) ? Math.min(maxTarget, hand.currentBet + hand.minRaise) : null,
    maxTarget,
  };
}

export type LanView = ReturnType<typeof lanView>;

export function isLanRoster(data: unknown): data is number[] {
  return Array.isArray(data) && data.length > 0 && data[0] === 0 && data.length <= LAN_MAX_PLAYERS
    && data.every((seat, index) => typeof seat === "number" && Number.isInteger(seat)
      && seat >= 0 && seat < LAN_MAX_PLAYERS && (index === 0 || data[index - 1] < seat));
}

export function isLanView(data: unknown): data is LanView {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<LanView>;
  const isCount = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const isCards = (list: unknown, size: number) => Array.isArray(list) && list.length === size && list.every((card) =>
    typeof card === "string" && /^(?:[2-9JQKA]|10)[♠♥♦♣]$/.test(card));
  const { street, actingSeat, result, lastMove, seats, active, stacks, streetBets, revealed } = value;
  if (!isLanRoster(seats) || seats.length < 2 || !Array.isArray(stacks) || stacks.length !== seats.at(-1)! + 1) return false;
  const isSeat = (seat: number) => seats.includes(seat);
  const isStackList = (list: unknown) => Array.isArray(list) && list.length === stacks.length && list.every(isCount);
  if (!isCount(street) || street > 3 || !isCount(value.number) || !isCount(value.revision)
    || !isSeat(value.dealer!) || !isStackList(stacks) || !isStackList(streetBets)
    || !Array.isArray(active) || active.length < 1 || active.length > seats.length || !active.every(isSeat)
    || !isCards(value.cards, 2) || !isCards(value.board, boardSizes[street])
    || !Array.isArray(revealed) || revealed.length !== stacks.length
    || !revealed.every((cards, seat) => isCards(cards, 0) || (result?.reason === "showdown" && active.includes(seat) && isCards(cards, 2)))
    || !isCount(value.pot) || !isCount(value.toCall) || !isCount(value.maxTarget)
    || (value.minTarget !== null && (!isCount(value.minTarget) || value.minTarget > value.maxTarget))) return false;
  if (lastMove !== null && (!lastMove || !isSeat(lastMove.seat) || !isCount(lastMove.amount)
    || !["fold", "check", "call", "bet", "raise"].includes(lastMove.type))) return false;
  if (result === null) return actingSeat !== undefined && actingSeat !== null && active.includes(actingSeat);
  return actingSeat === null && !!result && ["fold", "showdown"].includes(result.reason)
    && typeof result.handLabel === "string" && Array.isArray(result.winners)
    && result.winners.length >= 1 && result.winners.length <= active.length && result.winners.every((seat) => active.includes(seat))
    && Array.isArray(result.pots) && result.pots.length <= seats.length && result.pots.every(isCount) && isStackList(result.payouts);
}
