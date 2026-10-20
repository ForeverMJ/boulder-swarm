import { describe, expect, it } from "bun:test"
import { verify, verifyMod2 } from "../checker"
import { buildTarget } from "../types"
import {
  BLOCK_SWAP,
  CYCLE4,
  DIM,
  FLOOR_HASH,
  FLOOR_RANK,
  GROUP_BT,
  GROUP_C4,
  GROUP_S4,
  GROUPS,
  PROBLEM_N,
  TARGET,
  TARGET_RANK,
  TASK_ID,
  TENSOR,
  TRANSPOSE,
  actTriple,
  axisConsistency,
  buildPool,
  composePerm,
  countOrbitSubsets,
  floorControl,
  gaussSolve,
  groupClosure,
  hashSupport,
  isInvariant,
  masksToScheme,
  mismatchF2,
  nonFixedWitness,
  orbitPartition,
  orbitSignature,
  orbitSizeHistogram,
  permutationCellPerm,
  popcount,
  refutedControl,
  runProbe,
  sampleOrbitSupports,
  solveOrbitCoeffs,
  solveSupportCoeffs,
  supportKey,
  targetFixedBy,
  targetFixedByGroup,
  toyAdmission,
  tripleKey,
  verifyExactIndependent,
  type Mask,
} from "./R146_sym47"
import { twoLevelStrassen4 } from "./R140_algsupports"

const FLOOR: readonly Mask[] = twoLevelStrassen4().map((v) => [v.u, v.v, v.w] as Mask)

function isPermutation(p: readonly number[]): boolean {
  const seen = new Set<number>()
  for (const x of p) {
    if (x < 0 || x >= DIM || seen.has(x)) return false
    seen.add(x)
  }
  return seen.size === DIM
}

describe("R146_sym47 metadata and target", () => {
  it("exports the task contract constants", () => {
    expect(TASK_ID).toBe("R146-sym47")
    expect(PROBLEM_N).toBe(4)
    expect(DIM).toBe(16)
    expect(TENSOR).toBe(4096)
    expect(FLOOR_RANK).toBe(49)
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_HASH).toBe("f4640c18")
  })

  it("target has 64 ones and matches buildTarget", () => {
    let ones = 0
    for (let i = 0; i < TENSOR; i++) if ((TARGET[i] ?? 0) !== 0) ones++
    expect(ones).toBe(64)
    const reference = buildTarget(PROBLEM_N)
    let agree = true
    for (let a = 0; a < DIM; a++) {
      for (let b = 0; b < DIM; b++) {
        for (let c = 0; c < DIM; c++) {
          const want = reference[a]?.[b]?.[c] ?? 0
          const got = TARGET[(a * DIM + b) * DIM + c] ?? 0
          if (want !== got) agree = false
        }
      }
    }
    expect(agree).toBe(true)
  })
})

describe("R146_sym47 group actions", () => {
  it("has the expected group orders", () => {
    expect(GROUP_S4.elements.length).toBe(24)
    expect(GROUP_C4.elements.length).toBe(4)
    expect(GROUP_BT.elements.length).toBe(4)
    expect(GROUPS.length).toBe(3)
  })

  it("every group element is a 16-cell permutation", () => {
    for (const group of GROUPS) {
      for (const p of group.elements) {
        expect(p.length).toBe(DIM)
        expect(isPermutation(p)).toBe(true)
      }
    }
  })

  it("S4 and C4 fix the matmul tensor; the transpose obstruction is real", () => {
    expect(targetFixedByGroup(GROUP_S4)).toBe(true)
    expect(targetFixedByGroup(GROUP_C4)).toBe(true)
    expect(targetFixedByGroup(GROUP_BT)).toBe(false)
    expect(nonFixedWitness(GROUP_S4)).toBeNull()
    expect(nonFixedWitness(GROUP_C4)).toBeNull()
    const witness = nonFixedWitness(GROUP_BT)
    expect(witness).not.toBeNull()
    if (witness !== null) {
      expect(witness.want).not.toBe(witness.got)
    }
  })

  it("generators have the expected orders and transposition is an involution", () => {
    const id = composePerm(TRANSPOSE, TRANSPOSE)
    for (let i = 0; i < DIM; i++) expect(id[i]).toBe(i)
    const bs2 = composePerm(BLOCK_SWAP, BLOCK_SWAP)
    for (let i = 0; i < DIM; i++) expect(bs2[i]).toBe(i)
    const c4 = groupClosure([CYCLE4])
    expect(c4.length).toBe(4)
    expect(targetFixedBy(CYCLE4)).toBe(true)
    expect(targetFixedBy(TRANSPOSE)).toBe(false)
    expect(permutationCellPerm([0, 1, 2, 3]).every((v, i) => v === i)).toBe(true)
  })

  it("acts diagonally on all three axes", () => {
    const t: Mask = [1, 2, 4]
    const a = actTriple(t, TRANSPOSE)
    expect(a[0]).toBe(actTriple([1, 0, 0], TRANSPOSE)[0])
    expect(a[1]).toBe(actTriple([0, 2, 0], TRANSPOSE)[1])
    expect(a[2]).toBe(actTriple([0, 0, 4], TRANSPOSE)[2])
  })
})

