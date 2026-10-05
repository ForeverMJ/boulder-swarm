/**
 * M8 gate - parity with AlphaTensor's flagship record: autonomous exact
 * scheme for 4x4x4 with rank <= 47 over F_2 (Nature 610, 47-53, 2022).
 * Reuses the campaign scan/classify machinery; only the problem size and
 * the threshold differ from the n=3 gate.
 */
import { attemptFiles, classify, type GoalEntry } from "./goalCheck"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))
const PROBLEM_N_A = 4
const TARGET_RANK_A = 47

export function isTargetA(entry: GoalEntry): boolean {
  return entry.n === PROBLEM_N_A
}

export function goalSatisfiedA(entries: readonly GoalEntry[]): GoalEntry | undefined {
  return entries.find((e) => isTargetA(e) && e.correct && e.rank <= TARGET_RANK_A)
}

export type { GoalEntry } from "./goalCheck"

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const entries: GoalEntry[] = []
    for (const f of await attemptFiles()) {
      const mod = (await import(join(HERE, "attempts", f))) as Record<string, unknown>
      entries.push(classify(mod, f))
    }
    const winner = goalSatisfiedA(entries)
    if (winner !== undefined) {
      console.log(`M8 GOAL MET: ${winner.file} exact rank ${winner.rank} over F_2 (<= ${TARGET_RANK_A}; AlphaTensor parity)`)
      return
    }
    const anchor = entries.filter(isTargetA)
    console.log(
      `M8 GOAL NOT MET: no exact rank<=${TARGET_RANK_A} scheme for n=${PROBLEM_N_A} over F_2 among ${anchor.length} attempts.`,
    )
    process.exit(1)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
