export function mobileTableLayout(width: number, height: number) {
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (short > 600 || long > 1100 || short <= 0) return null;
  const scale = Math.min(1, long / 740, short / 390);
  return { width: long / scale, height: short / scale, scale, rotated: height > width };
}

type Box = { left: number; top: number; right: number; width: number; height: number };
export function tableLocalCenter(rect: Box, table: Box, scale = 1, rotated = false) {
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return rotated
    ? { x: (y - table.top) / scale, y: (table.right - x) / scale }
    : { x: (x - table.left) / scale, y: (y - table.top) / scale };
}
