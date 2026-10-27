/**
 * Facing for engine-driven movement (auto-explore, travel, run).
 *
 * The player should walk forwards, turning at corners rather than
 * strafing round them, so a straight (orthogonal) step turns the view to
 * face it at once.  Only diagonal steps are smoothed: Angband's pathing
 * often zig-zags diagonally along a corridor (NE, SE, NE...), and facing
 * each of those would swing the view 90 degrees every turn, so a diagonal
 * step faces the average of it and the step before.  Two diagonal steps
 * the same way face the diagonal; a lone 45-degree jog changes nothing.
 * The one straight-step exception is a staircase of alternating straight
 * steps (E, N, E, N), which faces its diagonal.
 */
/** Facing index (0 = north, clockwise) of a grid delta, by its angle */
function facingOf(x: number, y: number): number {
  return ((Math.round(Math.atan2(x, -y) / (Math.PI / 4)) % 8) + 8) % 8;
}

export class HeadingFollower {
  /** Facing index of the last steps, most recent last */
  private steps: number[] = [];

  reset(): void {
    this.steps = [];
  }

  /**
   * Record a step (grid delta) and return how many 45-degree steps to turn
   * from the current facing (0 = keep facing).  Facing 0 is north (-y),
   * increasing clockwise.
   */
  step(dx: number, dy: number, facing: number): number {
    if (dx === 0 && dy === 0) return 0;
    const d = facingOf(Math.sign(dx), Math.sign(dy));
    const [prev, prev2] = [this.steps.at(-1), this.steps.at(-2)];
    this.steps.push(d);
    if (this.steps.length > 3) this.steps.shift();

    let target: number;
    if (d % 2 === 0) {
      // Straight: face it, unless this is a staircase (E, N, E)
      const staircase = prev !== undefined && prev2 === d && prev % 2 === 0 && Math.abs(turnBetween(prev, d)) === 2;
      target = staircase ? mid(d, prev!) : d;
    } else {
      // Diagonal: average with the step before (or the facing, at the start)
      const base = prev ?? facing;
      const t = Math.abs(turnBetween(base, d));
      if (t === 1) target = base; // a jog off a straight line
      else if (t === 2) target = mid(base, d); // zig-zag: the axis between
      else target = d; // the same diagonal again, or doubling back
    }
    return turnBetween(facing, target);
  }
}

/** Signed 45-degree steps from facing a to facing b, in -4..4 */
function turnBetween(a: number, b: number): number {
  let diff = b - a;
  if (diff > 4) diff -= 8;
  if (diff < -4) diff += 8;
  return diff;
}

/** The facing half-way between two facings 90 degrees apart */
function mid(a: number, b: number): number {
  return (((a + turnBetween(a, b) / 2) % 8) + 8) % 8;
}
