/**
 * M8-O1 non-floor support family — colocated judge for
 * attempts/M8O1_nonfloor_search.ts.
 *
 * Controls re-derived, not trusted: the untransformed floor is exact rank 49;
 * the identity basis change reproduces it bit-for-bit; every non-identity
 * invertible F_2 basis change is exact rank 49 with a DISTINCT support (the
 * orbit is genuine). The spec's literal pairing (u->T*u, v->T^-T*v) is
 * measured to leave the tensor (nonzero mismatch), which is why the exact
 * orbit uses u->u*T, v->T^-1*v, w fixed — the honest correction is pinned here.
 *
 * The exact-solve pass is exercised with known-answer controls and then run
 * over the whole window: every distinct rank<=47 candidate support is solved
 * on its fixed support, so unmatched is exactly 0. The committed ndjson
 * checkpoint must exist and be reproducible from the pure window (missing,
 * stale or inconsistent -> fail). Any closure claim (WITNESS) must be backed
 * by a CONSISTENT + integer-exact candidate; otherwise the measured outcome is
 * locked as BOUNDED-RED (a regression tripwire, not a proof).
 *
 * Runtime ~8s (dominated by the bounded drain), well inside the 60s window.
 */
import { readFileSync } from "node:fs"
import { describe, expect, it } from "bun:test"
import { verifyMod2 } from "../checker"
import {
  FLOOR_RANK,
  NDJSON,
  REPLICAS,
  TARGET_RANK,
  TRANSFORMS,
  basisOrbitTransform,
  boundedDrainToward47,
  checkpointRows,
  fnv,
  gaussSolve,
  invert4,
  leftMul,
  literalPairingMismatch,
  mismatchF2,
  mulberry,
  rightMul,
  runWindow,
  schemeOf,
  seedFloor,
  solveSupport,
  supportKey,
  type FT,
} from "./M8O1_nonfloor_search"

const WINDOW = runWindow()
const FLOOR = seedFloor()

function unit4(): number[][] {
  return Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => (r === c ? 1 : 0)))
}

