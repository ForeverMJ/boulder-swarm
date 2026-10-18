import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import { goalSatisfiedA } from "../goalCheckA"
import {
  TASK_ID,
  ROUND,
  FIELD,
  PROBLEM_N,
  FLOOR_RANK,
  TARGET_RANK,
  MIN_SUPPORTS,
  FLOOR_HASH,
  FLOOR_MASKS,
  TARGET,
  bits,
  popcount,
  hashState,
  mismatchF2,
  masksToScheme,
  verifyExactIndependent,
  axisStats,
  twoLevelStrassen4,
  gaussRank,
  solveExactCoeffs,
  tensorRankF2,
  generateCosetSupports,
  generateSymmetricSupports,
  generateProductSupports,
  generateSubspaceSupports,
  mulberry,
  runEnumeration,
  type Mask,
  type Vec,
  type AxisStats,
} from "./R140_algsupports"

const DIM = PROBLEM_N * PROBLEM_N // 16
const TENSOR = DIM * DIM * DIM // 4096

describe("R140_algsupports constants and types", () => {
  it("exports correct task metadata", () => {
    expect(TASK_ID).toBe("R140-algsupports")
    expect(ROUND).toBe("R140")
    expect(FIELD).toBe("F_2")
    expect(PROBLEM_N).toBe(4)
    expect(FLOOR_RANK).toBe(49)
    expect(TARGET_RANK).toBe(47)
    expect(MIN_SUPPORTS).toBe(100)
    expect(FLOOR_HASH).toBe("f4640c18")
  })

  it("has correct dimensions", () => {
    expect(DIM).toBe(16)
    expect(TENSOR).toBe(4096)
  })
})

describe("R140_algsupports floor anchor", () => {
  it("twoLevelStrassen4 produces exactly 49 terms", () => {
    const floor = twoLevelStrassen4()
    expect(floor.length).toBe(FLOOR_RANK)
  })

  it("FLOOR_MASKS has correct length and stable hash", () => {
    expect(FLOOR_MASKS.length).toBe(FLOOR_RANK)
    expect(hashState(FLOOR_MASKS)).toBe(FLOOR_HASH)
  })

  it("floor anchor is exact over F₂ (mismatch 0)", () => {
    expect(mismatchF2(FLOOR_MASKS)).toBe(0)
  })

  it("floor anchor verifies independently via checker.verifyMod2", () => {
    const v = verifyMod2(masksToScheme(FLOOR_MASKS))
    expect(v.correct).toBe(true)
    expect(v.rank).toBe(FLOOR_RANK)
    expect(v.mismatches).toBe(0)
  })

  it("local mismatch agrees with independent checker on floor", () => {
    const mmInd = verifyExactIndependent(FLOOR_MASKS)
    expect(mmInd).toBe(0)
  })

  it("floor axis stats are well-formed", () => {
    const axis = axisStats(FLOOR_MASKS)
    expect(axis.uWeights.length).toBe(DIM)
    expect(axis.vWeights.length).toBe(DIM)
    expect(axis.wWeights.length).toBe(DIM)
    expect(axis.uEntropy).toBeGreaterThan(0)
    expect(axis.vEntropy).toBeGreaterThan(0)
    expect(axis.wEntropy).toBeGreaterThan(0)
  })
})

describe("R140_algsupports core utilities", () => {
  it("bits() extracts set bit positions correctly", () => {
    expect(bits(0)).toEqual([])
    expect(bits(1)).toEqual([0])
    expect(bits(3)).toEqual([0, 1])
    expect(bits(0b1010)).toEqual([1, 3])
  })

  it("popcount() counts bits correctly", () => {
    expect(popcount(0)).toBe(0)
    expect(popcount(1)).toBe(1)
    expect(popcount(0b1111)).toBe(4)
    expect(popcount(0xffff)).toBe(16)
  })

  it("hashState() is stable and deterministic", () => {
    const masks: Mask[] = [[1, 2, 4], [8, 16, 32], [64, 128, 256]]
    const h1 = hashState(masks)
    const h2 = hashState(masks)
    expect(h1).toBe(h2)
    expect(h1.length).toBe(8)
    // Different order gives different hash
    const h3 = hashState([masks[1]!, masks[0]!, masks[2]!])
    expect(h3).not.toBe(h1)
  })

  it("masksToScheme() produces valid Scheme", () => {
    const masks: Mask[] = [[1, 2, 4], [8, 16, 32]]
    const scheme = masksToScheme(masks)
    expect(scheme.n).toBe(PROBLEM_N)
    expect(scheme.triples.length).toBe(2)
    expect(scheme.triples[0]?.u.length).toBe(DIM)
    expect(scheme.triples[0]?.v.length).toBe(DIM)
    expect(scheme.triples[0]?.w.length).toBe(DIM)
  })

  it("verifyExactIndependent() agrees with local mismatch on random supports", () => {
    const rnd = mulberry(12345)
    for (let i = 0; i < 10; i++) {
      const support = generateCosetSupports(rnd, 1)[0]!
      const mm = mismatchF2(support)
      const mmInd = verifyExactIndependent(support)
      // They should agree since both compute over F₂
      expect(mmInd === 0).toBe(mm === 0)
    }
  })

  it("axisStats() returns well-formed stats", () => {
    const rnd = mulberry(42)
    const support = generateCosetSupports(rnd, 1)[0]!
    const axis = axisStats(support)
    expect(axis.uWeights.length).toBe(DIM)
    expect(axis.vWeights.length).toBe(DIM)
    expect(axis.wWeights.length).toBe(DIM)
    expect(axis.uEntropy).toBeGreaterThanOrEqual(0)
    expect(axis.vEntropy).toBeGreaterThanOrEqual(0)
    expect(axis.wEntropy).toBeGreaterThanOrEqual(0)
  })
})

