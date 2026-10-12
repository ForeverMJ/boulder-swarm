import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "bun:test"
import type { Scheme } from "../types"
import { scheme as famB } from "./T12d_fam_B"
import {
  anchorOf,
  anchorSpaceCount,
  anchorStepsUpTo,
  binomial,
  combos,
  compactAll,
  droppedSum,
  enumerateRefinements,
  isRankAtMostOne,
  modpFlatDim,
  PREFILTER_PRIMES,
  ROWS_PER_ANCHOR,
  runControls,
  screenAnchorRange,
  screenRow,
  unfoldingRankAtMostOne,
  FLAT,
} from "./R98_m2_famB_search"
import type { Refinement } from "./R98_m2_famB_search"

async function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "r98famB-"))
}

function firstGoodAnchor(): { anchor: Scheme; steps: Refinement[] } {
  const pool = enumerateRefinements(famB)
  for (const steps of anchorStepsUpTo(pool, 2)) {
    try {
      return { anchor: anchorOf(famB, steps), steps }
    } catch {
      continue
    }
  }
  throw new Error("no non-degenerate anchor found")
}

describe("R98_m2_famB_search", () => {
  it("gating controls pass: base-exact, famb-m2-planned, roundtrip, T11 repro", () => {
    const ctrl = runControls()
    for (const c of ctrl) expect(c.pass).toBe(true)
    const names = ctrl.map((c) => c.name)
    expect(names).toContain("base-exact")
    expect(names).toContain("famb-m2-planned")
    expect(names).toContain("factorisation-roundtrip")
    expect(names).toContain("t11-row-reproduction")
  }, 180000)

  it("anchor space re-derived on current file: 3458 refinements, 5383004 anchors, C(25,4) rows", () => {
    const pool = enumerateRefinements(famB)
    expect(pool.length).toBe(3458)
    // Independent re-derivation: recount support splits per term from scratch.
    const groups = new Map<number, bigint>()
    for (let term = 0; term < famB.triples.length; term++) {
      const t = famB.triples[term]
      if (t === undefined) continue
      const factors: ReadonlyArray<readonly number[]> = [t.u, t.v, t.w]
      for (let mode = 0; mode < 3; mode++) {
        const f = factors[mode]
        if (f === undefined) continue
        const supp: number[] = []
        for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp.push(i)
        if (supp.length < 2) continue
        const total = 1 << supp.length
        for (let sub = 1; sub < total - 1; sub++) {
          groups.set(term, (groups.get(term) ?? 0n) + 1n)
        }
      }
    }
    let dp = [1n, 0n, 0n]
    for (const n of groups.values()) {
      const next = [...dp]
      for (let j = 1; j < dp.length; j++) next[j] = (next[j] ?? 0n) + (dp[j - 1] ?? 0n) * n
      dp = next
    }
    expect((dp[2] ?? 0n).toString()).toBe(anchorSpaceCount(pool, 2).toString())
    expect(anchorSpaceCount(pool, 2)).toBe(5383004n)
    expect(ROWS_PER_ANCHOR).toBe(12650)
    expect(binomial(25, 4)).toBe(12650)
  }, 180000)

  it("per-row ladder: refuted rows carry reasons, prefilter never over-refutes", () => {
    const { anchor } = firstGoodAnchor()
    const terms = compactAll(anchor)
    const scratch = new Int32Array(FLAT)
    const touched: number[] = []
    const flatScratch = new Int32Array(9 * 81)
    const oracle = { rows: 0, disagreements: 0 }
    let refuted = 0
    for (const drop of combos(terms.length, 4)) {
      const vd = screenRow(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      expect(vd.reason.length).toBeGreaterThan(0)
      expect(["REFUTED", "SURVIVOR", "UNRESOLVED"]).toContain(vd.status)
      if (vd.status === "REFUTED") {
        refuted += 1
        const direct = droppedSum(terms, [...drop])
        if (vd.reason === "modp-prefilter-flatDim>1") {
          expect(modpFlatDim(direct, PREFILTER_PRIMES, 1)).toBeGreaterThan(1)
          expect(isRankAtMostOne(direct)).toBe(false)
        } else {
          expect(isRankAtMostOne(direct)).toBe(false)
          expect(unfoldingRankAtMostOne(direct)).toBe(false)
        }
      }
      if (refuted >= 25) break
    }
    expect(refuted).toBeGreaterThan(0)
  }, 180000)

  it("resume discipline: split run equals one uninterrupted run, cursor never ahead", async () => {
    const dir = await freshDir()
    const first = await screenAnchorRange({ startCursor: 0, maxAnchors: 2, budgetMs: 600000, shard: 0, shards: 1, outDir: dir, tag: "part1" })
    expect(first.anchorsCompleted).toBe(2)
    expect(first.rowsRefuted + first.rowsSurvivor + first.rowsUndecided).toBe(first.rowsScreened)
    const lines = (await readFile(join(dir, "R98_m2_famB_part1_shard0of1.ndjson"), "utf8")).trim().split("\n")
    const last = JSON.parse(lines[lines.length - 1] ?? "{}") as { cursor: number; rowsScreened: number }
    expect(last.cursor).toBe(first.cursor)
    expect(last.rowsScreened).toBe(first.rowsScreened)
    const second = await screenAnchorRange({ startCursor: last.cursor, maxAnchors: 2, budgetMs: 600000, shard: 0, shards: 1, outDir: dir, tag: "part2" })
    const full = await screenAnchorRange({ startCursor: 0, maxAnchors: 4, budgetMs: 600000, shard: 0, shards: 1, outDir: dir, tag: "full" })
    expect(first.rowsScreened + second.rowsScreened).toBe(full.rowsScreened)
    expect(first.rowsRefuted + second.rowsRefuted).toBe(full.rowsRefuted)
    expect(first.rowsUndecided + second.rowsUndecided).toBe(full.rowsUndecided)
    expect(first.anchorsRefused + second.anchorsRefused).toBe(full.anchorsRefused)
    expect(second.cursor).toBe(full.cursor)
  }, 180000)

  it("budget honesty and shard partition: zero budget claims nothing, shards sum exactly", async () => {
    const dir = await freshDir()
    const zero = await screenAnchorRange({ startCursor: 0, maxAnchors: 4, budgetMs: 0, shard: 0, shards: 1, outDir: dir, tag: "zero" })
    expect(zero.rowsScreened).toBe(0)
    expect(zero.anchorsCompleted).toBe(0)
    expect(zero.cursor).toBe(0)
    expect(zero.survivors).toEqual([])
    expect(zero.timedOut).toBe(true)
    const s0 = await screenAnchorRange({ startCursor: 0, maxAnchors: 4, budgetMs: 600000, shard: 0, shards: 2, outDir: dir, tag: "s0" })
    const s1 = await screenAnchorRange({ startCursor: 0, maxAnchors: 4, budgetMs: 600000, shard: 1, shards: 2, outDir: dir, tag: "s1" })
    const full = await screenAnchorRange({ startCursor: 0, maxAnchors: 8, budgetMs: 600000, shard: 0, shards: 1, outDir: dir, tag: "full" })
    expect(s0.rowsScreened + s1.rowsScreened).toBe(full.rowsScreened)
    expect(s0.rowsRefuted + s1.rowsRefuted).toBe(full.rowsRefuted)
    expect(s0.rowsUndecided + s1.rowsUndecided).toBe(full.rowsUndecided)
    expect(s0.anchorsCompleted + s1.anchorsCompleted).toBe(full.anchorsCompleted)
  }, 180000)
})
