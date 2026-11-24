import { actionTarget, bestOfSeven, canRaise, dealRandomHand, settlePots, type DealtHand } from "./poker-core";
import { tableConfig } from "./table-config";

export const LAN_TABLE = tableConfig({});
export type LanSeat = 0 | 1;
export type LanActionType = "fold" | "check" | "call" | "bet" | "raise";
export type LanMove = { revision: number; type: LanActionType; target: number };
type Pair = [number, number];
type LanResult = { reason: "fold" | "showdown"; winners: number[]; handLabel: string };
type LastMove = { seat: LanSeat; type: LanActionType; amount: number };
type LanHand = {
  number: number;
  revision: number;
  dealer: LanSeat;
  deal: DealtHand;
  street: number;
  actingSeat: LanSeat | null;
  stacks: Pair;
  streetBets: Pair;
  totalBets: Pair;
  currentBet: number;
  minRaise: number;
  actedAt: Record<number, number>;
  lastMove: LastMove | null;
  pot: number;
  result: LanResult | null;
};

export const otherLanSeat = (seat: LanSeat): LanSeat => seat === 0 ? 1 : 0;
const boardSizes = [0, 3, 4, 5];

export function createLanHand(index: number, chips: readonly number[] = [LAN_TABLE.buyIn, LAN_TABLE.buyIn], revision = 1): LanHand {
  const dealer = index % 2 === 0 ? 0 : 1;
  const bigBlindSeat = otherLanSeat(dealer);
  const blinds: Pair = [0, 0];
  blinds[dealer] = Math.min(chips[dealer], LAN_TABLE.smallBlind);
  blinds[bigBlindSeat] = Math.min(chips[bigBlindSeat], LAN_TABLE.bigBlind);
  const hand: LanHand = {
    number: index + 1, revision, dealer,
    deal: dealRandomHand("", { players: 2, random: secureRandom }),
    street: 0, actingSeat: dealer,
    stacks: [chips[0] - blinds[0], chips[1] - blinds[1]],
    streetBets: [...blinds], totalBets: [...blinds],
    currentBet: Math.max(...blinds), minRaise: LAN_TABLE.bigBlind,
    actedAt: {}, lastMove: null, pot: blinds[0] + blinds[1], result: null,
  };
  return advanceIfReady(hand);
}

function secureRandom() {
  return crypto.getRandomValues(new Uint32Array(1))[0] / 0x100000000;
}

function settle(hand: LanHand, folded?: LanSeat): LanHand {
  const active = folded === undefined ? [0, 1] : [otherLanSeat(folded)];
  const { payouts, sidePots, winningSeats, mainWinner } = settlePots(
    hand.totalBets, active, hand.deal.players, hand.deal.board, hand.dealer,
  );
  return {
    ...hand,
    actingSeat: null,
    street: folded === undefined ? 3 : hand.street,
    stacks: [hand.stacks[0] + payouts[0], hand.stacks[1] + payouts[1]],
    pot: sidePots.reduce((sum, amount) => sum + amount, 0),
    result: {
      reason: folded === undefined ? "showdown" : "fold",
      winners: winningSeats,
      handLabel: folded === undefined ? bestOfSeven([...hand.deal.players[mainWinner], ...hand.deal.board]).label : "",
    },
  };
}

function advanceIfReady(hand: LanHand): LanHand {
  if (hand.stacks.includes(0)) {
    const owesChips = ([0, 1] as const).find((seat) => hand.stacks[seat] > 0 && hand.streetBets[seat] < hand.currentBet);
    return owesChips === undefined ? settle(hand) : { ...hand, actingSeat: owesChips };
  }

  if (Object.keys(hand.actedAt).length < 2 || hand.streetBets[0] !== hand.streetBets[1]) return hand;
  if (hand.street === 3) return settle(hand);
  return {
    ...hand, street: hand.street + 1, actingSeat: otherLanSeat(hand.dealer),
    streetBets: [0, 0], currentBet: 0, minRaise: LAN_TABLE.bigBlind, actedAt: {},
  };
}

function canLanRaise(hand: LanHand, seat: LanSeat) {
  return hand.stacks[otherLanSeat(seat)] > 0 && canRaise(hand, seat);
}