describe("R146_sym47 exact F_2 solver", () => {
  it("solves a consistent system and rejects an inconsistent one", () => {
    expect(gaussSolve(2, [{ coef: [1, 0], rhs: 1 }, { coef: [0, 1], rhs: 0 }])).toEqual([1, 0])
    expect(gaussSolve(2, [{ coef: [1, 1], rhs: 1 }, { coef: [1, 1], rhs: 0 }])).toBeNull()
    expect(gaussSolve(1, [{ coef: [0], rhs: 1 }])).toBeNull()
  })

  it("the floor control re-derives exactly and consistently", () => {
    const control = floorControl()
    expect(control.rank).toBe(FLOOR_RANK)
    expect(control.hash).toBe(FLOOR_HASH)
    expect(control.mismatch).toBe(0)
    expect(control.independentMismatch).toBe(0)
    expect(control.f2Exact).toBe(true)
    expect(control.coefficientConsistent).toBe(true)
    expect(control.axis).toEqual({ u: true, v: true, w: true })
  })

  it("the known R100 ILS control re-derives INCONSISTENT", () => {
    const control = refutedControl()
    expect(control.rank).toBe(47)
    expect(control.campaignHash).toBe("6098903c")
    expect(control.mismatch).toBeGreaterThan(0)
    expect(control.independentMismatch).toBe(control.mismatch)
    expect(control.coefficientConsistent).toBe(false)
    expect(control.axis.u && control.axis.v && control.axis.w).toBe(false)
    expect(control.refuted).toBe(true)
  })

  it("floor F_2 mismatch agrees with the independent checker", () => {
    expect(mismatchF2(FLOOR)).toBe(0)
    expect(verifyExactIndependent(FLOOR)).toBe(0)
    const v = verifyMod2(masksToScheme(FLOOR))
    expect(v.correct).toBe(true)
    expect(v.mismatches).toBe(0)
  })
})

describe("R146_sym47 orbit bookkeeping", () => {
  it("admits a planted invariant rank-2 toy tensor (non-vacuity)", () => {
    const toy = toyAdmission()
    expect(toy.targetRank).toBe(2)
    expect(toy.orbitSignature).toEqual([2])
    expect(toy.invariant).toBe(true)
    expect(toy.admitted).toBe(true)
    expect(toy.f2Exact).toBe(true)
    expect(toy.singletonAdmitted).toBe(false)
  })

  it("partitions the C4 floor pool into whole orbits", () => {
    const pool = buildPool(FLOOR, GROUP_C4)
    const orbits = orbitPartition(pool, GROUP_C4)
    expect(pool.length).toBe(97)
    expect(orbits.length).toBe(28)
    expect(orbitSizeHistogram(orbits)).toEqual({ "1": 1, "2": 6, "4": 21 })
    let total = 0
    for (const o of orbits) {
      total += o.length
      expect(GROUP_C4.elements.length % o.length).toBe(0)
      for (const t of o) expect(isInvariant(o, GROUP_C4)).toBe(true)
    }
    expect(total).toBe(pool.length)
  })

  it("counts the S4 floor class as exactly zero (parity obstruction)", () => {
    const pool = buildPool(FLOOR, GROUP_S4)
    const orbits = orbitPartition(pool, GROUP_S4)
    const sizes = orbits.map((o) => o.length)
    expect(countOrbitSubsets(sizes, TARGET_RANK)).toBe(0n)
    expect(sampleOrbitSupports(orbits, TARGET_RANK, 8, 1)).toEqual([])
  })

  it("counts the C4 floor class exactly and samples invariant 47-term supports", () => {
    const orbits = orbitPartition(buildPool(FLOOR, GROUP_C4), GROUP_C4)
    const sizes = orbits.map((o) => o.length)
    expect(countOrbitSubsets(sizes, TARGET_RANK)).toBe(10_934_196n)
    const supports = sampleOrbitSupports(orbits, TARGET_RANK, 8, 146001)
    expect(supports.length).toBe(8)
    const hashes = new Set<string>()
    for (const support of supports) {
      expect(support.length).toBe(TARGET_RANK)
      expect(isInvariant(support, GROUP_C4)).toBe(true)
      const sig = orbitSignature(support, GROUP_C4)
      let sum = 0
      for (const s of sig) sum += s
      expect(sum).toBe(TARGET_RANK)
      hashes.add(hashSupport(support))
    }
    expect(hashes.size).toBe(8)
  })

  it("support hashes are order independent and stable", () => {
    const a: Mask[] = [
      [1, 2, 3],
      [4, 5, 6],
    ]
    const b: Mask[] = [
      [4, 5, 6],
      [1, 2, 3],
    ]
    expect(hashSupport(a)).toBe(hashSupport(b))
    expect(supportKey(a)).toBe(supportKey(b))
    expect(tripleKey([1, 2, 3])).toBe("1,2,3")
    expect(popcount(0b1011)).toBe(3)
  })

  it("per-axis consistency agrees with the support mismatch on the floor", () => {
    expect(axisConsistency(FLOOR)).toEqual({ u: true, v: true, w: true })
    expect(solveSupportCoeffs(FLOOR).consistent).toBe(true)
    // The 49-term floor is not itself an orbit union, so it is not admissible
    // as an invariant support; its orbits live in the closure pool instead.
    expect(isInvariant(FLOOR, GROUP_C4)).toBe(false)
    const closureOrbits = orbitPartition(buildPool(FLOOR, GROUP_C4), GROUP_C4)
    expect(solveOrbitCoeffs(closureOrbits).consistent).toBe(false)
  })
})