describe("M8-O1 non-floor support family", () => {
  it("control: the untransformed floor is exact rank 49 over F_2", () => {
    expect(FLOOR.length).toBe(FLOOR_RANK)
    expect(mismatchF2(FLOOR)).toBe(0)
    expect(verifyMod2(schemeOf(FLOOR)).correct).toBe(true)
    expect(verifyMod2(schemeOf(FLOOR)).rank).toBe(FLOOR_RANK)
  })

  it("control: the identity basis change reproduces the floor", () => {
    expect(WINDOW.identityMatchesFloor).toBe(true)
    expect(WINDOW.identityHash).toBe(WINDOW.floorHash)
    expect(supportKey(basisOrbitTransform(FLOOR, unit4()))).toBe(supportKey(FLOOR))
  })

  it("control: every non-identity basis change is exact-49 with a distinct support", () => {
    expect(TRANSFORMS.length).toBe(7)
    expect(WINDOW.basisDistinctCount).toBe(TRANSFORMS.length)
    const floorKey = supportKey(FLOOR)
    const hashes = new Set<string>()
    for (const T of TRANSFORMS) {
      const start = basisOrbitTransform(FLOOR, T)
      expect(start.length).toBe(FLOOR_RANK)
      expect(mismatchF2(start)).toBe(0)
      expect(verifyMod2(schemeOf(start)).correct).toBe(true)
      expect(supportKey(start)).not.toBe(floorKey)
      hashes.add(fnv(start))
    }
    expect(hashes.size).toBe(TRANSFORMS.length)
    expect(hashes.has(WINDOW.floorHash)).toBe(false)
  })

  it("control: the literal spec pairing is not a symmetry (measured, not assumed)", () => {
    expect(WINDOW.literalMismatchSamples.length).toBe(3)
    for (const mm of WINDOW.literalMismatchSamples) expect(mm).toBeGreaterThan(0)
    for (const T of TRANSFORMS) expect(literalPairingMismatch(T)).toBeGreaterThan(0)
  })

  it("4x4 F_2 matrix algebra has known-answer controls", () => {
    const I = unit4()
    expect(invert4(I)).toEqual(I)
    expect(rightMul(0x1234, I)).toBe(0x1234)
    expect(leftMul(I, 0x1234)).toBe(0x1234)
    const singular = I.map((row) => [...row])
    const last = singular[3]
    if (last !== undefined) last[3] = 0
    expect(invert4(singular)).toBeNull()
    const T = TRANSFORMS[0]
    expect(T).toBeDefined()
    if (T !== undefined) {
      const Ti = invert4(T)
      expect(Ti).not.toBeNull()
      if (Ti !== null) {
        const back = rightMul(rightMul(0x0f0f, T), Ti)
        expect(back).toBe(0x0f0f)
      }
    }
  })

  it("exact-solve control: the floor support solves CONSISTENT", () => {
    const rep = solveSupport(FLOOR)
    expect(rep.consistent).toBe(true)
    expect(rep.mmAfter).toBe(0)
    expect(rep.intExact).toBe(false)
    expect(verifyMod2(schemeOf(rep.solved)).correct).toBe(true)
    for (const a of rep.perAxis) expect(a.ok).toBe(true)
  })

  it("exact-solve control: a dropped floor support is INCONSISTENT", () => {
    const dropped = FLOOR.slice(0, TARGET_RANK).map((t) => [t[0], t[1], t[2]] as FT)
    expect(dropped.length).toBe(TARGET_RANK)
    const rep = solveSupport(dropped)
    expect(rep.consistent).toBe(false)
    expect(rep.mmAfter).toBeGreaterThan(0)
    expect(rep.perAxis.length).toBeGreaterThan(0)
  })

  it("gaussSolve decides small F_2 systems exactly", () => {
    expect(
      gaussSolve(2, [
        { coef: [0b11], rhs: 1 },
        { coef: [0b01], rhs: 1 },
      ]),
    ).toEqual([1, 0])
    expect(
      gaussSolve(1, [
        { coef: [0b1], rhs: 0 },
        { coef: [0b1], rhs: 1 },
      ]),
    ).toBeNull()
  })

  it("drain is deterministic and lands on a rank<=47 targeted support", () => {
    const T = TRANSFORMS[0]
    expect(T).toBeDefined()
    if (T === undefined) return
    const start = basisOrbitTransform(FLOOR, T)
    const a = boundedDrainToward47(start, mulberry(1), 4)
    const b = boundedDrainToward47(start, mulberry(1), 4)
    expect(a.states.map(fnv)).toEqual(b.states.map(fnv))
    expect(a.states.length).toBeGreaterThan(0)
    for (const s of a.states) expect(s.length).toBeLessThanOrEqual(TARGET_RANK)
  })

  it("window: every rank<=47 candidate is exact-solved (unmatched = 0)", () => {
    expect(WINDOW.candidates.length).toBe(TRANSFORMS.length * REPLICAS)
    expect(WINDOW.queued).toBe(WINDOW.candidates.length)
    expect(WINDOW.solved).toBe(WINDOW.queued)
    expect(WINDOW.unmatched).toBe(0)
    for (const c of WINDOW.candidates) {
      expect(c.rank).toBeLessThanOrEqual(TARGET_RANK)
      expect(c.exact49).toBe(true)
      expect(c.startRank).toBe(FLOOR_RANK)
      expect(c.startMm).toBe(0)
      expect(c.distinctFromFloor).toBe(true)
      expect(c.solve.rank).toBe(c.rank)
      expect(c.solve.hash).toBe(c.hash)
      expect(c.solve.perAxis.length).toBeGreaterThan(0)
      expect(c.solve.solved.length).toBe(c.rank)
    }
  })

  it("honesty: no witness unless a CONSISTENT + integer-exact candidate exists", () => {
    const anyWitness = WINDOW.candidates.some((c) => c.solve.consistent && c.solve.intExact)
    expect(WINDOW.witness).toBe(anyWitness)
    if (anyWitness) {
      expect(WINDOW.verdict).toBe("WITNESS-RECORDED")
    } else {
      expect(WINDOW.verdict).toBe("BOUNDED-RED")
      expect(WINDOW.consistent).toBe(0)
    }
  })

  it("ndjson checkpoint exists, carries vec+hash rows, and is reproducible", () => {
    const raw = readFileSync(NDJSON, "utf8")
    expect(raw.toLowerCase().includes("alphatensor")).toBe(false)
    const lines = raw.split("\n").filter((l) => l.trim().length > 0)
    const reproduced = checkpointRows(WINDOW).map((r) => JSON.stringify(r))
    expect(lines).toEqual(reproduced)

    const rows = lines.map((l) => JSON.parse(l) as Record<string, unknown>)
    const kinds = new Set(rows.map((r) => r["kind"]))
    for (const k of ["start", "control", "candidate", "solve", "verdict", "summary"]) {
      expect(kinds.has(k)).toBe(true)
    }
    const controls = rows.filter((r) => r["kind"] === "control")
    expect(controls.find((r) => r["name"] === "floor-exact-49")?.["f2exact"]).toBe(true)
    expect(controls.find((r) => r["name"] === "identity-reproduces-floor")?.["matches"]).toBe(true)
    expect(controls.find((r) => r["name"] === "non-identity-distinct-support")?.["distinctCandidates"]).toBe(
      TRANSFORMS.length,
    )

    const candidates = rows.filter((r) => r["kind"] === "candidate")
    expect(candidates.length).toBe(WINDOW.candidates.length)
    for (const c of candidates) {
      expect(typeof c["hash"]).toBe("string")
      expect(c["rank"]).toBeLessThanOrEqual(TARGET_RANK)
      const vec = c["vec"] as number[][][]
      expect(vec.length).toBe(c["rank"] as number)
      for (const term of vec) {
        expect(term.length).toBe(3)
        for (const axis of term) {
          expect(axis.length).toBe(16)
          for (const bit of axis) expect(bit === 0 || bit === 1).toBe(true)
        }
      }
    }

    const solves = rows.filter((r) => r["kind"] === "solve")
    expect(solves.length).toBe(WINDOW.candidates.length * 3)
    const verdicts = rows.filter((r) => r["kind"] === "verdict")
    expect(verdicts.length).toBe(WINDOW.candidates.length)
    for (const v of verdicts) {
      expect(typeof v["consistent"]).toBe("boolean")
      expect(typeof v["mmBefore"]).toBe("number")
      expect(typeof v["mmAfter"]).toBe("number")
      if (v["consistent"] === true) expect(v["mmAfter"]).toBe(0)
    }

    const summary = rows.find((r) => r["kind"] === "summary")
    expect(summary?.["unmatched"]).toBe(0)
    expect(summary?.["queued"]).toBe(WINDOW.queued)
    expect(summary?.["verdict"]).toBe(WINDOW.verdict)
  })
})
