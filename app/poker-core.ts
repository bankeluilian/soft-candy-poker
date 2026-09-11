export type DealtHand = { id: string; players: string[][]; board: string[]; burn?: string[] };
export type HandScore = { category: number; tiebreak: number[]; label: string; bestFive: string[] };
const cardRanks = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const cardSuits = ["♠", "♥", "♦", "♣"];
const rankValue: Record<string, number> = Object.fromEntries(cardRanks.map((rank, index) => [rank, index + 2]));

/** Expected share of the pot against random holdings; all tied winners share equally. */
export function estimateEquity(hand: string[], board: string[], opponents: number, trials = 320, random = Math.random) {
  if (!Number.isInteger(opponents) || opponents < 0 || opponents > 5 || !Number.isInteger(trials) || trials < 1) throw new Error("Invalid simulation size");
  if (opponents === 0) return 1;
  const known = new Set([...hand, ...board]);
  const remaining = cardSuits.flatMap((suit) => cardRanks.map((rank) => `${rank}${suit}`)).filter((card) => !known.has(card));
  const boardCards = 5 - board.length;
  let total = 0;
  for (let run = 0; run < trials; run++) {
    const sample = [...remaining];
    for (let i = 0; i < boardCards + opponents * 2; i++) {
      const j = i + Math.floor(random() * (sample.length - i));
      [sample[i], sample[j]] = [sample[j], sample[i]];
    }
    const runout = [...board, ...sample.slice(0, boardCards)];
    const hero = bestOfSeven([...hand, ...runout]);
    let winners = 1;
    let lost = false;
    for (let i = 0; i < opponents; i++) {
      const offset = boardCards + i * 2;
      const comparison = compareScores(hero, bestOfSeven([sample[offset], sample[offset + 1], ...runout]));
      if (comparison < 0) { lost = true; break; }
      if (comparison === 0) winners++;
    }
    if (!lost) total += 1 / winners;
  }
  return total / trials;
}

type BettingContext = { currentBet: number; minRaise: number; streetBets: number[]; stacks: number[]; actedAt: Record<number, number> };
export function canRaise(state: BettingContext, seat: number) {
  const last = state.actedAt[seat];
  return state.streetBets[seat] + state.stacks[seat] > state.currentBet &&
    (last === undefined || last === 0 || state.currentBet - last >= state.minRaise);
}
export function actionTarget(state: BettingContext, seat: number, type: string, requested: number): number | null {
  const before = state.streetBets[seat];
  const max = before + state.stacks[seat];
  if (type === "fold") return before;
  if (type === "check") return before === state.currentBet ? before : null;
  if (type === "call") return Math.min(max, state.currentBet);
  if (type !== "bet" && type !== "raise") return null;
  if (!Number.isSafeInteger(requested) || !canRaise(state, seat) || requested <= state.currentBet || requested > max) return null;
  if (requested < state.currentBet + state.minRaise && requested !== max) return null;
  return requested;
}
export function seededRandom(seed: string) {
  let state = 2166136261;
  for (let index = 0; index < seed.length; index += 1) state = Math.imul(state ^ seed.charCodeAt(index), 16777619);
  // Splitmix32 avalanche pass: decorrelates weak FNV hashes so nearby seeds
  // (e.g. `next-1698...1` vs `next-1698...2`) produce fully independent streams.
  state = (state + 0x9E3779B9) >>> 0;
  state = Math.imul(state ^ (state >>> 16), 0x21F0AAAD);
  state = Math.imul(state ^ (state >>> 15), 0x735A2D97);
  state = (state ^ (state >>> 15)) >>> 0;
  return () => {
    state += 0x6D2B79F5;
    let value = state;
    value = Math.imul(value ^ value >>> 15, value | 1);
    value ^= value + Math.imul(value ^ value >>> 7, value | 61);
    return ((value ^ value >>> 14) >>> 0) / 4294967296;
  };
}