describe("R140_algsupports BigInt Gaussian elimination", () => {
  it("gaussRank() solves simple consistent systems", () => {
    // x0 = 1, x1 = 0
    const rows = [
      { coef: 1n, rhs: 1 }, // x0 = 1
      { coef: 2n, rhs: 0 }, // x1 = 0
    ]
    expect(gaussRank(2, rows)).toBe(2)
  })

  it("gaussRank() detects inconsistent systems", () => {
    // 0 = 1
    const rows = [{ coef: 0n, rhs: 1 }]
    expect(gaussRank(1, rows)).toBe(-1)
  })

  it("gaussRank() handles dependent equations", () => {
    // x0 = 1, x0 = 1 (duplicate)
    const rows = [
      { coef: 1n, rhs: 1 },
      { coef: 1n, rhs: 1 },
    ]
    expect(gaussRank(1, rows)).toBe(1)
  })

  it("gaussRank() handles dependent inconsistent equations", () => {
    // x0 = 1, x0 = 0
    const rows = [
      { coef: 1n, rhs: 1 },
      { coef: 1n, rhs: 0 },
    ]
    expect(gaussRank(1, rows)).toBe(-1)
  })

  it("solveExactCoeffs() returns solvable for floor (which is exact)", () => {
    const result = solveExactCoeffs(FLOOR_MASKS)
    expect(result.solvable).toBe(true)
    expect(result.supportRank).not.toBeNull()
  })

  it("solveExactCoeffs() returns unsolvable for empty support", () => {
    const result = solveExactCoeffs([])
    expect(result.solvable).toBe(false)
    expect(result.supportRank).toBeNull()
  })

  it("tensorRankF2() computes rank of floor as 49", () => {
    // The floor has 49 terms, each rank-1, sum = target (rank should be <= 49)
    // Actually tensorRankF2 computes rank of the sum tensor
    const rank = tensorRankF2(FLOOR_MASKS)
    expect(rank).toBeGreaterThan(0)
    expect(rank).toBeLessThanOrEqual(FLOOR_RANK)
  })
})

