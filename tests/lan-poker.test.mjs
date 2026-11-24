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
  assert.deepEqual(b.opponentCards, []);
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
  assert.deepEqual(result.opponentCards, b.cards);
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
  assert.deepEqual(view.opponentCards, []);
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
  assert.equal(isLanView({ ...initial, lastMove: { seat: 2, type: "check", amount: 0 } }), false);
  const finished = lanView(act(createLanHand(0), 0, "fold"), 1);
  assert.ok(isLanView(finished));
  assert.equal(isLanView({ ...finished, result: { ...finished.result, handLabel: {} } }), false);
});
