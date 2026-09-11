import fs from "node:fs";

const source = fs.readFileSync("app/page.js", "utf8");
const start = source.indexOf("const cardRanks");
const end = source.indexOf("export default function PokerGame");
if (start < 0 || end < 0) throw new Error("Poker engine section was not found.");

const engine = new Function(`${source.slice(start, end)}\nreturn { dealRandomHand, bestOfSeven, compareScores, estimateHandProbabilities };`)();
const uniqueHeroHands = new Set();

for (let i = 0; i < 200; i += 1) {
  const hand = engine.dealRandomHand();
  const cards = [...hand.players.flat(), ...hand.board];
  if (cards.length !== 17 || new Set(cards).size !== 17) throw new Error(`Duplicate card detected in deal ${i}.`);
  uniqueHeroHands.add(hand.players[3].slice().sort().join("|"));
}

const syncedA = engine.dealRandomHand("shared-room-seed");
const syncedB = engine.dealRandomHand("shared-room-seed");
const different = engine.dealRandomHand("another-room-seed");
if (JSON.stringify(syncedA.players) !== JSON.stringify(syncedB.players) || JSON.stringify(syncedA.board) !== JSON.stringify(syncedB.board)) throw new Error("Seeded deals are not deterministic.");
if (JSON.stringify(syncedA.players) === JSON.stringify(different.players) && JSON.stringify(syncedA.board) === JSON.stringify(different.board)) throw new Error("Different seeds generated the same full deal.");

const royalFlush = engine.bestOfSeven(["A♠", "K♠", "Q♠", "J♠", "10♠", "2♦", "3♣"]);
const fourKind = engine.bestOfSeven(["A♠", "A♥", "A♦", "A♣", "K♠", "2♦", "3♣"]);
const fullHouse = engine.bestOfSeven(["K♠", "K♥", "K♦", "9♣", "9♠", "2♦", "3♣"]);

if (royalFlush.category !== 8) throw new Error("Straight flush evaluation failed.");
if (fourKind.category !== 7) throw new Error("Four-of-a-kind evaluation failed.");
if (fullHouse.category !== 6) throw new Error("Full house evaluation failed.");
if (engine.compareScores(royalFlush, fourKind) <= 0) throw new Error("Hand ranking comparison failed.");

const probabilities = engine.estimateHandProbabilities(["A♠", "K♠"], [], 1200);
const probabilityTotal = probabilities.reduce((sum, item) => sum + item.probability, 0);
if (probabilities.length !== 9 || Math.abs(probabilityTotal - 100) > .001) throw new Error("Probability distribution is invalid.");

console.log(`Poker engine valid: 200 independent deals checked, ${200 - uniqueHeroHands.size} natural repeated hero hands allowed, deterministic room seeds, ranking and probability totals verified.`);
