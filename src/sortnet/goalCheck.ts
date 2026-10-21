import { readdir } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { TARGET_NS } from "./bounds"
import { verify } from "./checker"
import { batcherNetwork } from "./tools/batcher"
import type { Comparator, Network } from "./types"

const HERE = dirname(fileURLToPath(import.meta.url))

export type GoalEntry = {
  readonly file: string
  readonly n: number
  readonly correct: boolean
  readonly size: number
}

export type AttemptModule = {
  readonly network?: unknown
}

function isNetwork(value: unknown): value is Network {
  if (typeof value !== "object" || value === null) return false
  if (!("n" in value) || !("comparators" in value)) return false
  return (
    typeof value.n === "number" &&
    Array.isArray(value.comparators) &&
    value.comparators.every(
      (comparator: unknown): comparator is Comparator =>
        Array.isArray(comparator) &&
        comparator.length === 2 &&
        typeof comparator[0] === "number" &&
        typeof comparator[1] === "number",
    )
  )
}

export function attemptFiles(): Promise<string[]> {
  return readdir(join(HERE, "attempts")).then(
    (all) =>
      all
        .filter(
          (file) =>
            file.endsWith(".ts") && !file.endsWith(".test.ts") && !file.endsWith("_search.ts"),
        )
        .sort(),
    (error: unknown) => {
      if (error instanceof Error) return []
      throw error
    },
  )
}

export function classify(module: AttemptModule, file: string): GoalEntry {
  const network = module.network
  if (!isNetwork(network)) return { file, n: -1, correct: false, size: -1 }
  const verdict = verify(network)
  return { file, n: network.n, correct: verdict.correct, size: verdict.size }
}

export function bestVerified(entries: readonly GoalEntry[], n: number): GoalEntry | undefined {
  return entries
    .filter((entry) => entry.n === n && entry.correct)
    .reduce<GoalEntry | undefined>((best, entry) => {
      if (best === undefined || entry.size < best.size) return entry
      if (entry.size === best.size && entry.file.localeCompare(best.file) < 0) return entry
      return best
    }, undefined)
}

export function goalSatisfied(entries: readonly GoalEntry[]): readonly GoalEntry[] | undefined {
  const winners: GoalEntry[] = []
  for (const n of TARGET_NS) {
    const best = bestVerified(entries, n)
    const batcherSize = batcherNetwork(n).comparators.length
    if (best === undefined || best.size >= batcherSize) return undefined
    winners.push(best)
  }
  return winners
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const entries: GoalEntry[] = []
    for (const file of await attemptFiles()) {
      const module: AttemptModule = await import(join(HERE, "attempts", file))
      entries.push(classify(module, file))
    }

    for (const n of TARGET_NS) {
      const best = bestVerified(entries, n)
      const batcherSize = batcherNetwork(n).comparators.length
      if (best === undefined) {
        console.log(`n=${n}: no correct network`)
        continue
      }
      const status = best.size < batcherSize ? "BEATEN" : "NOT BEATEN"
      console.log(`n=${n}: best ${best.size} vs batcher ${batcherSize} — ${status}`)
    }

    if (goalSatisfied(entries) !== undefined) {
      console.log(`GOAL MET: Batcher beaten for every n in ${TARGET_NS.join(", ")}.`)
      return
    }
    const unmet = TARGET_NS.filter((n) => {
      const best = bestVerified(entries, n)
      return best === undefined || best.size >= batcherNetwork(n).comparators.length
    })
    console.log(`GOAL NOT MET: no strict Batcher improvement for n=${unmet.join(", ")}.`)
    process.exit(1)
  } catch (error) {
    console.error("unhandled:", error)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
