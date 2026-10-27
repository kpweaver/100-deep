/** Shortest-path steps over the grids the player knows */
import { DIR_OFFSETS, type Direction } from '@thang/protocol';

const STEPS = (Object.entries(DIR_OFFSETS) as [string, [number, number]][])
  .map(([d, o]) => [Number(d) as Direction, o] as const);

/**
 * The first step of a shortest 8-way path from `from` to a grid adjacent
 * to (or on) `to`, through grids where `walkable` holds.  Null when there
 * is no such path within `limit` steps.
 */
export function firstStepToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  walkable: (x: number, y: number) => boolean,
  limit = 60,
): Direction | null {
  const key = (x: number, y: number) => `${x},${y}`;
  const first = new Map<string, Direction>();
  let frontier: [number, number][] = [[from.x, from.y]];
  const seen = new Set([key(from.x, from.y)]);
  for (let depth = 0; depth < limit && frontier.length; depth++) {
    const next: [number, number][] = [];
    for (const [x, y] of frontier) {
      for (const [dir, [dx, dy]] of STEPS) {
        const nx = x + dx, ny = y + dy;
        const k = key(nx, ny);
        if (seen.has(k)) continue;
        seen.add(k);
        const step = depth === 0 ? dir : first.get(key(x, y))!;
        if (nx === to.x && ny === to.y) return step;
        if (!walkable(nx, ny)) continue;
        first.set(k, step);
        next.push([nx, ny]);
      }
    }
    frontier = next;
  }
  return null;
}