export function applyLanAction(hand: LanHand, seat: LanSeat, move: LanMove): LanHand | null {
  if (hand.actingSeat !== seat || hand.revision !== move.revision) return null;
  if (move.type === "call" && hand.currentBet <= hand.streetBets[seat]) return null;
  if ((move.type === "bet" || move.type === "raise") && !canLanRaise(hand, seat)) return null;
  const target = actionTarget(hand, seat, move.type, move.target);
  if (target === null) return null;

  const revision = hand.revision + 1;
  if (move.type === "fold") return settle({ ...hand, revision, lastMove: { seat, type: "fold", amount: 0 } }, seat);

  const amount = target - hand.streetBets[seat];
  const stacks: Pair = [...hand.stacks];
  const streetBets: Pair = [...hand.streetBets];
  const totalBets: Pair = [...hand.totalBets];
  stacks[seat] -= amount;
  streetBets[seat] = target;
  totalBets[seat] += amount;
  const raisedBy = target - hand.currentBet;
  const currentBet = Math.max(hand.currentBet, target);
  const fullRaise = raisedBy >= hand.minRaise;
  const actedAt = fullRaise ? { [seat]: currentBet } : { ...hand.actedAt, [seat]: currentBet };
  const type = raisedBy > 0 ? (hand.currentBet > 0 ? "raise" : "bet") : move.type;
  return advanceIfReady({
    ...hand, revision, stacks, streetBets, totalBets, currentBet, actedAt,
    minRaise: fullRaise ? raisedBy : hand.minRaise,
    actingSeat: otherLanSeat(seat), lastMove: { seat, type, amount }, pot: hand.pot + amount,
  });
}

export function lanView(hand: LanHand, seat: LanSeat) {
  const maxTarget = hand.streetBets[seat] + hand.stacks[seat];
  return {
    number: hand.number, revision: hand.revision, dealer: hand.dealer, actingSeat: hand.actingSeat,
    stacks: hand.stacks, streetBets: hand.streetBets,
    street: hand.street, board: hand.deal.board.slice(0, boardSizes[hand.street]),
    cards: hand.deal.players[seat],
    opponentCards: hand.result?.reason === "showdown" ? hand.deal.players[otherLanSeat(seat)] : [],
    pot: hand.pot, result: hand.result, lastMove: hand.lastMove,
    toCall: Math.max(0, hand.currentBet - hand.streetBets[seat]),
    minTarget: hand.actingSeat === seat && canLanRaise(hand, seat) ? Math.min(maxTarget, hand.currentBet + hand.minRaise) : null,
    maxTarget,
  };
}

export type LanView = ReturnType<typeof lanView>;


export function isLanView(data: unknown): data is LanView {
  if (!data || typeof data !== "object") return false;
  const value = data as Partial<LanView>;
  const isChipCount = (count: unknown): count is number => typeof count === "number" && Number.isSafeInteger(count) && count >= 0;
  const isSeat = (seat: unknown) => seat === 0 || seat === 1;
  const isPair = (pair: unknown) => Array.isArray(pair) && pair.length === 2 && pair.every(isChipCount);
  const isCards = (list: unknown, size: number) => Array.isArray(list) && list.length === size && list.every((card) =>
    typeof card === "string" && /^(?:[2-9JQKA]|10)[♠♥♦♣]$/.test(card));

  const { street, actingSeat, result, lastMove } = value;
  if (!isChipCount(street) || street > 3 || !isChipCount(value.number) || !isChipCount(value.revision)
    || !isSeat(value.dealer) || !isPair(value.stacks) || !isPair(value.streetBets)
    || !isCards(value.cards, 2) || !isCards(value.board, boardSizes[street])
    || !isChipCount(value.pot) || !isChipCount(value.toCall) || !isChipCount(value.maxTarget)
    || (value.minTarget !== null && (!isChipCount(value.minTarget) || value.minTarget > value.maxTarget))) return false;

  if (lastMove !== null && (!lastMove || !isSeat(lastMove.seat) || !isChipCount(lastMove.amount)
    || !["fold", "check", "call", "bet", "raise"].includes(lastMove.type))) return false;

  if (result === null) return isSeat(actingSeat) && isCards(value.opponentCards, 0);
  return actingSeat === null && !!result && ["fold", "showdown"].includes(result.reason)
    && typeof result.handLabel === "string" && Array.isArray(result.winners)
    && result.winners.length >= 1 && result.winners.length <= 2 && result.winners.every(isSeat)
    && isCards(value.opponentCards, result.reason === "showdown" ? 2 : 0);
}
