import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { attemptFiles } from "../goalCheck"
import { batcherNetwork } from "../tools/batcher"

const SEEDS = [
  { n: 11, file: "SN00_batcher11.ts", load: () => import("./SN00_batcher11") },
  { n: 12, file: "SN00_batcher12.ts", load: () => import("./SN00_batcher12") },
  { n: 13, file: "SN00_batcher13.ts", load: () => import("./SN00_batcher13") },
  { n: 14, file: "SN00_batcher14.ts", load: () => import("./SN00_batcher14") },
  { n: 15, file: "SN00_batcher15.ts", load: () => import("./SN00_batcher15") },
  { n: 16, file: "SN00_batcher16.ts", load: () => import("./SN00_batcher16") },
] as const

describe("SN00 Batcher seeds", () => {
  for (const seed of SEEDS) {
    it(`exports a verified n=${seed.n} baseline with the generated Batcher size`, async () => {
      const files = await attemptFiles()
      expect(files).toContain(seed.file)

      const { network } = await seed.load()
      const verdict = verify(network)

      expect(verdict.correct).toBe(true)
      expect(verdict.size).toBe(batcherNetwork(seed.n).comparators.length)
    })
  }
})
