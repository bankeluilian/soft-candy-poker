export type TableConfig = { smallBlind: number; bigBlind: number; buyIn: number; turnSeconds: number };
export const RESET_CHIPS = 10000;
export function resetEmptyChips(balance: number) { return balance <= 0 ? RESET_CHIPS : balance; }

export function tableConfig(options: { blind?: string; buy?: string; seconds?: string }): TableConfig {
  const blinds: Record<string, [number, number]> = { "10/20": [10, 20], "50/100": [50, 100], "100/200": [100, 200] };
  const [smallBlind, bigBlind] = blinds[options.blind || ""] || blinds["50/100"];
  return { smallBlind, bigBlind, buyIn: options.buy === "2,000～10,000" ? 2000 : 5000,
    turnSeconds: ({ "10 秒": 10, "15 秒": 15, "20 秒": 20 } as Record<string, number>)[options.seconds || ""] || 20 };
}

// Training seats rebuy only when busted. Every other stack carries forward unchanged.
export function carryStacks(previous: number[], config: TableConfig, refillHero = true) {
  const refilled: number[] = [];
  const stacks = previous.map((stack, seat) => {
    if (!Number.isFinite(stack) || stack <= 0) {
      if (seat === 3 && !refillHero) return 0;
      refilled.push(seat); return config.buyIn;
    }
    return Math.floor(stack);
  });
  return { stacks, refilled };
}
