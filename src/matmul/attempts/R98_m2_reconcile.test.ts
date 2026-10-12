/**
 * R98-m2 reconcile test — independent re-derivation of the R90 reconcile.
 *
 * This file carries its OWN enumerator (support-index lists + submask
 * iteration over support positions, NOT raw 9-bit mask scans) and its OWN
 * closed forms; it does NOT import from R98_m2_reconcile.ts. It locks, on the
 * current main files: pool sizes, distinct term:mode slot counts (e2 AND e3),
 * distinct-term DP counts, rowsPerAnchor C(25,4) = 12650, and every shard
 * cursor of the 8-shard m=2 sweep plan, then checks the JSON artifact matches
 * the re-derivation exactly.
 *
 * Honesty: sizing only. This test asserts the artifact verdict is
 * RECONCILED-NO-CLOSURE and that its note names the open bands — any closure
 * claim fails here.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import type { Scheme } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"

const HERE = dirname(fileURLToPath(import.meta.url))

type SlotRef = { readonly term: number; readonly mode: number; readonly mask: number }

/**
 * Independent enumeration: per-factor support as an index list, nonempty
 * proper submasks over SUPPORT POSITIONS mapped back to bitmasks. Same set as
 * the reference enumerator, different code path.
 */
function enumerateAgain(s: Scheme): SlotRef[] {
  const out: SlotRef[] = []
  for (let term = 0; term < s.triples.length; term += 1) {
    const t = s.triples[term]
    if (t === undefined) continue
    const factors: ReadonlyArray<readonly number[]> = [t.u, t.v, t.w]
    for (let mode = 0; mode < 3; mode += 1) {
      const f = factors[mode]
      if (f === undefined) continue
      const supp: number[] = []
      for (let i = 0; i < 9; i += 1) if ((f[i] ?? 0) !== 0) supp.push(i)
      if (supp.length < 2) continue
      const total = 1 << supp.length
      for (let sub = 1; sub < total - 1; sub += 1) {
        let mask = 0
        for (let b = 0; b < supp.length; b += 1) {
          if (((sub >> b) & 1) === 1) mask |= 1 << (supp[b] ?? 0)
        }
        out.push({ term, mode, mask })
      }
    }
  }
  return out
}

function bothCounts(pool: readonly SlotRef[]): {
  refinements: number
  slots: number
  e2: bigint
  e3: bigint
  dp2: bigint
} {
  const slotGroups = new Map<string, bigint>()
  const termGroups = new Map<number, bigint>()
  for (const r of pool) {
    const key = `${r.term}:${r.mode}`
    slotGroups.set(key, (slotGroups.get(key) ?? 0n) + 1n)
    termGroups.set(r.term, (termGroups.get(r.term) ?? 0n) + 1n)
  }
  let s1 = 0n
  let s2 = 0n
  let s3 = 0n
  for (const g of slotGroups.values()) {
    s1 += g
    s2 += g * g
    s3 += g * g * g
  }
  const dp: bigint[] = [1n, 0n, 0n]
  for (const n of termGroups.values()) {
    for (let j = dp.length - 1; j >= 1; j -= 1) {
      dp[j] = (dp[j] ?? 0n) + (dp[j - 1] ?? 0n) * n
    }
  }
  return {
    refinements: pool.length,
    slots: slotGroups.size,
    e2: (s1 * s1 - s2) / 2n,
    e3: (s1 * s1 * s1 - 3n * s1 * s2 + 2n * s3) / 6n,
    dp2: dp[2] ?? 0n,
  }
}