export function shuffledDeck(seed = "") {
  const random = seed ? seededRandom(seed) : Math.random;
  const deck = cardSuits.flatMap((suit) => cardRanks.map((rank) => `${rank}${suit}`));
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function dealRandomHand(seed = ""): DealtHand {
  const deck = shuffledDeck(seed);
  // Live-table dealing order: two clockwise rounds, one card per player each
  // round, then a burn card before the flop / turn / river. Statistically this
  // stays a uniform deal, but the sequence mirrors a real dealer's procedure.
  const players: string[][] = [[], [], [], [], [], []];
  for (let round = 0; round < 2; round += 1) for (const player of players) player.push(deck.pop()!);
  const burn = [deck.pop()!, deck.pop()!, deck.pop()!];
  const board = [deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!, deck.pop()!];
  return {
    id: seed ? `H${seed.replace(/\D/g, "").slice(-8) || Date.now().toString().slice(-8)}` : `H${Date.now().toString().slice(-8)}`,
    players,
    board,
    // Burn cards are kept for replay/debug tooling; they never enter play.
    burn,
  };
}

export function compareScores(a: HandScore, b: HandScore) {
  if (a.category !== b.category) return a.category - b.category;
  const length = Math.max(a.tiebreak.length, b.tiebreak.length);
  for (let i = 0; i < length; i += 1) {
    if ((a.tiebreak[i] || 0) !== (b.tiebreak[i] || 0)) return (a.tiebreak[i] || 0) - (b.tiebreak[i] || 0);
  }
  return 0;
}

export function rankLabel(value: number) { return value === 14 ? "A" : value === 13 ? "K" : value === 12 ? "Q" : value === 11 ? "J" : String(value); }

export function evaluateFive(cards: string[]): HandScore {
  const values = cards.map((card) => rankValue[card.slice(0, -1)]).sort((a, b) => b - a);
  const suits = cards.map((card) => card.slice(-1));
  const counts = new Map<number, number>();
  values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const unique = [...new Set(values)];
  if (unique.includes(14)) unique.push(1);
  let straightHigh = 0;
  for (let i = 0; i <= unique.length - 5; i += 1) {
    if (unique[i] - unique[i + 4] === 4) { straightHigh = unique[i]; break; }
  }
  const flush = suits.every((suit) => suit === suits[0]);
  if (flush && straightHigh) return { category: 8, tiebreak: [straightHigh], label: `同花顺 · ${rankLabel(straightHigh)} 高`, bestFive: cards };
  if (groups[0][1] === 4) return { category: 7, tiebreak: [groups[0][0], groups[1][0]], label: `四条 · ${rankLabel(groups[0][0])}`, bestFive: cards };
  if (groups[0][1] === 3 && groups[1][1] === 2) return { category: 6, tiebreak: [groups[0][0], groups[1][0]], label: `葫芦 · ${rankLabel(groups[0][0])} 带 ${rankLabel(groups[1][0])}`, bestFive: cards };
  if (flush) return { category: 5, tiebreak: values, label: `同花 · ${rankLabel(values[0])} 高`, bestFive: cards };
  if (straightHigh) return { category: 4, tiebreak: [straightHigh], label: `顺子 · ${rankLabel(straightHigh)} 高`, bestFive: cards };
  if (groups[0][1] === 3) return { category: 3, tiebreak: [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], label: `三条 · ${rankLabel(groups[0][0])}`, bestFive: cards };
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    const pairs = [groups[0][0], groups[1][0]].sort((a, b) => b - a);
    return { category: 2, tiebreak: [...pairs, groups[2][0]], label: `两对 · ${rankLabel(pairs[0])} 和 ${rankLabel(pairs[1])}`, bestFive: cards };
  }
  if (groups[0][1] === 2) return { category: 1, tiebreak: [groups[0][0], ...groups.slice(1).map((g) => g[0]).sort((a, b) => b - a)], label: `一对 · ${rankLabel(groups[0][0])}`, bestFive: cards };
  return { category: 0, tiebreak: values, label: `高牌 · ${rankLabel(values[0])}`, bestFive: cards };
}

export function bestOfSeven(cards: string[]): HandScore {
  let best: HandScore | null = null;
  for (let a = 0; a < cards.length - 4; a += 1) for (let b = a + 1; b < cards.length - 3; b += 1) for (let c = b + 1; c < cards.length - 2; c += 1) for (let d = c + 1; d < cards.length - 1; d += 1) for (let e = d + 1; e < cards.length; e += 1) {
    const score = evaluateFive([cards[a], cards[b], cards[c], cards[d], cards[e]]);
    if (!best || compareScores(score, best) > 0) best = score;
  }
  return best!;
}

export function settlePots(totalBets: number[], active: number[], players: string[][], board: string[], dealerSeat: number) {
  const payouts = totalBets.map(() => 0);
  const sidePots: number[] = [];
  const winningSeats = new Set<number>();
  let mainWinner = active[0];
  let previous = 0;
  let previousEligibility = "";
  for (const level of [...new Set(totalBets.filter((amount) => amount > 0))].sort((a, b) => a - b)) {
    const contributors = totalBets.flatMap((amount, seat) => amount >= level ? [seat] : []);
    const amount = (level - previous) * contributors.length;
    previous = level;
    // A single contribution at this level is an uncalled bet, not a won pot.
    if (contributors.length === 1) { payouts[contributors[0]] += amount; continue; }
    const eligible = active.filter((seat) => totalBets[seat] >= level);
    if (!eligible.length) throw new Error("Pot has no eligible player");
    const scored = eligible.map((seat) => ({ seat, score: bestOfSeven([...players[seat], ...board]) })).sort((a, b) => compareScores(b.score, a.score));
    const winners = scored.filter((entry) => compareScores(entry.score, scored[0].score) === 0).map((entry) => entry.seat);
    if (!sidePots.length) mainWinner = winners[0];
    const ordered = winners.sort((a, b) => ((a - dealerSeat - 1 + totalBets.length) % totalBets.length) - ((b - dealerSeat - 1 + totalBets.length) % totalBets.length));
    ordered.forEach((seat, index) => { payouts[seat] += Math.floor(amount / winners.length) + (index < amount % winners.length ? 1 : 0); winningSeats.add(seat); });
    const eligibility = eligible.join(",");
    if (sidePots.length && eligibility === previousEligibility) sidePots[sidePots.length - 1] += amount;
    else sidePots.push(amount);
    previousEligibility = eligibility;
  }
  return { payouts, sidePots, winningSeats: [...winningSeats], mainWinner };
}