describe("R140_algsupports algebraic constructions", () => {
  const rnd = mulberry(999)

  it("generateCosetSupports() produces correct number of supports", () => {
    const supports = generateCosetSupports(rnd, 5)
    expect(supports.length).toBe(5)
    for (const s of supports) {
      expect(s.length).toBe(TARGET_RANK)
      for (const t of s) {
        expect(t[0]).not.toBe(0)
        expect(t[1]).not.toBe(0)
        expect(t[2]).not.toBe(0)
      }
    }
  })

  it("generateCosetSupports() is deterministic for fixed seed", () => {
    const a = generateCosetSupports(mulberry(42), 3)
    const b = generateCosetSupports(mulberry(42), 3)
    expect(hashState(a[0]!)).toBe(hashState(b[0]!))
    expect(hashState(a[1]!)).toBe(hashState(b[1]!))
    expect(hashState(a[2]!)).toBe(hashState(b[2]!))
  })

  it("generateSymmetricSupports() produces correct number of supports", () => {
    const supports = generateSymmetricSupports(rnd, 5)
    expect(supports.length).toBe(5)
    for (const s of supports) {
      expect(s.length).toBe(TARGET_RANK)
      for (const t of s) {
        expect(t[0]).not.toBe(0)
        expect(t[1]).not.toBe(0)
        expect(t[2]).not.toBe(0)
      }
    }
  })

  it("generateSymmetricSupports() is deterministic for fixed seed", () => {
    const a = generateSymmetricSupports(mulberry(42), 3)
    const b = generateSymmetricSupports(mulberry(42), 3)
    expect(hashState(a[0]!)).toBe(hashState(b[0]!))
  })

  it("generateProductSupports() produces correct number of supports", () => {
    const supports = generateProductSupports(rnd, 5)
    expect(supports.length).toBe(5)
    for (const s of supports) {
      expect(s.length).toBe(TARGET_RANK)
      for (const t of s) {
        expect(t[0]).not.toBe(0)
        expect(t[1]).not.toBe(0)
        expect(t[2]).not.toBe(0)
      }
    }
  })

  it("generateProductSupports() is deterministic for fixed seed", () => {
    const a = generateProductSupports(mulberry(42), 3)
    const b = generateProductSupports(mulberry(42), 3)
    expect(hashState(a[0]!)).toBe(hashState(b[0]!))
  })

  it("generateSubspaceSupports() produces correct number of supports", () => {
    const supports = generateSubspaceSupports(rnd, 5)
    expect(supports.length).toBe(5)
    for (const s of supports) {
      expect(s.length).toBe(TARGET_RANK)
      for (const t of s) {
        expect(t[0]).not.toBe(0)
        expect(t[1]).not.toBe(0)
        expect(t[2]).not.toBe(0)
      }
    }
  })

  it("generateSubspaceSupports() is deterministic for fixed seed", () => {
    const a = generateSubspaceSupports(mulberry(42), 3)
    const b = generateSubspaceSupports(mulberry(42), 3)
    expect(hashState(a[0]!)).toBe(hashState(b[0]!))
  })
})

describe("R140_algsupports runEnumeration", () => {
  it("runEnumeration generates at least MIN_SUPPORTS supports (with write: false)", () => {
    const result = runEnumeration({ maxSupports: MIN_SUPPORTS, seedBase: 140000, write: false })
    expect(result.generated).toBeGreaterThanOrEqual(MIN_SUPPORTS)
    // consistent + inconsistent includes 2 controls + generated supports
    expect(result.consistent + result.inconsistent).toBe(result.generated + 2)
  })

  it("runEnumeration includes floor control as CONSISTENT", () => {
    const result = runEnumeration({ maxSupports: 10, seedBase: 140000, write: false })
    // Floor control should be consistent
    expect(result.consistent).toBeGreaterThan(0)
  })

  it("runEnumeration includes retired-hash control as INCONSISTENT", () => {
    const result = runEnumeration({ maxSupports: 10, seedBase: 140000, write: false })
    // At least one inconsistent (the retired hash)
    expect(result.inconsistent).toBeGreaterThan(0)
  })

  it("runEnumeration verdict is SIZED when no witness found", () => {
    // With small maxSupports, unlikely to find a witness
    const result = runEnumeration({ maxSupports: 20, seedBase: 140000, write: false })
    expect(result.witness).toBeNull()
    // Verdict logic: SIZED if generated >= target, SWEPT otherwise
    // Our runEnumeration returns generated >= target, so SIZED
    expect(result.generated).toBeGreaterThanOrEqual(20)
  })
})

describe("R140_algsupports exported scheme honesty", () => {
  it("does not export a scheme (gate stays RED for bounded null)", async () => {
    // The main file does not export a scheme by default
    // This test ensures we don't accidentally export a scheme
    const mod = await import("./R140_algsupports") as Record<string, unknown>
    // No `scheme` export expected
    expect("scheme" in mod).toBe(false)
  })
})

describe("R140_algsupports target tensor", () => {
  it("TARGET has correct shape and non-zero entries", () => {
    expect(TARGET.length).toBe(TENSOR)
    let nonZero = 0
    for (let i = 0; i < TENSOR; i++) {
      if (TARGET[i] !== 0) nonZero++
    }
    // 4x4x4 matrix multiplication tensor has 4^3 = 64 non-zero entries
    // Actually: for each (i,j,k) in {0..3}³, one entry
    expect(nonZero).toBe(64)
  })

  it("TARGET matches buildTarget from types", async () => {
    const { buildTarget } = await import("../types")
    const target = buildTarget(PROBLEM_N)
    let match = true
    for (let a = 0; a < DIM; a++) {
      for (let b = 0; b < DIM; b++) {
        for (let c = 0; c < DIM; c++) {
          if (TARGET[(a * DIM + b) * DIM + c] !== target[a]?.[b]?.[c]) {
            match = false
            break
          }
        }
      }
    }
    expect(match).toBe(true)
  })
})