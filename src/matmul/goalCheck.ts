import { readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "./checker"
import type { Scheme } from "./types"

const HERE = dirname(fileURLToPath(import.meta.url))

export type GoalEntry = { file: string; n: number; correct: boolean; rank: number; mismatches: number }

export const PROBLEM_N = 3

export function attemptFiles(): Promise<string[]> {
  return readdir(join(HERE, "attempts")).then(
    (all) => all.filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && !f.endsWith("_search.ts")),
    (e: unknown) => {
      if (e instanceof Error) return []
      throw e
    },
  )
}

export function classify(mod: Record<string, unknown>, file: string): GoalEntry {
  try {
    const s = mod["scheme"] as Scheme
    const v = verify(s)
    return { file, n: s.n, correct: v.correct, rank: v.rank, mismatches: v.mismatches }
  } catch (e) {
    if (e instanceof Error) return { file, n: -1, correct: false, rank: -1, mismatches: -1 }
    throw e
  }
}

export function isTargetProblem(e: GoalEntry): boolean {
  return e.n === PROBLEM_N
}

export function goalSatisfied(entries: readonly GoalEntry[]): GoalEntry | undefined {
  return entries.find((e) => isTargetProblem(e) && e.correct && e.rank <= 22)
}

export function bestVerified(entries: readonly GoalEntry[]): GoalEntry | undefined {
  return entries
    .filter((e) => isTargetProblem(e) && e.correct)
    .reduce<GoalEntry | undefined>((acc, e) => (acc === undefined || e.rank < acc.rank ? e : acc), undefined)
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const entries: GoalEntry[] = []
    for (const f of await attemptFiles()) {
      const mod = (await import(join(HERE, "attempts", f))) as Record<string, unknown>
      entries.push(classify(mod, f))
    }
    const winner = goalSatisfied(entries)
    const best = bestVerified(entries)
    if (winner !== undefined) {
      console.log(`GOAL MET: ${winner.file} verified rank ${winner.rank}, ${winner.mismatches} mismatches`)
      return
    }
    console.log(
      `GOAL NOT MET: no exact scheme with rank <= 22 among ${entries.length} attempts.` +
        (best === undefined ? " no verified scheme at all." : ` best verified is ${best.file} at rank ${best.rank}.`),
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
