/**
 * Smoothed heading for engine-driven movement (auto-explore, travel, run).
 *
 * Angband's pathing often zig-zags diagonally along a corridor (NE, SE,
 * NE...).  Facing each step would swing the view 90 degrees every turn, so
 * the heading is the average of the last few steps, and a change must
 * persist for two steps before the view turns, unless it is a reversal or
 * sharper (dead ends, doubling back).
 */
export class HeadingFollower {
  private steps: [number, number][] = [];
  private pending: number | null = null;

  constructor(private window = 4) {}

  reset(): void {
    this.steps = [];
    this.pending = null;
  }

  /**
   * Record a step (grid delta) and return how many 45-degree steps to turn
   * from the current facing (0 = keep facing).  Facing 0 is north (-y),
   * increasing clockwise.
   */
  step(dx: number, dy: number, facing: number): number {
    if (dx === 0 && dy === 0) return 0;
    const len = Math.hypot(dx, dy);
    this.steps.push([dx / len, dy / len]);
    if (this.steps.length > this.window) this.steps.shift();
    let sx = 0, sy = 0;
    for (const [x, y] of this.steps) {
      sx += x;
      sy += y;
    }
    if (Math.hypot(sx, sy) < 0.5) return 0; // back and forth: no clear heading
    const heading = ((Math.round(Math.atan2(sx, -sy) / (Math.PI / 4)) % 8) + 8) % 8;
    let diff = heading - facing;
    if (diff > 4) diff -= 8;
    if (diff < -4) diff += 8;
    if (diff === 0) {
      this.pending = null;
      return 0;
    }
    if (Math.abs(diff) >= 3 || this.pending === heading) {
      this.pending = null;
      return diff;
    }
    this.pending = heading;
    return 0;
  }
}
