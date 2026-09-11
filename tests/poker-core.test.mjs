import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import ts from "typescript";

async function load(name, extension = "ts") {
  const source = await readFile(new URL(`../app/${name}.${extension}`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText.replace(/from "react\/jsx-runtime"/g, `from "${import.meta.resolve("react/jsx-runtime")}"`)).toString("base64")}`);
}
const { dealRandomHand, bestOfSeven, compareScores, settlePots, estimateEquity, actionTarget, canRaise, seededRandom } = await load("poker-core");
const { tableConfig, carryStacks, resetEmptyChips } = await load("table-config");
const { freshAiMemories, learnFromHand, aiPsychology } = await load("ai-psychology");

test("deals reproducibly without duplicate cards across 100 seeds", () => {
  for (let i = 0; i < 100; i++) {
    const hand = dealRandomHand(`test-${i}`);
    assert.deepEqual(hand, dealRandomHand(`test-${i}`));
    assert.equal(new Set([...hand.players.flat(), ...hand.board]).size, 17);
  }
});
test("recognizes ace-low straight and selects the best full house", () => {
  assert.deepEqual(bestOfSeven(["A♠", "2♥", "3♦", "4♣", "5♠", "K♥", "Q♦"]).tiebreak, [5]);
  const full = bestOfSeven(["A♠", "A♥", "A♦", "K♣", "K♠", "K♥", "2♦"]);
  assert.equal(full.category, 6);
  assert.deepEqual(full.tiebreak, [14, 13]);
});
test("compares kickers and ties irrespective of suit", () => {
  const a = bestOfSeven(["A♠", "A♥", "K♦", "Q♣", "9♠"]);
  const b = bestOfSeven(["A♦", "A♣", "K♥", "J♣", "9♦"]);
  assert.ok(compareScores(a, b) > 0);
  assert.equal(compareScores(a, bestOfSeven(["A♦", "A♣", "K♥", "Q♦", "9♥"])), 0);
});
const players = [["A♠", "A♥"], ["K♠", "K♥"], ["Q♠", "Q♥"]];
const board = ["2♣", "4♦", "7♠", "9♥", "J♣"];
test("settles independent side pots and returns an uncalled excess", () => {
  const result = settlePots([100, 200, 300], [0, 1, 2], players, board, 0);
  assert.deepEqual(result.payouts, [300, 200, 100]);
  assert.deepEqual(result.sidePots, [300, 200]);
  assert.deepEqual(result.winningSeats, [0, 1]);
  assert.equal(result.payouts.reduce((a,b) => a+b, 0), 600);
});
test("folded player funds pots but cannot win them", () => {
  const result = settlePots([100, 200, 200], [1, 2], players, board, 0);
  assert.deepEqual(result.payouts, [0, 500, 0]);
});
test("odd chip goes clockwise after dealer, not to dealer first", () => {
  const result = settlePots([5, 5, 5], [0, 1], players, ["10♣", "J♣", "Q♣", "K♣", "A♣"], 0);
  assert.deepEqual(result.payouts, [7, 8, 0]);
});
test("room choices map to numeric table settings with safe fallbacks", () => {
  assert.deepEqual(tableConfig({ blind: "10/20", buy: "2,000～10,000", seconds: "10 秒" }), { smallBlind: 10, bigBlind: 20, buyIn: 2000, turnSeconds: 10 });
  assert.equal(tableConfig({blind: "bad", seconds: "-3"}).bigBlind, 100);
  assert.equal(tableConfig({blind: "100/200", seconds: "15 秒"}).turnSeconds, 15);
});
test("carries all six stacks, rebuying only busted seats", () => {
  const previous = [12000, 1, 0, 6500, 2500, 9000];
  const result = carryStacks(previous, tableConfig({}));
  assert.deepEqual(result.stacks, [12000, 1, 5000, 6500, 2500, 9000]);
  assert.deepEqual(result.refilled, [2]);
  assert.equal(previous[2], 0);
});

test("six-way board tie contributes one sixth of the pot, not one half", () => {
  const equity = estimateEquity(["2♥", "3♦"], ["10♠", "J♠", "Q♠", "K♠", "A♠"], 5, 20, seededRandom("ties"));
  assert.ok(Math.abs(equity - 1 / 6) < 1e-10);
});
test("equity handles certain wins, heads-up ties, and no opponent", () => {
  assert.equal(estimateEquity(["A♠", "K♠"], ["Q♠", "J♠", "10♠", "2♥", "3♦"], 5, 20, seededRandom("wins")), 1);
  assert.equal(estimateEquity(["2♥", "3♦"], ["10♠", "J♠", "Q♠", "K♠", "A♠"], 1, 20, seededRandom("tie")), .5);
  assert.equal(estimateEquity(["2♥", "3♦"], [], 0), 1);
  assert.throws(() => estimateEquity(["2♥", "3♦"], [], 6));
});
const betting = { currentBet: 100, minRaise: 100, streetBets: [100, 0, 0], stacks: [1000, 1000, 150], actedAt: {} };
test("rejects illegal checks, under-raises, oversized or noninteger bets without mutation", () => {
  const original = structuredClone(betting);
  assert.equal(actionTarget(betting, 1, "check", 0), null);
  for (const target of [150, 1001, NaN, Infinity, 250.5]) assert.equal(actionTarget(betting, 1, "raise", target), null);
  assert.equal(actionTarget(betting, 1, "raise", 200), 200);
  assert.deepEqual(betting, original);
});
test("allows short all-in raise and short all-in call", () => {
  assert.equal(actionTarget(betting, 2, "raise", 150), 150);
  assert.equal(actionTarget({ ...betting, stacks: [1000, 1000, 40] }, 2, "call", 100), 40);
});
test("short all-in does not reopen a prior caller's raising rights", () => {
  const state = { ...betting, currentBet: 150, actedAt: { 0: 100 } };
  assert.equal(canRaise(state, 0), false);
  assert.equal(actionTarget(state, 0, "raise", 250), null);
  assert.equal(actionTarget(state, 0, "call", 150), 150);
  assert.equal(canRaise(state, 1), true);
});
test("full cumulative raise reopens action; prior check can respond to first bet", () => {
  assert.equal(canRaise({ ...betting, currentBet: 200, actedAt: { 0: 100 } }, 0), true);
  assert.equal(canRaise({ ...betting, currentBet: 50, streetBets: [0, 0, 0], actedAt: { 0: 0 } }, 0), true);
});

test("manual reset restores an empty balance without overwriting a funded balance", () => {
  assert.equal(resetEmptyChips(0), 10000);
  assert.equal(resetEmptyChips(-20), 10000);
  assert.equal(resetEmptyChips(2400), 2400);
  const carried = carryStacks([0, 1000, 1000, 0, 1000, 1000], tableConfig({}), false);
  assert.equal(carried.stacks[3], 0);
  assert.deepEqual(carried.refilled, [0]);
});
const personality = { aggression: .6, looseness: .5, patience: .25, bluff: .2 };
const situation = { stack: 5000, buyIn: 5000, pot: 300, toCall: 0, opponents: 1, heroActive: true, actions: [] };
test("AI remembers losses across hands and recovers gradually after winning", () => {
  const initial = freshAiMemories();
  const stacks = Array(6).fill(5000);
  const losing = learnFromHand(initial, stacks, [0, 5000, 5000, 10000, 5000, 5000], [{seat: 3, type: "raise"}]);
  assert.equal(initial[0].hands, 0);
  assert.ok(losing[0].tilt > .3);
  assert.equal(aiPsychology(losing[0], personality, situation).label, "急于扳回");
  const recovered = learnFromHand(losing, stacks, [8000, 5000, 5000, 2000, 5000, 5000], []);
  assert.ok(recovered[0].tilt < losing[0].tilt);
  assert.equal(recovered[0].hands, 2);
});
test("AI adapts bluff frequency to observed folds only after sufficient evidence", () => {
  const memory = { ...freshAiMemories()[0], hands: 4, heroFolds: 6, heroCalls: 1 };
  const baseline = aiPsychology(freshAiMemories()[0], personality, situation);
  const adjusted = aiPsychology(memory, personality, situation);
  assert.equal(adjusted.label, "试探施压");
  assert.ok(adjusted.bluff > baseline.bluff);
  assert.ok(adjusted.aggression > baseline.aggression);
  assert.equal(aiPsychology({...memory, hands: 1}, personality, situation).label, "冷静观察");
  assert.equal(aiPsychology(memory, personality, {...situation, heroActive: false}).bluff, baseline.bluff);
});
test("stack pressure and multiway pots reduce bluffing; psychology stays bounded", () => {
  const memory = freshAiMemories()[0];
  const relaxed = aiPsychology(memory, personality, situation);
  const pressured = aiPsychology(memory, personality, {...situation, stack: 200, pot: 3000, toCall: 200, opponents: 5});
  assert.equal(pressured.label, "筹码承压");
  assert.ok(pressured.bluff < relaxed.bluff);
  for (const value of [pressured.aggression, pressured.looseness, pressured.bluff, pressured.patience]) assert.ok(value >= 0 && value <= 1);
});

const { hasAcceptedTerms, createTermsAcceptance, TERMS_VERSION } = await load("legal-notice", "tsx");
test("consent requires explicit confirmation and the current terms version", () => {
  assert.throws(() => createTermsAcceptance(false));
  assert.equal(hasAcceptedTerms(JSON.stringify(createTermsAcceptance(true, 1000))), true);
  for (const raw of [null, "broken", "null", "true", JSON.stringify({version: TERMS_VERSION}), JSON.stringify({version: "old", accepted: true, acceptedAt: 1000}), JSON.stringify({version: TERMS_VERSION, accepted: false, acceptedAt: 1000})]) {
    assert.equal(hasAcceptedTerms(raw), false);
  }
});
