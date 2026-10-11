/**
 * R90-size test — independent re-derivation of the closed-form m=3 sizing.
 *
 * This file carries its OWN second copy of the refinement enumeration
 * (deliberately implemented differently from R90_m3_sizing.ts: support-index
 * lists + submask iteration over support positions instead of raw mask scans;
 * it does NOT import from R90_m3_sizing.ts) and checks the deliverable JSON.
 *
 * Honesty note: the task's mandated asserts (anchorsM2 === 4169972 / 5383004)
 * are UNREPRODUCIBLE — the port is verified correct (identical pool sizes to
 * the branch's own anchorSplit.ts; grouping the branch-era fam_A pool by TERM
 * gives exactly 4169972), but those ground-truth numbers are R85
 * distinct-TERM counts while the task's e2 counts distinct term:mode SLOT
 * pairs, and fam_A has since been replaced on main. Fabricating the mandated
 * equality would violate the task RULES ("never fabricate counts"), so this
 * test instead locks in the honestly computed values, their internal
 * consistency with the JSON, rowsPerAnchor === 65780, and the SIZING-FAILED
 * verdict with its explanatory note. The expected ground-truth numbers are
 * referenced below so the deviation is explicit, not hidden.
 */
import { readFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import type { Scheme } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"

const HERE = dirname(fileURLToPath(import.meta.url))

const EXPECTED_GROUND_TRUTH_M2_A = 4169972
const EXPECTED_GROUND_TRUTH_M2_B = 5383004

type SlotRef = { readonly term: number; readonly mode: number; readonly mask: number }

/**
 * Independent refinement enumeration: collect each factor's support as an
 * index list, then iterate nonempty proper submasks over SUPPORT POSITIONS
 * (not raw 9-bit masks) and map back to bitmasks. Same set as the reference
 * enumerator, different code path.
 */
function enumerateRefinementsAgain(s: Scheme): SlotRef[] {
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

function closedForm(pool: readonly SlotRef[]): {
  refinements: number
  slots: number
  e2: bigint
  e3: bigint
} {
  const groups = new Map<string, bigint>()
  for (const r of pool) {
    const key = `${r.term}:${r.mode}`
    groups.set(key, (groups.get(key) ?? 0n) + 1n)
  }
  let s1 = 0n
  let s2 = 0n
  let s3 = 0n
  for (const g of groups.values()) {
    s1 += g
    s2 += g * g
    s3 += g * g * g
  }
  return {
    refinements: pool.length,
    slots: groups.size,
    e2: (s1 * s1 - s2) / 2n,
    e3: (s1 * s1 * s1 - 3n * s1 * s2 + 2n * s3) / 6n,
  }
}

function binomialSmall(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

describe("R90 m=3 wide-anchor sizing", () => {
  it("re-derives closed-form counts independently (no import from sizing script)", () => {
    const a = closedForm(enumerateRefinementsAgain(famA))
    const b = closedForm(enumerateRefinementsAgain(famB))
    // Honest values on the CURRENT files under the distinct-slot definition.
    expect(a.refinements).toBe(4474)
    expect(a.slots).toBe(57)
    expect(a.e2).toBe(9256528n)
    expect(a.e3).toBe(11793549216n)
    expect(b.refinements).toBe(3458)
    expect(b.slots).toBe(55)
    expect(b.e2).toBe(5488356n)
    expect(b.e3).toBe(5338296456n)
    // Explicitly NOT the old ground truth: documents the verified mismatch
    // instead of fabricating it (see file header).
    expect(Number(a.e2)).not.toBe(EXPECTED_GROUND_TRUTH_M2_A)
    expect(Number(b.e2)).not.toBe(EXPECTED_GROUND_TRUTH_M2_B)
  })

  it("rowsPerAnchor is C(26,5) = 65780", () => {
    expect(binomialSmall(26, 5)).toBe(65780)
  })

  it("JSON exists, matches the independent re-derivation, and reports SIZING-FAILED", async () => {
    const raw = await readFile(join(HERE, "R90_m3_sizing.json"), "utf8")
    const json = JSON.parse(raw) as {
      perBase: { name: string; anchorsM2: number; anchorsM3: number; rowsPerAnchor: number; totalRowsM3: number }[]
      totalAnchorsM3: number
      totalRowsM3: number
      assumedRowsPerSecPerShard: number
      projectionCoreHours: number
      projectionWallHours28Shards: number
      verdict: string
      note: string
    }
    const a = closedForm(enumerateRefinementsAgain(famA))
    const b = closedForm(enumerateRefinementsAgain(famB))
    const byName = new Map(json.perBase.map((p) => [p.name, p]))
    const pa = byName.get("T12d_fam_A")
    const pb = byName.get("T12d_fam_B")
    expect(pa).toBeDefined()
    expect(pb).toBeDefined()
    expect(pa?.anchorsM2).toBe(Number(a.e2))
    expect(pb?.anchorsM2).toBe(Number(b.e2))
    expect(pa?.anchorsM3).toBe(Number(a.e3))
    expect(pb?.anchorsM3).toBe(Number(b.e3))
    expect(pa?.rowsPerAnchor).toBe(65780)
    expect(pb?.rowsPerAnchor).toBe(65780)
    // totalRowsM3 === sum over bases of anchorsM3 * 65780.
    expect(json.totalRowsM3).toBe(
      (pa?.anchorsM3 ?? 0) * 65780 + (pb?.anchorsM3 ?? 0) * 65780,
    )
    expect(json.totalRowsM3).toBe(Number(a.e3) * 65780 + Number(b.e3) * 65780)
    expect(json.totalAnchorsM3).toBe(Number(a.e3) + Number(b.e3))
    expect(json.assumedRowsPerSecPerShard).toBe(200000)
    // Ground truth irreproducible -> honest failure verdict, never fabricated.
    expect(json.verdict).toBe("SIZING-FAILED")
    expect(json.note).toContain("4169972")
    expect(json.note).toContain("5383004")
  })
})
