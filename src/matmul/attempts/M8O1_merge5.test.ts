/**
 * M8-O1 merge5 — colocated judge for attempts/M8O1_merge5_search.ts.
 *
 * This test is the judge for the k >= 5 wide-merge land. It:
 *   - re-derives the exact-49 two-level Strassen floor from the 2x2 identities
 *     and pins its canonical hash f4640c18 against the independent M8-K1 audit;
 *   - re-enumerates the FULL k = 2..6 subset dictionary with the module and
 *     checks it reproduces M8-N1-mergeWide's landed k = 2,3,4 counts;
 *   - re-derives every committed candidate row's dim / rank-1-spanned / flatten
 *     lower bound / hash with an INDEPENDENT bigint implementation that shares
 *     no code with the module's word-based classifier;
 *   - exercises the rank-1 slice-space controls (duplicate cancels to zero;
 *     shared-(u,v) pair merges to rank 1) and their slice-exact recombination;
 *   - proves the merge lane is idempotent with resume-skip;
 *   - records an honest BOUNDED RED verdict: no k = 5/6 subset reaches rank
 *     <= k - 2, so no single merge makes the 49-term floor hit rank <= 47.
 *
 * Runtime is dominated by the k = 5 (~1.5s) and k = 6 (~12s) enumerations plus
 * the two cheap idempotency probes, comfortably inside the 60s harness window.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { verifyMod2 } from "../checker"
import { hashMasks as auditHashMasks, type Mask as AuditMask } from "./M8K1_audit"
import {
  mismatchF2,
  twoLevelStrassen4,
  verifyExactIndependent,
  masksToScheme,
  xorSlices,
  recombineTerms,
  termSlices,
  type Mask,
} from "./M8N1_mergeWide"
import * as lane from "./M8O1_merge5_search"
import {
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  M8N1_LANDED,
  MERGING_KS,
  NDJSON_PATH,
  PROBLEM_N,
  TARGET_RANK,
  TENSOR,
  VERDICT_BOUNDED,
  VERDICT_WITNESS,
  enumerateK,
  reproducesLanded,
  removablePairControls,
  bestSingleMergeTotal,
  runLane,
  readKeys,
  floorHash,
  classify,
  type KSummary,
} from "./M8O1_merge5_search"

/* --------------------------------------------------- independent re-derivation */

const N = PROBLEM_N
const D = N * N
const SIZE = D * D * D

function bitsInd(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < D; p++) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

function targetIndependent(): Uint8Array {
  const t = new Uint8Array(SIZE)
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      for (let k = 0; k < N; k++) {
        t[((i * N + j) * D + (j * N + k)) * D + (i * N + k)] = 1
      }
    }
  }
  return t
}

const WANT = targetIndependent()

/** Own target build + XOR accumulation, sharing no code with the module. */
function mismatchIndependent(masks: readonly Mask[]): number {
  const got = new Uint8Array(SIZE)
  for (const m of masks) {
    for (const a of bitsInd(m[0])) {
      for (const b of bitsInd(m[1])) {
        for (const c of bitsInd(m[2])) {
          const at = (a * D + b) * D + c
          got[at] = (got[at] ?? 0) ^ 1
        }
      }
    }
  }
  let mm = 0
  for (let i = 0; i < SIZE; i++) if ((got[i] ?? 0) !== (WANT[i] ?? 0)) mm += 1
  return mm
}

const FLOOR: readonly Mask[] = twoLevelStrassen4()

function slicesInd(t: Mask): bigint[] {
  const s = new Array<bigint>(D).fill(0n)
  for (const a of bitsInd(t[0])) {
    let m = 0n
    for (const b of bitsInd(t[1])) {
      for (const c of bitsInd(t[2])) m |= 1n << BigInt(b * D + c)
    }
    s[a] = m
  }
  return s
}

function xorSlicesInd(list: readonly (readonly bigint[])[]): bigint[] {
  const out = new Array<bigint>(D).fill(0n)
  for (const s of list) {
    for (let a = 0; a < D; a++) out[a] = (out[a] ?? 0n) ^ (s[a] ?? 0n)
  }
  return out
}

