import assert from "node:assert/strict";
import test from "node:test";
import { applyLanAction, createLanHand, isLanView, lanView } from "../app/lan-poker.js";

function act(hand, seat, type, target = 0) {
  const next = applyLanAction(hand, seat, { revision: hand.revision, type, target });
  assert.ok(next, "Action should succeed");
  return next;
}

test("heads-up turns and public boards stay synchronized without exposing private cards", () => {
  let hand = createLanHand(0);
  const a = lanView(hand, 0);
  const b = lanView(hand, 1);
  assert.deepEqual(a.stacks, [4950, 4900]);
  assert.equal(a.actingSeat, 0);
  assert.equal(a.toCall, 50);
  assert.equal(a.cards.length, 2);
  assert.equal(b.cards.length, 2);
  assert.equal(new Set([...a.cards, ...b.cards]).size, 4);
  assert.deepEqual(b.revealed[0], []);
  assert.deepEqual(a.board, []);
  assert.ok(!Object.hasOwn(a, "deal"));
  assert.equal(applyLanAction(hand, 1, { revision: hand.revision, type: "raise", target: 200 }), null);
  assert.equal(applyLanAction(hand, 0, { revision: hand.revision, type: "check", target: 0 }), null);
  assert.equal(applyLanAction(hand, 0, { revision: hand.revision, type: "raise", target: 199 }), null);

  const firstRevision = hand.revision;
  hand = act(hand, 0, "call");
  assert.equal(hand.actingSeat, 1);
  hand = act(hand, 1, "check");
  assert.equal(applyLanAction(hand, 1, { revision: firstRevision, type: "check", target: 0 }), null);
  assert.deepEqual(lanView(hand, 0).board, lanView(hand, 1).board);
  assert.equal(lanView(hand, 0).board.length, 3);
  for (const cards of [3, 4, 5]) {
    assert.equal(lanView(hand, 0).board.length, cards);
    assert.equal(hand.actingSeat, 1);
    hand = act(act(hand, 1, "check"), 0, "check");
  }
  const result = lanView(hand, 0);
  assert.equal(result.result.reason, "showdown");
  assert.deepEqual(result.revealed[1], b.cards);
  assert.equal(result.stacks.reduce((sum, n) => sum + n, 0), 10000);
  const next = createLanHand(1, result.stacks, hand.revision + 1);
  assert.equal(next.actingSeat, 1);
  assert.ok(next.revision > hand.revision);
});

test("fold hides the opponent and returns the uncalled part of a bet", () => {
  let hand = createLanHand(0);
  hand = act(hand, 0, "raise", 1000);
  hand = act(hand, 1, "fold");
  const view = lanView(hand, 1);
  assert.deepEqual(view.stacks, [5100, 4900]);
  assert.equal(view.pot, 200);
  assert.deepEqual(view.result.winners, [0]);
  assert.equal(view.result.reason, "fold");
  assert.deepEqual(view.revealed[0], []);
  assert.deepEqual(view.board, []);
});

test("a player facing an all-in can call or fold and matching all-ins run to showdown", () => {
  let hand = createLanHand(0);
  hand = act(hand, 0, "raise", 5000);
  assert.equal(lanView(hand, 1).toCall, 4900);
  assert.equal(lanView(hand, 1).minTarget, null);
  hand = act(hand, 1, "call");
  const view = lanView(hand, 1);
  assert.equal(view.board.length, 5);
  assert.equal(view.pot, 10000);
  assert.equal(view.result.reason, "showdown");
  assert.equal(view.stacks[0] + view.stacks[1], 10000);

  const shortBlind = lanView(createLanHand(1, [40, 9960]), 1);
  assert.equal(shortBlind.result.reason, "showdown");
  assert.equal(shortBlind.stacks[0] + shortBlind.stacks[1], 10000);
});


