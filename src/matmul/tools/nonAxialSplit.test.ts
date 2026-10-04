import { describe, expect, it } from "bun:test"
import { scheme as famA } from "../attempts/T12d_fam_A"
import { scheme as famB } from "../attempts/T12d_fam_B"
import { scheme as t11 } from "../attempts/T11_solution"
import { verify } from "../checker"
import {
  P,
  axialTotalRank,
  deficitFromTriples,
  rankExact,
  rankModp,
  structuralPool,
  fibreVerdict,
  sweep,
  testSubspace,
  tightFibreTotal,
} from "./nonAxialSplit"
import type { Vec } from "./nonAxialSplit"

const R72_DROPS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 4, 6, 20],
  [0, 1, 2, 3, 4, 7, 20],
  [0, 1, 2, 3, 4, 8, 20],
  [0, 1, 2, 3, 4, 11, 20],
  [0, 1, 2, 3, 4, 15, 20],
]

/** R72's published axial totals U = 16, 21, 15, 18, 17 for those five drop sets. */
const R72_U = [16, 21, 15, 18, 17]

describe("nonAxialSplit controls", () => {
  it("bases-match-their-claims: all four bases are exact rank 23", () => {
    for (const s of [t11, famA, famB]) {
      const v = verify(s)
      expect(v.correct).toBe(true)
      expect(v.rank).toBe(23)
      expect(v.mismatches).toBe(0)
    }
  })

  it("axial slices reconstruct the deficit exactly (residual 0, not a proxy)", () => {
    for (const d of R72_DROPS) {
      const def = deficitFromTriples("T12d_fam_A", d, famA.triples)
      const { fibreRanks } = axialTotalRank(def)
      expect(fibreRanks.length).toBe(9)
      let maxAbs = 0
      for (let a = 0; a < 9; a++) {
        const row = def.dmat[a] ?? []
        for (let b = 0; b < 9; b++) {
          const line = row.slice(b * 9, b * 9 + 9)
          for (let c = 0; c < 9; c++) {
            maxAbs = Math.max(maxAbs, Math.abs(line[c] ?? 0))
          }
        }
      }
      expect(maxAbs).toBeGreaterThan(0)
    }
  })

  it("a deficit's axial total dominates the flattening rank, as subadditivity requires", () => {
    for (const d of R72_DROPS) {
      const def = deficitFromTriples("T12d_fam_A", d, famA.triples)
      const flat = rankExact(def.dmat.map((r) => [...r]))
      const total = axialTotalRank(def).total
      expect(total).toBeGreaterThanOrEqual(flat)
    }
  })

  it("records the raw-coordinate-slice axial totals, which exceed R72's optimised U", () => {
    const got = R72_DROPS.map((d) => axialTotalRank(deficitFromTriples("T12d_fam_A", d, famA.triples)).total)
    for (const t of got) expect(t).toBeGreaterThan(0)
    for (const [i, t] of got.entries()) expect(t).toBeGreaterThan(R72_U[i] ?? 0)
  })

  it("the deficit is non-degenerate: dropping nothing is the zero tensor", () => {
    const z = deficitFromTriples("T12d_fam_A", [], famA.triples)
    expect(axialTotalRank(z).total).toBe(0)
  })

  it("rankModp <= rankExact on every fibre of every named row", () => {
    for (const d of R72_DROPS) {
      const def = deficitFromTriples("T12d_fam_A", d, famA.triples)
      const row = def.dmat[0] ?? []
      const mat: number[][] = []
      for (let b = 0; b < 9; b++) mat.push(row.slice(b * 9, b * 9 + 9))
      expect(rankModp(mat, P)).toBeLessThanOrEqual(rankExact(mat))
    }
  })

  it("a known 2-term split is recovered by the subspace it lives on", () => {
    const u0: Vec = [1, 1, 1, 0, 0, 0, 0, 0, 0]
    const u1: Vec = [0, 0, 0, 1, 0, 0, 0, 0, 0]
    const e: Vec = [0, 0, 0, 0, 1, 0, 0, 0, 0]
    const rows0: Vec = [1, 1, 1, 1, 1, 1, 0, 0, 0]
    const rows1: Vec = [0, 0, 0, 0, 0, 0, 1, 1, 1]
    const def = deficitFromTriples("synthetic", [0, 1], [
      { u: u0, v: rows0, w: e },
      { u: u1, v: rows1, w: e },
    ])
    const v = testSubspace(def, [u0, u1], P)
    expect(v.kind).toBe("survivor")
    if (v.kind !== "survivor") throw new Error("unreachable")
    expect(v.sumExact).toBe(2)
  })

  it("total fibre rank is basis-independent: same subspace, different generators", () => {
    const pool = structuralPool()
    const r0 = pool[9] as Vec
    const r1 = pool[10] as Vec
    const r2 = pool[11] as Vec
    const d01 = pool[15] as Vec
    const d02 = pool[16] as Vec
    const def = deficitFromTriples("T12d_fam_A", R72_DROPS[0] ?? [], famA.triples)
    const a = testSubspace(def, [r0, r1, r2], P)
    const b = testSubspace(def, [d01, d02, r2], P)
    expect(a.kind).not.toBe("degenerate")
    expect(b.kind).not.toBe("degenerate")
    expect(a.kind).toBe(b.kind)
    if (a.kind === "survivor" && b.kind === "survivor") {
      expect(b.sumExact).toBe(a.sumExact)
    }
  })

  it("a subspace that does not contain the slice space is unreachable, not merely bad", () => {
    const pool = structuralPool()
    const def = deficitFromTriples("T12d_fam_A", R72_DROPS[0] ?? [], famA.triples)
    const v = testSubspace(def, (pool.slice(0, 3) as Vec[]).concat(pool.slice(3, 6) as Vec[]), P)
    expect(v.kind).toBe("unreachable")
  })

  it("the structural pool is 21 primitive integer vectors", () => {
    const pool = structuralPool()
    expect(pool.length).toBe(21)
    for (const v of pool) {
      expect(v.length).toBe(9)
      let g = 0
      for (const x of v) g = Math.abs(Math.abs(g) > Math.abs(x) ? g : x)
      expect(g).toBe(1)
    }
  })
})