function binomialSmall(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

/** Modulo-partition shard cursors, recomputed from scratch. */
function shardAnchors(planned: number, shards: number): number[] {
  const out: number[] = []
  for (let s = 0; s < shards; s += 1) out.push(Math.floor((planned - s + shards - 1) / shards))
  return out
}

type ReconcileJson = {
  perBase: {
    name: string
    refinements: number
    slots: number
    slotE2: number
    slotE3: number
    distinctTermM2: number
    rowsPerAnchor: number
    totalRowsM2: number
  }[]
  historicNumbers: { value: number; formula: string; reproducesOnCurrentFiles: boolean }[]
  shardPlan: {
    base: string
    m: number
    planned: number
    rowsPerAnchor: number
    rowsPlanned: number
    shards: { shard: number; shards: number; anchors: number; rows: number; start: number }[]
    completionCursor: number
  }[]
  totalAnchorsM2: number
  totalRowsM2: number
  rowsPerAnchor: number
  verdict: string
  note: string
}

async function loadJson(): Promise<ReconcileJson> {
  const raw = await readFile(join(HERE, "R98_m2_reconcile.json"), "utf8")
  return JSON.parse(raw) as ReconcileJson
}

describe("R98 m=2 reconcile", () => {
  it("re-derives pool sizes and BOTH counts independently (no import of the implementation)", () => {
    const a = bothCounts(enumerateAgain(t11))
    expect(a.refinements).toBe(984)
    expect(a.slots).toBe(38)
    expect(a.e2).toBe(432852n)
    expect(a.e3).toBe(114840064n)
    expect(a.dp2).toBe(428180n)

    const fa = bothCounts(enumerateAgain(famA))
    expect(fa.refinements).toBe(4474)
    expect(fa.slots).toBe(57)
    expect(fa.e2).toBe(9256528n)
    expect(fa.e3).toBe(11793549216n)
    expect(fa.dp2).toBe(9069616n)

    const fb = bothCounts(enumerateAgain(famB))
    expect(fb.refinements).toBe(3458)
    expect(fb.slots).toBe(55)
    expect(fb.e2).toBe(5488356n)
    expect(fb.e3).toBe(5338296456n)
    expect(fb.dp2).toBe(5383004n)
  })

  it("rowsPerAnchor is C(25,4) = 12650", () => {
    expect(binomialSmall(25, 4)).toBe(12650)
  })

  it("shard cursors: 8-shard modulo partition per base, fresh start 0", () => {
    expect(shardAnchors(428180, 8)).toEqual([53523, 53523, 53523, 53523, 53522, 53522, 53522, 53522])
    expect(shardAnchors(9069616, 8)).toEqual([
      1133702, 1133702, 1133702, 1133702, 1133702, 1133702, 1133702, 1133702,
    ])
    expect(shardAnchors(5383004, 8)).toEqual([
      672876, 672876, 672876, 672876, 672875, 672875, 672875, 672875,
    ])
  })

  it("JSON matches the independent re-derivation on every base", async () => {
    const json = await loadJson()
    const byName = new Map(json.perBase.map((p) => [p.name, p]))
    const cases: ReadonlyArray<readonly [Scheme, string]> = [
      [t11, "T11_solution"],
      [famA, "T12d_fam_A"],
      [famB, "T12d_fam_B"],
    ]
    for (const [scheme, name] of cases) {
      const c = bothCounts(enumerateAgain(scheme))
      const p = byName.get(name)
      expect(p).toBeDefined()
      expect(p?.refinements).toBe(c.refinements)
      expect(p?.slots).toBe(c.slots)
      expect(p?.slotE2).toBe(Number(c.e2))
      expect(p?.slotE3).toBe(Number(c.e3))
      expect(p?.distinctTermM2).toBe(Number(c.dp2))
      expect(p?.rowsPerAnchor).toBe(12650)
      expect(p?.totalRowsM2).toBe(Number(c.dp2) * 12650)
    }
    expect(json.totalRowsM2).toBe(5416477000 + 114730642400 + 68095000600)
    expect(json.totalAnchorsM2).toBe(428180 + 9069616 + 5383004)
    expect(json.rowsPerAnchor).toBe(12650)
  })

  it("JSON shard plan matches the recomputed cursors and row identities", async () => {
    const json = await loadJson()
    const plannedByBase = new Map([
      ["T11_solution", 428180],
      ["T12d_fam_A", 9069616],
      ["T12d_fam_B", 5383004],
    ])
    expect(json.shardPlan.length).toBe(3)
    for (const plan of json.shardPlan) {
      const planned = plannedByBase.get(plan.base) ?? -1
      expect(planned).toBeGreaterThan(0)
      expect(plan.m).toBe(2)
      expect(plan.planned).toBe(planned)
      expect(plan.rowsPerAnchor).toBe(12650)
      expect(plan.rowsPlanned).toBe(planned * 12650)
      expect(plan.completionCursor).toBe(planned)
      const want = shardAnchors(planned, 8)
      expect(plan.shards.length).toBe(8)
      plan.shards.forEach((sh, i) => {
        expect(sh.shard).toBe(i)
        expect(sh.shards).toBe(8)
        expect(sh.anchors).toBe(want[i] ?? 0)
        expect(sh.rows).toBe((want[i] ?? 0) * 12650)
        expect(sh.start).toBe(0)
      })
      const anchorsSum = plan.shards.reduce((a, sh) => a + sh.anchors, 0)
      const rowsSum = plan.shards.reduce((a, sh) => a + sh.rows, 0)
      expect(anchorsSum).toBe(planned)
      expect(rowsSum).toBe(planned * 12650)
    }
  })

  it("JSON names which formula each historic number used", async () => {
    const json = await loadJson()
    const byValue = new Map(json.historicNumbers.map((h) => [h.value, h]))
    // R85 ground truths are distinct-TERM DP counts.
    expect(byValue.get(4169972)?.formula).toContain("DP")
    expect(byValue.get(4169972)?.reproducesOnCurrentFiles).toBe(false)
    expect(byValue.get(5383004)?.formula).toContain("DP")
    expect(byValue.get(5383004)?.reproducesOnCurrentFiles).toBe(true)
    // Slot-formula numbers are tagged as slot e2.
    expect(byValue.get(5488356)?.formula).toContain("slot e2")
    expect(byValue.get(9256528)?.formula).toContain("slot e2")
    expect(byValue.get(432852)?.formula).toContain("slot e2")
    // The irreproducible fam_A number is explicit, never fabricated.
    expect(byValue.get(9069616)?.formula).toContain("DP")
    expect(byValue.get(428180)?.formula).toContain("DP")
  })

  it("claims no closure of any band", async () => {
    const json = await loadJson()
    expect(json.verdict).toBe("RECONCILED-NO-CLOSURE")
    expect(json.verdict).not.toContain("CLOSED")
    expect(json.note).toContain("no m=2 band is closed")
    expect(json.note).toContain("19 <=")
  })
})