test("incomplete or malformed peer snapshots are rejected before rendering", () => {
  const initial = lanView(createLanHand(0), 1);
  assert.ok(isLanView(initial));
  assert.equal(isLanView({ ...initial, pot: undefined }), false);
  assert.equal(isLanView({ ...initial, street: 8 }), false);
  assert.equal(isLanView({ ...initial, lastMove: { seat: 7, type: "check", amount: 0 } }), false);
  const finished = lanView(act(createLanHand(0), 0, "fold"), 1);
  assert.ok(isLanView(finished));
  assert.equal(isLanView({ ...finished, result: { ...finished.result, handLabel: {} } }), false);
});

test("six seats post clockwise blinds and the big blind closes preflop", () => {
  let hand = createLanHand(0, Array(6).fill(5000));
  assert.equal(hand.actingSeat, 3);
  assert.deepEqual(hand.streetBets, [0, 50, 100, 0, 0, 0]);
  const views = Array.from({ length: 6 }, (_, seat) => lanView(hand, seat));
  assert.equal(new Set(views.flatMap((view) => view.cards)).size, 12);
  assert.ok(views.every(isLanView));
  assert.ok(views.every((view) => view.revealed.every((cards) => cards.length === 0)));
  for (const seat of [3, 4, 5, 0, 1]) hand = act(hand, seat, "call");
  hand = act(hand, 2, "check");
  assert.equal(hand.street, 1);
  assert.equal(hand.actingSeat, 1);
  assert.equal(hand.pot, 600);
});

test("three different stacks award the main pot and side pot to different winners", () => {
  let hand = createLanHand(0, [300, 600, 900]);
  hand.deal.players = [["A♠", "A♥"], ["K♠", "K♥"], ["Q♠", "Q♥"]];
  hand.deal.board = ["2♣", "4♦", "6♣", "8♦", "J♣"];
  hand = act(hand, 0, "raise", 300);
  hand = act(hand, 1, "raise", 600);
  assert.equal(lanView(hand, 2).minTarget, null);
  hand = act(hand, 2, "call");
  const view = lanView(hand, 2);
  assert.ok(isLanView(view));
  assert.deepEqual(view.result.pots, [900, 600]);
  assert.equal(view.board.length, 5);
  assert.equal(view.pot, 1500);
  assert.equal(view.stacks.reduce((sum, stack) => sum + stack, 0), 1800);
  assert.deepEqual(view.stacks, [900, 600, 300]);
});

test("only showdown contenders reveal and departed seats are skipped after the dealer", () => {
  let hand = createLanHand(7, [5000, 0, 5000, 5000], 1, 2);
  assert.equal(hand.dealer, 3);
  assert.equal(hand.actingSeat, 3);
  assert.deepEqual(lanView(hand, 0).seats, [0, 2, 3]);
  hand = act(hand, 3, "fold");
  hand = act(hand, 0, "call");
  hand = act(hand, 2, "check");
  for (let street = 1; street <= 3; street++) {
    hand = act(act(hand, 0, "check"), 2, "check");
  }
  assert.equal(lanView(hand, 0).revealed[2].length, 2);
  assert.deepEqual(lanView(hand, 0).revealed[3], []);
  assert.ok(isLanView(lanView(hand, 3)));
});

test("four-way all-ins return the uncalled part above the deepest opponent's stack", () => {
  let hand = createLanHand(0, [300, 600, 900, 450]);
  hand = act(hand, 3, "raise", 450);
  hand = act(hand, 0, "call");
  hand = act(hand, 1, "call");
  hand = act(hand, 2, "raise", 900);
  hand = act(hand, 1, "call");
  const view = lanView(hand, 2);
  assert.ok(isLanView(view));
  assert.deepEqual(view.result.pots, [1200, 450, 300]);
  assert.equal(view.pot, 1950);
  assert.ok(view.result.payouts[2] >= 300);
  assert.equal(view.stacks.reduce((sum, stack) => sum + stack, 0), 2250);
});
