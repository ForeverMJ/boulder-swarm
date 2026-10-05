/**
 * A1 (M8) - the stub landing pad: naive 64-term scheme over F_2.
 *
 * The M8 gate (goalCheckA) reads this file through scoreboard/goalCheckA scans:
 * rank 64 > 47 keeps the gate red until an agent lands a better scheme.
 * Everything is exact F_2 (0/1 coefficients).
 */

import { naive } from "../schemes"

export const scheme = naive(4)
