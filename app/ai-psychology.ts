export type AiMemory = { confidence: number; tilt: number; hands: number; heroRaises: number; heroFolds: number; heroCalls: number; lastResult: number };
export type AiMemories = Record<number, AiMemory>;
type ObservedAction = { seat: number; type: string };
type Personality = { aggression: number; looseness: number; bluff: number; patience: number };
const bound = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value));
export const aiSeats = [0, 1, 2, 4, 5];
export function freshAiMemories(): AiMemories {
  return Object.fromEntries(aiSeats.map((seat) => [seat, { confidence: .5, tilt: 0, hands: 0, heroRaises: 0, heroFolds: 0, heroCalls: 0, lastResult: 0 }]));
}

// Learn only from chip changes and public actions. No opponent cards or future board are accepted.
export function learnFromHand(memories: AiMemories, starting: number[], final: number[], actions: ObservedAction[]): AiMemories {
  const hero = actions.filter((action) => action.seat === 3);
  return Object.fromEntries(aiSeats.map((seat) => {
    const old = memories[seat];
    const delta = final[seat] - starting[seat];
    const impact = bound(delta / Math.max(1, starting[seat]), -1, 1);
    return [seat, {
      confidence: bound(.5 + (old.confidence - .5) * .75 + impact * .35),
      tilt: bound(old.tilt * .65 + Math.max(0, -impact) * .65 - Math.max(0, impact) * .2),
      hands: old.hands + 1, lastResult: delta,
      heroRaises: old.heroRaises * .8 + hero.filter((action) => action.type === "bet" || action.type === "raise").length,
      heroFolds: old.heroFolds * .8 + hero.filter((action) => action.type === "fold").length,
      heroCalls: old.heroCalls * .8 + hero.filter((action) => action.type === "call").length,
    }];
  }));
}

export function aiPsychology(memory: AiMemory, personality: Personality, context: { stack: number; buyIn: number; pot: number; toCall: number; opponents: number; heroActive: boolean; actions: ObservedAction[] }) {
  const current = context.actions.filter((action) => action.seat === 3);
  const raises = memory.heroRaises + current.filter((action) => action.type === "bet" || action.type === "raise").length;
  const calls = memory.heroCalls + current.filter((action) => action.type === "call").length;
  const folds = memory.heroFolds + current.filter((action) => action.type === "fold").length;
  const observations = raises + calls + folds;
  const readReady = memory.hands >= 2 && observations >= 4 && context.heroActive;
  const foldRead = readReady ? folds / Math.max(1, observations) : 0;
  const pressureRead = readReady ? raises / Math.max(1, observations) : 0;
  const shortStack = context.stack < context.buyIn * .25;
  const pressure = bound(context.toCall / Math.max(1, context.stack) + context.pot / Math.max(1, context.stack * 6));
  const impulsive = memory.tilt * (1 - personality.patience);
  const caution = pressure * personality.patience + (shortStack ? .15 : 0);
  const confidence = memory.confidence - .5;
  const bluffBoost = foldRead * .22;
  const aggression = bound(personality.aggression + confidence * .25 + impulsive * .3 - caution * .2 + bluffBoost, .05, .95);
  const looseness = bound(personality.looseness + impulsive * .22 + pressureRead * .12 - caution * .2, .08, .95);
  const bluff = bound((personality.bluff + bluffBoost + impulsive * .12 - caution * .12) / Math.sqrt(Math.max(1, context.opponents)), .01, .5);
  const patience = bound(personality.patience + caution * .2 - impulsive * .25, .1, .98);
  let label = "冷静观察", thought = "先看公开行动，保留判断。";
  if (foldRead > .45) { label = "试探施压"; thought = "你近期弃牌较多，正在尝试争取底池。"; }
  else if (pressureRead > .5) { label = "警惕反击"; thought = "你近期进攻频繁，正在扩大跟注范围。"; }
  else if (shortStack || pressure > .7) { label = "筹码承压"; thought = "投入相对筹码偏高，正在收紧范围。"; }
  else if (memory.tilt > .3 && personality.patience < .6) { label = "急于扳回"; thought = "近期损失影响情绪，更容易冒险。"; }
  else if (memory.tilt > .3) { label = "收紧调整"; thought = "经历损失后放慢节奏，等待更合适的机会。"; }
  else if (memory.confidence > .6) { label = "信心上升"; thought = "近期盈利带来信心，进攻意愿有所增加。"; }
  return { aggression, looseness, bluff, patience, label, thought };
}