function rankRowsInd(rows: readonly number[], d: number): number {
  const r = [...rows]
  let rank = 0
  for (let col = 0; col < d; col++) {
    let sel = -1
    for (let i = rank; i < d; i++) {
      const row = r[i] ?? 0
      if (((row >>> col) & 1) === 1) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = r[rank] ?? 0
    r[rank] = r[sel] ?? 0
    r[sel] = tmp
    const pivot = r[rank] ?? 0
    for (let i = 0; i < d; i++) {
      if (i === rank) continue
      const row = r[i] ?? 0
      if (((row >>> col) & 1) === 1) r[i] = row ^ pivot
    }
    rank += 1
  }
  return rank
}

function rank16Ind(m: bigint): number {
  const rows: number[] = []
  for (let b = 0; b < D; b++) {
    let r = 0
    for (let c = 0; c < D; c++) if (((m >> BigInt(b * D + c)) & 1n) === 1n) r |= 1 << c
    rows.push(r)
  }
  return rankRowsInd(rows, D)
}

/** Row-echelon basis by highest set bit; own pivot strategy, no module helpers. */
function spanBasisInd(vs: readonly bigint[]): bigint[] {
  const rows = [...vs]
  let rank = 0
  for (let bit = 255; bit >= 0; bit--) {
    let sel = -1
    for (let i = rank; i < rows.length; i++) {
      const row = rows[i] ?? 0n
      if (((row >> BigInt(bit)) & 1n) === 1n) {
        sel = i
        break
      }
    }
    if (sel < 0) continue
    const tmp = rows[rank] ?? 0n
    rows[rank] = rows[sel] ?? 0n
    rows[sel] = tmp
    const pivot = rows[rank] ?? 0n
    for (let i = 0; i < rows.length; i++) {
      if (i === rank) continue
      const row = rows[i] ?? 0n
      if (((row >> BigInt(bit)) & 1n) === 1n) rows[i] = row ^ pivot
    }
    rank += 1
  }
  return rows.slice(0, rank)
}

/** Is the span enumerated by rank-1 elements? Exact: all 2^d - 1 combos. */
function rank1SpansInd(basis: readonly bigint[]): boolean {
  const d = basis.length
  if (d === 0) return true
  const coords: number[] = []
  const lim = 1 << d
  for (let mask = 1; mask < lim; mask++) {
    let m = 0n
    for (let j = 0; j < d; j++) if (((mask >> j) & 1) === 1) m ^= basis[j] ?? 0n
    if (rank16Ind(m) <= 1) coords.push(mask)
  }
  const piv = new Array<number>(d).fill(-1)
  let rank = 0
  for (const c of coords) {
    let x = c
    for (let b = 0; b < d; b++) {
      if (((x >> b) & 1) === 0) continue
      const p = piv[b] ?? -1
      if (p < 0) {
        piv[b] = x
        rank += 1
        break
      }
      x ^= p
    }
  }
  return rank === d
}

function termFlattenInd(t: Mask, mode: number): bigint[] {
  const out = new Array<bigint>(D).fill(0n)
  for (const a of bitsInd(t[0])) {
    for (const b of bitsInd(t[1])) {
      for (const c of bitsInd(t[2])) {
        const coord = [a, b, c]
        const fx = coord[mode] ?? 0
        const p = coord[(mode + 1) % 3] ?? 0
        const q = coord[(mode + 2) % 3] ?? 0
        out[fx] = (out[fx] ?? 0n) ^ (1n << BigInt(p * D + q))
      }
    }
  }
  return out
}

function flattenDimInd(terms: readonly Mask[], mode: number): number {
  const acc = new Array<bigint>(D).fill(0n)
  for (const t of terms) {
    const s = termFlattenInd(t, mode)
    for (let i = 0; i < D; i++) acc[i] = (acc[i] ?? 0n) ^ (s[i] ?? 0n)
  }
  return spanBasisInd(acc).length
}

type IndCert = {
  readonly dim: number
  readonly rank1Spanned: boolean
  readonly flattenMax: number
  readonly rank: number | null
  readonly rankLowerBound: number
  readonly reduced: boolean | null
  readonly certified: boolean
}

/** Independent certificate for a k-term sum, from its slice space. */
function certifyInd(terms: readonly Mask[]): IndCert {
  const k = terms.length
  const basis = spanBasisInd(xorSlicesInd(terms.map(slicesInd)))
  const dim = basis.length
  const rank1Spanned = dim < k ? rank1SpansInd(basis) : false
  let flattenMax = dim
  if (dim <= k - 2) {
    flattenMax = Math.max(
      dim,
      flattenDimInd(terms, 1),
      flattenDimInd(terms, 2),
    )
  }
  if (dim === 0) {
    return { dim, rank1Spanned, flattenMax, rank: 0, rankLowerBound: 0, reduced: true, certified: true }
  }
  if (dim === k) {
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  if (dim === k - 1) {
    if (rank1Spanned) {
      return { dim, rank1Spanned, flattenMax, rank: k - 1, rankLowerBound: k - 1, reduced: true, certified: true }
    }
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  if (rank1Spanned) {
    return { dim, rank1Spanned, flattenMax, rank: dim, rankLowerBound: dim, reduced: true, certified: true }
  }
  if (flattenMax >= k) {
    return { dim, rank1Spanned, flattenMax, rank: k, rankLowerBound: k, reduced: false, certified: true }
  }
  return {
    dim,
    rank1Spanned,
    flattenMax,
    rank: null,
    rankLowerBound: k - 1,
    reduced: null,
    certified: false,
  }
}

function binomial(n: number, k: number): number {
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

/* --------------------------------------------------- JSON / ndjson parsing */

type Json = Record<string, unknown>

function asRecord(value: unknown, where: string): Json {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${where}: expected object`)
  }
  return value as Json
}

function readNumber(value: unknown, where: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${where}: expected number`)
  }
  return value
}

function readString(value: unknown, where: string): string {
  if (typeof value !== "string") throw new Error(`${where}: expected string`)
  return value
}

function readMasks(value: unknown, where: string): Mask[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected mask array`)
  return value.map((entry, i) => {
    if (!Array.isArray(entry) || entry.length !== 3) throw new Error(`${where}[${i}]: bad tuple`)
    const [a, b, c] = entry
    if (typeof a !== "number" || typeof b !== "number" || typeof c !== "number") {
      throw new Error(`${where}[${i}]: bad field`)
    }
    return [a, b, c] as Mask
  })
}

function readIndices(value: unknown, where: string): number[] {
  if (!Array.isArray(value)) throw new Error(`${where}: expected index array`)
  return value.map((entry, i) => readNumber(entry, `${where}[${i}]`))
}

const ndjsonRaw = existsSync(NDJSON_PATH) ? readFileSync(NDJSON_PATH, "utf-8") : ""
const ndjsonRows: Json[] = ndjsonRaw
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line !== "")
  .map((line, i) => asRecord(JSON.parse(line), `ndjson[${i}]`))

const PER_K: readonly KSummary[] = MERGING_KS.map((k) => enumerateK(k))

function summaryOf(k: number): KSummary {
  const found = PER_K.find((s) => s.k === k)
  if (found === undefined) throw new Error(`missing summary for k=${k}`)
  return found
}

function rowByKey(key: string): Json {
  const found = ndjsonRows.find((row) => row["key"] === key)
  if (found === undefined) throw new Error(`missing ndjson row ${key}`)
  return found
}

/* --------------------------------------------------- floor anchor */

describe("exact-49 two-level Strassen floor", () => {
  it("rebuilds 49 exact rank-1 terms from the 2x2 identities", () => {
    expect(FLOOR).toHaveLength(FLOOR_RANK)
    expect(FLOOR).toHaveLength(49)
    expect(mismatchF2(FLOOR)).toBe(0)
    expect(mismatchIndependent(FLOOR)).toBe(0)
    expect(verifyExactIndependent(FLOOR)).toBe(0)
    expect(verifyMod2(masksToScheme(FLOOR)).correct).toBe(true)
    expect(lane.floorMasks()).toHaveLength(49)
  })

  it("matches the canonical campaign hash f4640c18 independently", () => {
    expect(FLOOR_HASH).toBe("f4640c18")
    expect(floorHash()).toBe(FLOOR_HASH)
    expect(auditHashMasks(FLOOR as readonly AuditMask[])).toBe(FLOOR_HASH)
  })
})

/* --------------------------------------------------- the merge dictionary */

describe("k-subset merge dictionary", () => {
  it("reproduces M8-N1-mergeWide's landed k = 2,3,4 counts", () => {
    const report = reproducesLanded()
    expect(report.ok).toBe(true)
    for (const row of report.rows) {
      expect(row.subsets).toBe(true)
      expect(row.dimHistogram).toBe(true)
      expect(row.reduced).toBe(true)
      expect(row.unresolved).toBe(true)
      expect(row.bestRank).toBe(true)
    }
    for (const k of [2, 3, 4]) {
      const landed = M8N1_LANDED[k]
      const fresh = summaryOf(k)
      if (landed === undefined) throw new Error(`missing landed k=${k}`)
      expect(fresh.subsets).toBe(landed.subsets)
      expect(fresh.subsets).toBe(binomial(FLOOR_RANK, k))
      expect(fresh.dimHistogram).toEqual(landed.dimHistogram)
      expect(fresh.merged).toBe(0)
      expect(fresh.unresolvedRank).toBe(0)
      expect(fresh.bestRank).toBe(k)
    }
  })

  it("finds no rank reduction anywhere in k = 2..6", () => {
    for (const s of PER_K) {
      expect(s.dimHistogram).toBeDefined()
      expect(s.rank1Spanned).toBe(0)
      expect(s.merged).toBe(0)
      expect(s.witnessEligible).toBe(0)
      // nothing reaches rank <= k - 2 (the only shape a witness can take)
      if (s.bestRank !== null) expect(s.bestRank).toBeGreaterThanOrEqual(s.k - 1)
      expect(s.bestLowerBound).toBeGreaterThanOrEqual(s.k - 1)
    }
  })

  it("pins the k = 5 and k = 6 dim histograms and sub-totals", () => {
    const k5 = summaryOf(5)
    expect(k5.subsets).toBe(binomial(49, 5))
    expect(k5.subsets).toBe(1906884)
    expect(k5.dimHistogram).toEqual({ "3": 123, "4": 49041, "5": 1857720 })
    expect(k5.unresolvedRank).toBe(42)
    expect(k5.resolvedByFlattening).toBe(81)
    expect(k5.bestRank).toBe(5)
    expect(k5.bestLowerBound).toBe(4)

    const k6 = summaryOf(6)
    expect(k6.subsets).toBe(binomial(49, 6))
    expect(k6.subsets).toBe(13983816)
    expect(k6.dimHistogram).toEqual({ "4": 7244, "5": 757452, "6": 13219120 })
    expect(k6.unresolvedRank).toBe(1862)
    expect(k6.resolvedByFlattening).toBe(5382)
    expect(k6.bestRank).toBe(6)
    expect(k6.bestLowerBound).toBe(5)
  })

  it("caps the best single merge at 48 terms (one above the target)", () => {
    expect(bestSingleMergeTotal(PER_K)).toBe(48)
    expect(bestSingleMergeTotal(PER_K)).toBeGreaterThan(TARGET_RANK)
  })
})

/* --------------------------------------------------- rank-1 controls */

describe("rank-1 slice-space controls", () => {
  it("cancels a duplicate pair to zero and merges a shared-(u,v) pair", () => {
    const f0 = FLOOR[0]
    if (f0 === undefined) throw new Error("floor too short")

    const zero = certifyInd([f0, f0])
    expect(zero).toEqual({
      dim: 0,
      rank1Spanned: true,
      flattenMax: 0,
      rank: 0,
      rankLowerBound: 0,
      reduced: true,
      certified: true,
    })
    expect(recombineTerms([f0, f0])).toEqual([])

    const a: Mask = [1, 1, 1]
    const b: Mask = [1, 1, 2]
    const pair = certifyInd([a, b])
    expect(pair.dim).toBe(1)
    expect(pair.rank1Spanned).toBe(true)
    expect(pair.rank).toBe(1)
    expect(pair.reduced).toBe(true)

    const rep = recombineTerms([a, b])
    if (rep === null) throw new Error("shared-uv recombination refused")
    expect(rep).toHaveLength(1)
    const left = xorSlices([a, b].map(termSlices))
    const right = xorSlices(rep.map(termSlices))
    for (let i = 0; i < D; i++) expect((left[i] ?? 0n) === (right[i] ?? 0n)).toBe(true)
  })

  it("reports the two removable-pair controls as merged and slice-exact", () => {
    const controls = removablePairControls()
    expect(controls).toHaveLength(2)
    for (const c of controls) {
      expect(c.reduced).toBe(true)
      expect(c.mergeExact).toBe(true)
    }
    const dup = controls.find((c) => c.name.includes("duplicate"))
    const uv = controls.find((c) => c.name.includes("shared-uv"))
    if (dup === undefined || uv === undefined) throw new Error("missing pair control")
    expect(dup.dim).toBe(0)
    expect(dup.replacementRank).toBe(0)
    expect(uv.dim).toBe(1)
    expect(uv.rank).toBe(1)
    expect(uv.replacementRank).toBe(1)
  })
})

/* --------------------------------------------------- module vs independent */

describe("module classifier cross-checks", () => {
  it("agrees with the independent certificate on sampled subsets", () => {
    const samples: number[][] = [
      [0, 1],
      [0, 1, 2],
      [0, 1, 2, 3],
      [0, 1, 2, 3, 4],
      [0, 1, 2, 3, 4, 5],
      [1, 3, 7, 11, 17],
      [2, 4, 8, 16, 32, 48],
    ]
    for (const indices of samples) {
      const terms = indices.map((i) => FLOOR[i] as Mask)
      const mine = classify(terms)
      const ind = certifyInd(terms)
      expect(mine.dim).toBe(ind.dim)
      expect(mine.rank1Spanned).toBe(ind.rank1Spanned)
      expect(mine.flattenMax).toBe(ind.flattenMax)
      expect(mine.rank).toBe(ind.rank)
      expect(mine.rankLowerBound).toBe(ind.rankLowerBound)
      expect(mine.reduced).toBe(ind.reduced)
      expect(mine.certified).toBe(ind.certified)
    }
    // control vectors match too
    for (const pair of [
      [FLOOR[0] as Mask, FLOOR[0] as Mask],
      [FLOOR[0] as Mask, FLOOR[1] as Mask],
      [[1, 1, 1] as Mask, [1, 1, 2] as Mask],
    ]) {
      const mine = classify(pair)
      const ind = certifyInd(pair)
      expect(mine.dim).toBe(ind.dim)
      expect(mine.rank).toBe(ind.rank)
      expect(mine.rank1Spanned).toBe(ind.rank1Spanned)
    }
  })
})

/* --------------------------------------------------- committed artifact */

describe("committed ndjson artifact", () => {
  it("exists with an exact-floor anchor row", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    expect(ndjsonRows.length).toBeGreaterThan(0)
    const anchor = rowByKey("anchor:floor")
    expect(anchor["kind"]).toBe("anchor")
    expect(anchor["taskId"]).toBe(lane.TASK_ID)
    expect(anchor["field"]).toBe(FIELD)
    expect(readNumber(anchor["rank"], "anchor.rank")).toBe(49)
    expect(readNumber(anchor["mm"], "anchor.mm")).toBe(0)
    expect(anchor["consistent"]).toBe(true)
    expect(readString(anchor["hash"], "anchor.hash")).toBe(FLOOR_HASH)
  })

  it("records the landed-count and removable-pair controls", () => {
    const landed = rowByKey("control:k234-landed")
    expect(landed["ok"]).toBe(true)
    const pair = rowByKey("control:removable-pairs")
    const pairs = pair["pairs"]
    if (!Array.isArray(pairs)) throw new Error("control:removable-pairs: expected array")
    expect(pairs).toHaveLength(2)
    for (const entry of pairs) {
      const rec = asRecord(entry, "pair control")
      expect(rec["reduced"]).toBe(true)
      expect(rec["mergeExact"]).toBe(true)
    }
  })

  it("re-derives every summary row against a fresh enumeration", () => {
    for (const s of PER_K) {
      const row = rowByKey(`summary:${s.k}`)
      expect(row["kind"]).toBe("merge-summary")
      expect(readNumber(row["subsets"], "summary.subsets")).toBe(s.subsets)
      expect(row["dimHistogram"]).toEqual(s.dimHistogram)
      expect(readNumber(row["rank1Spanned"], "summary.rank1Spanned")).toBe(s.rank1Spanned)
      expect(readNumber(row["merged"], "summary.merged")).toBe(s.merged)
      expect(readNumber(row["unresolvedRank"], "summary.unresolvedRank")).toBe(s.unresolvedRank)
      expect(readNumber(row["witnessEligible"], "summary.witnessEligible")).toBe(0)
      expect(readNumber(row["bestRank"], "summary.bestRank")).toBe(s.bestRank ?? -1)
    }
  })

  it("re-derives every committed candidate row from its masks", () => {
    const candidates = ndjsonRows.filter((row) => row["kind"] === "candidate")
    expect(candidates.length).toBeGreaterThan(0)
    for (const row of candidates) {
      const where = `candidate ${String(row["key"])}`
      expect(row["taskId"]).toBe(lane.TASK_ID)
      expect(row["field"]).toBe(FIELD)
      const k = readNumber(row["k"], `${where}.k`)
      const indices = readIndices(row["indices"], `${where}.indices`)
      const masks = readMasks(row["masks"], `${where}.masks`)
      expect(indices).toHaveLength(k)
      expect(masks).toEqual(indices.map((i) => FLOOR[i] as Mask))
      expect(readString(row["hash"], `${where}.hash`)).toBe(
        auditHashMasks(masks as readonly AuditMask[]),
      )
      const ind = certifyInd(masks)
      expect(readNumber(row["dim"], `${where}.dim`)).toBe(ind.dim)
      expect(row["rank1Spanned"]).toBe(ind.rank1Spanned)
      expect(readNumber(row["flattenMax"], `${where}.flattenMax`)).toBe(ind.flattenMax)
      expect(row["rank"]).toBe(ind.rank)
      expect(readNumber(row["rankLowerBound"], `${where}.rankLowerBound`)).toBe(ind.rankLowerBound)
      expect(row["reduced"]).toBe(ind.reduced)
      expect(row["certified"]).toBe(ind.certified)
    }
  })

  it("records an honest bounded RED verdict", () => {
    const row = rowByKey("verdict")
    expect(row["kind"]).toBe("verdict")
    expect(readString(row["verdict"], "verdict.verdict")).toBe(VERDICT_BOUNDED)
    expect(readNumber(row["witnesses"], "verdict.witnesses")).toBe(0)
    expect(readNumber(row["targetRank"], "verdict.targetRank")).toBe(TARGET_RANK)
    expect(readNumber(row["floorRank"], "verdict.floorRank")).toBe(FLOOR_RANK)
    expect(readString(row["floorHash"], "verdict.floorHash")).toBe(FLOOR_HASH)
    expect(row["mergingK"]).toEqual([2, 3, 4, 5, 6])
    expect(readNumber(row["bestSingleMergeTotal"], "verdict.bestSingleMergeTotal")).toBe(48)
    const perK = row["perK"]
    if (!Array.isArray(perK)) throw new Error("verdict.perK: expected array")
    expect(perK).toHaveLength(5)
    for (const entry of perK) {
      const rec = asRecord(entry, "verdict.perK entry")
      const k = readNumber(rec["k"], "verdict.perK.k")
      const s = summaryOf(k)
      expect(readNumber(rec["subsets"], "verdict.perK.subsets")).toBe(s.subsets)
      expect(rec["dimHistogram"]).toEqual(s.dimHistogram)
      expect(readNumber(rec["witnessEligible"], "verdict.perK.witnessEligible")).toBe(0)
    }
    expect(readString(row["residual"], "verdict.residual")).toContain("NOT a claim")
  })
})

/* --------------------------------------------------- resume-skip idempotency */

describe("idempotent appends with resume-skip", () => {
  it("appends a fresh probe once and skips it on a second pass", () => {
    const dir = mkdtempSync(join(tmpdir(), "m8o1-"))
    const sink = join(dir, "probe.ndjson")
    try {
      const first = runLane(sink, [2])
      const lines1 = readFileSync(sink, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "").length
      expect(lines1).toBeGreaterThan(0)
      expect(first.perK).toHaveLength(1)
      const second = runLane(sink, [2])
      const lines2 = readFileSync(sink, "utf-8")
        .split("\n")
        .filter((l) => l.trim() !== "").length
      expect(lines2).toBe(lines1)
      expect(second.perK).toHaveLength(1)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it("sees every committed row as an existing key", () => {
    const keys = readKeys(NDJSON_PATH)
    for (const row of ndjsonRows) {
      const key = row["key"]
      if (typeof key === "string") expect(keys.has(key)).toBe(true)
    }
    expect(keys.size).toBe(ndjsonRows.length)
  })
})

/* --------------------------------------------------- provenance / gate hygiene */

describe("gate and provenance hygiene", () => {
  it("does not export a scheme or import AlphaTensor data", () => {
    expect((lane as Record<string, unknown>)["scheme"]).toBeUndefined()
    const src = readFileSync(new URL("./M8O1_merge5_search.ts", import.meta.url), "utf-8")
    expect(src).toContain('export const FLOOR_HASH = "f4640c18"')
    expect(src).toContain('export const FIELD = "F_2"')
    expect(src).toContain("export const TARGET_RANK = 47")
    expect(src).not.toMatch(/^export\s+const\s+scheme\b/m)
    expect(src).not.toMatch(/from\s+["'][^"']*alphatensor/i)
    expect(src).not.toMatch(/require\(\s*["'][^"']*alphatensor/i)
  })

  it("pins the lane constants", () => {
    expect(FIELD).toBe("F_2")
    expect(TARGET_RANK).toBe(47)
    expect(FLOOR_RANK).toBe(49)
    expect(TENSOR).toBe(4096)
    expect(MERGING_KS).toEqual([2, 3, 4, 5, 6])
    expect(VERDICT_BOUNDED).toBe("BOUNDED-RED")
    expect(VERDICT_WITNESS).toBe("WITNESS-47-EXACT")
  })
})
