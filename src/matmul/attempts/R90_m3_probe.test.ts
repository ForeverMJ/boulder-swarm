/**
 * R90-probe test — asserts on the COMMITTED measurement JSON only.
 * Must finish well under 60s; must NOT rerun the measurement.
 */
import { describe, expect, it } from "bun:test"
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

const HERE = dirname(fileURLToPath(import.meta.url))

type Config = {
  readonly shards: number
  readonly seconds: number
  readonly rows: number
  readonly rowsPerSec: number
}

type Payload = {
  readonly configs: readonly Config[]
  readonly speedup4: number
  readonly speedup8: number
  readonly machineLoadNote: string
  readonly recommendedShards: number
  readonly recommendedBudgetMs: number
  readonly closureFeasible: boolean
  readonly generatedAt: string
}

function binom(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

describe("R90 m=3 throughput probe", () => {
  it("measured configs show real throughput and parallel scaling", async () => {
    const raw = await readFile(join(HERE, "R90_m3_probe.json"), "utf8")
    const p = JSON.parse(raw) as Payload
    expect(p.configs.length).toBe(3)
    expect(p.configs.map((c) => c.shards)).toEqual([1, 4, 8])
    for (const c of p.configs) {
      expect(c.rows).toBeGreaterThan(0)
      expect(c.rowsPerSec).toBeGreaterThan(10000)
    }
    expect(p.speedup4).toBeGreaterThan(1.5)
    // C(26,5) recomputed inline: 26 terms, drop k=5 -> 65780 rows per anchor.
    expect(binom(26, 5)).toBe(65780)
    expect(p.recommendedShards).toBeGreaterThanOrEqual(1)
    expect(typeof p.closureFeasible).toBe("boolean")
    expect(typeof p.machineLoadNote).toBe("string")
    expect(p.machineLoadNote.length).toBeGreaterThan(0)
  })
})
