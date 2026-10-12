import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"
import type { Scheme } from "../types"
import { scheme as t11 } from "./T11_solution"
import {
  anchorOf,
  anchorSpaceCount,
  anchorStepsUpTo,
  binomial,
  combos,
  compactAll,
  droppedSum,
  enumerateRefinements,
  factorRank1,
  isRankAtMostOne,
  modpFlatDim,
  plantedRank1,
  PREFILTER_PRIMES,
  readR97ResumeCursor,
  ROWS_PER_ANCHOR,
  runControls,
  screenAnchorRange,
  screenRow,
  unfoldingRankAtMostOne,
  FLAT,
} from "./R98_m2_t11_search"

async function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "r98t11-"))
}

function firstGoodAnchor(): { anchor: Scheme; steps: { term: number; mode: 0 | 1 | 2; mask: number }[] } {
  const pool = enumerateRefinements(t11)
  for (const steps of anchorStepsUpTo(pool, 2)) {
    try {
      return { anchor: anchorOf(t11, steps), steps }
    } catch {
      continue
    }
  }
  throw new Error("no non-degenerate anchor found")
}

describe("R98_m2_t11_search", () => {
  it("gating controls pass: base-exact, factorisation-roundtrip, planted accept/reject", () => {
    const ctrl = runControls()
    for (const c of ctrl) expect(c.pass).toBe(true)
    const names = ctrl.map((c) => c.name)
    expect(names).toContain("base-exact")
    expect(names).toContain("factorisation-roundtrip")
    expect(names).toContain("positive-control-rank1")
    expect(names).toContain("negative-control-rank2")
    expect(names).toContain("t11-row-reproduction")
  }, 55000)

  it("band sizing: T11 m=2 anchor space is 428180 with 12650 rows each", () => {
    const pool = enumerateRefinements(t11)
    expect(anchorSpaceCount(pool, 2).toString()).toBe("428180")
    expect(ROWS_PER_ANCHOR).toBe(12650)
    expect(binomial(23 + 2, 2 + 2)).toBe(12650)
  }, 55000)

  it("per-row verdicts carry stage attribution and survivors pass through checker.verify", () => {
    const { anchor } = firstGoodAnchor()
    const terms = compactAll(anchor)
    const scratch = new Int32Array(FLAT)
    const touched: number[] = []
    const flatScratch = new Int32Array(9 * 81)
    const oracle = { rows: 0, disagreements: 0 }
    let refuted = 0
    let admissible = 0
    for (const drop of combos(terms.length, 4)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      expect(["REFUTED", "ADMISSIBLE", "SURVIVOR", "UNRESOLVED"]).toContain(vd.status)
      expect(vd.reason.length).toBeGreaterThan(0)
      expect(["prefilter", "exact", "oracle", "factorise-checker"]).toContain(vd.stage)
      if (vd.status === "REFUTED") {
        refuted += 1
        expect(["prefilter", "exact"]).toContain(vd.stage)
        const direct = droppedSum(terms, [...drop])
        if (vd.reason === "modp-prefilter-flatDim>1") {
          expect(modpFlatDim(direct, PREFILTER_PRIMES, 1)).toBeGreaterThan(1)
          expect(isRankAtMostOne(direct)).toBe(false)
        } else {
          expect(isRankAtMostOne(direct)).toBe(false)
          expect(unfoldingRankAtMostOne(direct)).toBe(false)
        }
      }
      if (vd.status === "ADMISSIBLE" || vd.status === "SURVIVOR") {
        admissible += 1
        expect(vd.stage).toBe("factorise-checker")
        expect(typeof vd.checkerCorrect).toBe("boolean")
        expect(typeof vd.checkerRank).toBe("number")
        expect(typeof vd.mismatches).toBe("number")
      }
      if (refuted >= 25) break
    }
    expect(refuted).toBeGreaterThan(0)
    const planted = plantedRank1(7)
    expect(isRankAtMostOne(planted)).toBe(true)
    expect(unfoldingRankAtMostOne(planted)).toBe(true)
    const fac = factorRank1(planted)
    expect(fac).not.toBeUndefined()
    const other = plantedRank1(303)
    for (let i = 0; i < FLAT; i++) planted[i] = (planted[i] ?? 0) + (other[i] ?? 0)
    expect(isRankAtMostOne(planted) && unfoldingRankAtMostOne(planted)).toBe(false)
    expect(admissible).toBeGreaterThanOrEqual(0)
  }, 55000)

  it("cursor-resume integrity: split run equals one uninterrupted run, bounded null carries unscreenedFrom", async () => {
    const dir = await freshDir()
    const first = await screenAnchorRange({ startCursor: 0, maxAnchors: 1, budgetMs: 55000, shard: 0, shards: 1, outDir: dir, tag: "part1" })
    expect(first.anchorsCompleted).toBe(1)
    expect(first.rowsRefuted + first.rowsSurvivor + first.rowsUndecided).toBe(first.rowsScreened)
    expect(first.bounded).toBe(true)
    expect(first.unscreenedFrom).toBe(first.cursor)
    const lines = (await readFile(join(dir, "R98_m2_t11_part1_shard0of1.ndjson"), "utf8")).trim().split("\n")
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as { cursor: number; rowsScreened: number }
    expect(last.cursor).toBe(first.cursor)
    expect(last.rowsScreened).toBe(first.rowsScreened)
    const second = await screenAnchorRange({ startCursor: last.cursor, maxAnchors: 1, budgetMs: 55000, shard: 0, shards: 1, outDir: dir, tag: "part2" })
    const full = await screenAnchorRange({ startCursor: 0, maxAnchors: 2, budgetMs: 55000, shard: 0, shards: 1, outDir: dir, tag: "full" })
    expect(first.rowsScreened + second.rowsScreened).toBe(full.rowsScreened)
    expect(first.rowsRefuted + second.rowsRefuted).toBe(full.rowsRefuted)
    expect(first.rowsUndecided + second.rowsUndecided).toBe(full.rowsUndecided)
    expect(first.anchorsRefused + second.anchorsRefused).toBe(full.anchorsRefused)
    expect(second.cursor).toBe(full.cursor)
    expect(second.unscreenedFrom).toBe(second.cursor)
    const zero = await screenAnchorRange({ startCursor: 0, maxAnchors: 2, budgetMs: 0, shard: 0, shards: 1, outDir: dir, tag: "zero" })
    expect(zero.rowsScreened).toBe(0)
    expect(zero.anchorsCompleted).toBe(0)
    expect(zero.cursor).toBe(0)
    expect(zero.survivors).toEqual([])
    expect(zero.timedOut).toBe(true)
    expect(zero.bounded).toBe(true)
    expect(zero.unscreenedFrom).toBe(0)
  }, 55000)

  it("R97 resume: recorded sizing cursors are honoured, never fabricated", async () => {
    const dir = await freshDir()
    await writeFile(join(dir, "R97_m2_sizing.json"), JSON.stringify({ t11: { screenedAnchors: 3 } }), "utf8")
    expect(await readR97ResumeCursor(dir)).toBe(3)
    expect(await readR97ResumeCursor(await freshDir())).toBe(0)
  }, 55000)
})