describe("R146_sym47 probe and honesty", () => {
  it("runs bounded with all controls verified and no fabricated witness", () => {
    const result = runProbe({ sampleLimit: 6, seed: 146001, write: false })
    expect(result.verified).toBe(true)
    expect(result.groups.length).toBe(3)
    expect(result.controls.obstruction).not.toBeNull()
    if (result.controls.obstruction !== null) {
      expect(result.controls.obstruction.want).not.toBe(result.controls.obstruction.got)
    }
    const bt = result.groups.find((g) => g.name === "BT-diagonal")
    expect(bt?.targetFixed).toBe(false)
    const enumerated = result.groups.reduce((n, g) => n + g.enumerated, 0)
    expect(result.rows.length).toBe(enumerated)
    expect(enumerated).toBeGreaterThan(0)
    for (const g of result.groups) {
      expect(g.exactSolved).toBe(g.enumerated)
      if (g.enumerated > 0) expect(g.fractionExactSolved).toBe(1)
    }
    for (const row of result.rows) {
      expect(row.invariant).toBe(true)
      expect(row.rank).toBe(TARGET_RANK)
      let sum = 0
      for (const s of row.orbitSignature) sum += s
      expect(sum).toBe(TARGET_RANK)
      expect(row.independentMismatch).toBe(row.allOnesMismatch)
      if (row.freeConsistent) {
        expect(row.freeF2Exact).toBe(true)
        expect(row.freeIntegerExact).toBe(true)
      }
      if (row.orbitConsistent) {
        expect(row.f2Exact).toBe(true)
        expect(row.integerExact).toBe(true)
        expect(row.includedRank).not.toBeNull()
      }
    }
    if (result.witness !== null) {
      const f2 = verifyMod2(result.witness.scheme)
      const intv = verify(result.witness.scheme)
      expect(f2.correct).toBe(true)
      expect(intv.correct).toBe(true)
      expect(result.witness.rank).toBeLessThanOrEqual(TARGET_RANK)
    } else {
      expect(result.witness).toBeNull()
    }
  })

  it("names the untouched classes instead of claiming closure", () => {
    const result = runProbe({ sampleLimit: 2, seed: 146002, write: false })
    expect(result.untouchedClasses.length).toBeGreaterThanOrEqual(6)
    expect(result.untouchedClasses.some((c) => c.includes("non-invariant"))).toBe(true)
    expect(result.untouchedClasses.some((c) => c.includes("BT-diagonal"))).toBe(true)
    expect(result.untouchedClasses.some((c) => c.includes("outside the probed seed orbit closure"))).toBe(true)
  })

  it("enumerates S4 samples while the tight floor-closure S4 class is exactly empty", () => {
    const result = runProbe({ sampleLimit: 4, seed: 146003, write: false })
    const s4 = result.groups.find((g) => g.name === "S4-diagonal")
    expect(s4).toBeDefined()
    if (s4 !== undefined) {
      expect(s4.floorClosureClassTotal).toBe("0")
      expect(BigInt(s4.classTotal)).toBeGreaterThan(0n)
      expect(s4.enumerated).toBeGreaterThan(0)
      expect(s4.exactSolved).toBe(s4.enumerated)
    }
    const c4 = result.groups.find((g) => g.name === "C4-diagonal")
    expect(c4?.floorClosureClassTotal).toBe("10934196")
  })

  it("does not export a scheme export (gate stays RED on a bounded null)", async () => {
    const mod = (await import("./R146_sym47")) as Record<string, unknown>
    expect("scheme" in mod).toBe(false)
  })
})