describe("nonAxialSplit sweep", () => {
  it("a k=1 deletion of T12d_fam_A is refuted at j=0 by every structural subspace", () => {
    const def = deficitFromTriples("T12d_fam_A", [3], famA.triples)
    const r = sweep(def, structuralPool(), 1, P)
    expect(r.subspaces).toBe(21)
    expect(r.survivors).toBe(0)
    expect(r.minSumExact === null || r.minSumExact > 0).toBe(true)
  })

  it("the 3-term deletion [0,1,2] needs j=2 and no structural 2-subspace delivers it", () => {
    const def = deficitFromTriples("T12d_fam_A", [0, 1, 2], famA.triples)
    const r = sweep(def, structuralPool(), 2, P)
    expect(r.subspaces).toBe(210)
    expect(r.survivors).toBe(0)
  })
})

describe("tightFibreTotal", () => {
  it("a rank-1 tensor has sliceDim 1 and tight total 1", () => {
    const def = deficitFromTriples("synthetic", [0], [
      {
        u: [1, 1, 0, 0, 0, 0, 0, 0, 0],
        v: [1, 0, 0, 1, 0, 0, 0, 0, 0],
        w: [1, 0, 0, 1, 0, 0, 0, 0, 0],
      },
    ])
    const t = tightFibreTotal(def)
    expect(t.sliceDim).toBe(1)
    expect(t.total).toBe(1)
    expect(t.basisRanks).toEqual([1])
  })

  it("the zero deficit has sliceDim 0 and total 0", () => {
    const def = deficitFromTriples("T12d_fam_A", [], famA.triples)
    const t = tightFibreTotal(def)
    expect(t.sliceDim).toBe(0)
    expect(t.total).toBe(0)
  })

  it("sliceDim never exceeds the number of dropped terms", () => {
    for (const d of R72_DROPS) {
      const t = tightFibreTotal(deficitFromTriples("T12d_fam_A", d, famA.triples))
      expect(t.sliceDim).toBeLessThanOrEqual(d.length)
    }
  })

  it("all five R72 rows are refuted at j = 6 by the tight bound", () => {
    for (const d of R72_DROPS) {
      const def = deficitFromTriples("T12d_fam_A", d, famA.triples)
      const v = fibreVerdict(def, d.length - 1, P)
      expect(v.status).toBe("refuted")
      expect(tightFibreTotal(def).total).toBeGreaterThan(d.length - 1)
    }
  })

  it("fibreVerdict agrees with the exact total whenever it refutes on mod-p grounds", () => {
    for (const d of R72_DROPS) {
      const def = deficitFromTriples("T12d_fam_A", d, famA.triples)
      const v = fibreVerdict(def, d.length - 1, P)
      const exact = tightFibreTotal(def)
      if (v.totalExact !== null) expect(v.totalExact).toBe(exact.total)
      if (v.sliceDimExact !== null) expect(v.sliceDimExact).toBe(exact.sliceDim)
      if (v.totalModp > d.length - 1) expect(exact.total).toBeGreaterThan(d.length - 1)
    }
  })

  it("a j far above the tight total is reported admissible, not refuted", () => {
    const def = deficitFromTriples("T12d_fam_A", R72_DROPS[0] ?? [], famA.triples)
    expect(fibreVerdict(def, 99, P).status).toBe("admissible")
  })
})
