import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { BEST_KNOWN, TARGET_NS } from "./bounds"
import { attemptFiles, bestVerified, classify } from "./goalCheck"
import type { AttemptModule, GoalEntry } from "./goalCheck"
import { batcherNetwork } from "./tools/batcher"

const HERE = dirname(fileURLToPath(import.meta.url))

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const rows: GoalEntry[] = []
    for (const file of await attemptFiles()) {
      try {
        const module: AttemptModule = await import(join(HERE, "attempts", file))
        rows.push(classify(module, file))
      } catch (error) {
        if (error instanceof Error) {
          rows.push(classify({}, file))
          continue
        }
        throw error
      }
    }
    rows.sort(
      (left, right) =>
        left.n - right.n ||
        Number(right.correct) - Number(left.correct) ||
        left.size - right.size ||
        left.file.localeCompare(right.file),
    )

    console.log("file | n | correct | size")
    for (const row of rows) {
      console.log(`${row.file} | ${row.n} | ${row.correct} | ${row.size}`)
    }
    for (const n of TARGET_NS) {
      const best = bestVerified(rows, n)
      console.log(`BESTN${n}=${best?.file ?? "none"}`)
      const batcherSize = batcherNetwork(n).comparators.length
      const beating = best !== undefined && best.size < batcherSize ? best : undefined
      console.log(`N${n}BEATBATCHER=${beating?.file ?? "none"}`)
    }
    const sourcedBounds = Object.entries(BEST_KNOWN)
      .map(([n, size]) => ({ n: Number.parseInt(n, 10), size }))
      .sort((left, right) => left.n - right.n)
    for (const { n, size } of sourcedBounds) {
      const best = bestVerified(rows, n)
      const matching = best !== undefined && best.size <= size ? best : undefined
      console.log(`N${n}LE${size}=${matching?.file ?? "none"}`)
    }
  } catch (error) {
    console.error("unhandled:", error)
  }
}

await main()
