/**
 * M8-N1 mergeWide — colocated judge for attempts/M8N1_mergeWide.ts.
 *
 * Re-derives the exact-49 two-level Strassen floor from the 2x2 identities,
 * pins its canonical hash against the independent M8-K1 audit implementation,
 * re-derives every recorded slice space / rank / hash from the masks IN WINDOW,
 * exercises the exact-solver and merge-detector known-answer controls, proves
 * the synthetic rank-2 recombination is slice-exact, re-enumerates the full
 * k = 2, 3, 4 subset dictionary and checks every sampled boundary certificate
 * against an independent rank-1-basis enumeration, and fails if the committed
 * ndjson / json artifacts are missing, stale, or inconsistent.
 *
 * Runtime is dominated by the k = 4 enumeration (~8s wall-clock), well inside
 * the 60s harness window.
 */

import { describe, expect, it } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import { verifyMod2 } from "../checker"
import { hashMasks as auditHashMasks, type Mask as AuditMask } from "./M8K1_audit"
import * as mergeWide from "./M8N1_mergeWide"
import {
  FIELD,
  FLOOR_HASH,
  FLOOR_RANK,
  JSON_PATH,
  MERGING_KS,
  MERGE_CAP,
  NDJSON_PATH,
  SCHEME_PATH,
  TARGET_RANK,
  TENSOR,
  VERDICT_BOUNDED,
  axisStats,
  certifyMerge,
  decomposeMatrix,
  enumerateK,
  gf2Basis,
  hashState,
  hasRank1Basis,
  masksToScheme,
  mismatchF2,
  naiveTerms4,
  popcount,
  readKeys,
  recombineTerms,
  solveExact,
  termSlices,
  twoLevelStrassen4,
  verifyExactIndependent,
  xorSlices,
  type KSummary,
  type Mask,
} from "./M8N1_mergeWide"

/* --------------------------------------------------- independent re-derivation */

const N = 4
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

function slicesEqualInd(a: readonly bigint[], b: readonly bigint[]): boolean {
  for (let i = 0; i < D; i++) if ((a[i] ?? 0n) !== (b[i] ?? 0n)) return false
  return true
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

function invertibleInd(d: number): number[][] {
  const out: number[][] = []
  const total = 1 << (d * d)
  for (let m = 0; m < total; m++) {
    const rows: number[] = []
    for (let i = 0; i < d; i++) rows.push((m >>> (i * d)) & ((1 << d) - 1))
    if (rankRowsInd(rows, d) === d) out.push(rows)
  }
  return out
}

function hasRank1BasisInd(basis: readonly bigint[]): boolean {
  const d = basis.length
  if (d === 0) return true
  for (const g of invertibleInd(d)) {
    let all = true
    for (let i = 0; i < d; i++) {
      const row = g[i] ?? 0
      let m = 0n
      for (let j = 0; j < d; j++) if (((row >>> j) & 1) === 1) m ^= basis[j] ?? 0n
      if (rank16Ind(m) !== 1) {
        all = false
        break
      }
    }
    if (all) return true
  }
  return false
}

/** Independent rank certificate from the k-term sum's slice space. */
function certifyInd(terms: readonly Mask[]): { dim: number; rank: number | null } {
  const k = terms.length
  const basis = spanBasisInd(xorSlicesInd(terms.map(slicesInd)))
  const d = basis.length
  if (d === 0) return { dim: 0, rank: 0 }
  if (d === k) return { dim: d, rank: k }
  if (d === k - 1) return { dim: d, rank: hasRank1BasisInd(basis) ? k - 1 : k }
  if (d === 1) return { dim: 1, rank: rank16Ind(basis[0] ?? 0n) }
  return { dim: d, rank: null }
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

const jsonCert: Json = existsSync(JSON_PATH)
  ? asRecord(JSON.parse(readFileSync(JSON_PATH, "utf-8")), "certificate")
  : {}

const FLOOR = twoLevelStrassen4()
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
  })

  it("matches the canonical campaign hash f4640c18 independently", () => {
    expect(FLOOR_HASH).toBe("f4640c18")
    expect(hashState(FLOOR)).toBe(FLOOR_HASH)
    expect(auditHashMasks(FLOOR as readonly AuditMask[])).toBe(FLOOR_HASH)
  })

  it("derives the recorded axis profile from the masks", () => {
    const axis = axisStats(FLOOR)
    let u = 0
    let v = 0
    let w = 0
    for (const m of FLOOR) {
      u += popcount(m[0])
      v += popcount(m[1])
      w += popcount(m[2])
    }
    expect(axis).toEqual({ uBits: u, vBits: v, wBits: w })
    expect(u).toBeGreaterThan(0)
    expect(v).toBeGreaterThan(0)
    expect(w).toBeGreaterThan(0)
  })
})

/* --------------------------------------------------- slice-space rank theory */

describe("rank-1 slice-space certificate", () => {
  it("decides single terms, cancellation, and duplicate triples", () => {
    const f0 = FLOOR[0]
    const f1 = FLOOR[1]
    if (f0 === undefined || f1 === undefined) throw new Error("floor too short")

    expect(certifyMerge([f0])).toEqual({
      k: 1,
      dim: 1,
      rank: 1,
      reduced: false,
      certified: true,
    })
    expect(certifyInd([f0])).toEqual({ dim: 1, rank: 1 })

    expect(certifyMerge([f0, f0])).toEqual({
      k: 2,
      dim: 0,
      rank: 0,
      reduced: true,
      certified: true,
    })
    expect(recombineTerms([f0, f0])).toEqual([])

    expect(certifyMerge([f0, f0, f0])).toEqual({
      k: 3,
      dim: 1,
      rank: 1,
      reduced: true,
      certified: true,
    })
    expect(certifyInd([f0, f0, f0])).toEqual({ dim: 1, rank: 1 })
    const repTriple = recombineTerms([f0, f0, f0])
    if (repTriple === null) throw new Error("triple recombination refused")
    expect(repTriple).toHaveLength(1)
    expect(
      slicesEqualInd(xorSlices(repTriple.map(termSlices)), xorSlices([termSlices(f0)])),
    ).toBe(true)
  })

  it("refuses a rank reduction for an independent pair", () => {
    const f0 = FLOOR[0]
    const f1 = FLOOR[1]
    if (f0 === undefined || f1 === undefined) throw new Error("floor too short")
    expect(certifyMerge([f0, f1])).toEqual({
      k: 2,
      dim: 2,
      rank: 2,
      reduced: false,
      certified: true,
    })
    const basis = spanBasisInd(xorSlicesInd([slicesInd(f0), slicesInd(f1)]))
    expect(basis).toHaveLength(2)
    // dim W = k pins rank = k: even a rank-1 basis needs both terms.
    expect(hasRank1BasisInd(basis)).toBe(true)
    expect(recombineTerms([f0, f1])).toBeNull()
  })

  it("recombines the synthetic 3-term rank-2 sum exactly", () => {
    const a: Mask = [1, 1, 1]
    const b: Mask = [1, 2, 1]
    const c: Mask = [4, 1, 1]
    const cert = certifyMerge([a, b, c])
    expect(cert).toEqual({ k: 3, dim: 2, rank: 2, reduced: true, certified: true })
    expect(certifyInd([a, b, c])).toEqual({ dim: 2, rank: 2 })

    const rep = recombineTerms([a, b, c])
    if (rep === null) throw new Error("synthetic recombination refused")
    expect(rep).toHaveLength(2)
    expect(
      slicesEqualInd(xorSlices(rep.map(termSlices)), xorSlices([a, b, c].map(termSlices))),
    ).toBe(true)
    for (const term of rep) {
      const slices = termSlices(term)
      const nonzero = slices.filter((m) => m !== 0n)
      expect(nonzero.length).toBeGreaterThan(0)
      for (const m of nonzero) expect(rank16Ind(m)).toBe(1)
    }
  })

  it("decomposes rank-1 matrices consistently", () => {
    const f0 = FLOOR[0]
    if (f0 === undefined) throw new Error("floor too short")
    for (const a of bitsInd(f0[0])) {
      const slice = termSlices(f0)[a] ?? 0n
      expect(rank16Ind(slice)).toBe(1)
      const dec = decomposeMatrix(slice)
      expect(dec).toHaveLength(1)
      const [v, w] = dec[0] ?? [0, 0]
      let rebuilt = 0n
      for (const bb of bitsInd(v)) {
        for (const cc of bitsInd(w)) rebuilt |= 1n << BigInt(bb * D + cc)
      }
      expect(rebuilt).toBe(slice)
    }
    for (const a of [0, 1, 2]) {
      if (bitsInd(f0[0]).includes(a)) continue
      expect(termSlices(f0)[a]).toBe(0n)
    }
  })
})

/* --------------------------------------------------- exact coefficient solver */

describe("exact F_2 coefficient solver controls", () => {
  it("solves naive(4) at rank 64", () => {
    const naive = naiveTerms4()
    expect(naive).toHaveLength(64)
    expect(mismatchF2(naive)).toBe(0)
    expect(mismatchIndependent(naive)).toBe(0)
    expect(solveExact(naive)).toEqual({
      hash: hashState(naive),
      rank: 64,
      solvable: true,
      supportRank: 64,
    })
  })

  it("solves the exact-49 floor in its own span", () => {
    const solved = solveExact(FLOOR)
    expect(solved.rank).toBe(49)
    expect(solved.solvable).toBe(true)
    expect(solved.supportRank).toBe(49)
    expect(solved.hash).toBe(FLOOR_HASH)
  })

  it("refuses a 47-term truncation of naive(4)", () => {
    const trunc = naiveTerms4().slice(0, TARGET_RANK)
    expect(trunc).toHaveLength(47)
    const solved = solveExact(trunc)
    expect(solved.rank).toBe(47)
    expect(solved.solvable).toBe(false)
    expect(solved.supportRank).toBeNull()
  })

  it("refuses supports above the merge cap", () => {
    const over = [...naiveTerms4(), [1, 1, 1] as Mask]
    expect(over).toHaveLength(MERGE_CAP + 1)
    const solved = solveExact(over)
    expect(solved.rank).toBe(MERGE_CAP + 1)
    expect(solved.solvable).toBe(false)
    expect(solved.supportRank).toBeNull()
  })
})

/* --------------------------------------------------- exhaustive dictionary */

describe("exhaustive k-subset dictionary (k = 2, 3, 4)", () => {
  it("covers every 2-subset with no reduction", () => {
    const s = summaryOf(2)
    expect(s.subsets).toBe(binomial(49, 2))
    expect(s.subsets).toBe(1176)
    expect(s.dimHistogram).toEqual({ "2": 1176 })
    expect(s.reduced).toBe(0)
    expect(s.certified).toBe(1176)
    expect(s.unresolved).toBe(0)
    expect(s.bestRank).toBe(2)
    expect(s.reducedRows).toHaveLength(0)
  })

  it("covers every 3-subset with no reduction", () => {
    const s = summaryOf(3)
    expect(s.subsets).toBe(binomial(49, 3))
    expect(s.subsets).toBe(18424)
    expect(s.dimHistogram).toEqual({ "2": 42, "3": 18382 })
    expect(s.reduced).toBe(0)
    expect(s.certified).toBe(18424)
    expect(s.unresolved).toBe(0)
    expect(s.bestRank).toBe(3)
    expect(s.reducedRows).toHaveLength(0)
  })

  it("covers every 4-subset with no reduction", () => {
    const s = summaryOf(4)
    expect(s.subsets).toBe(binomial(49, 4))
    expect(s.subsets).toBe(211876)
    expect(s.dimHistogram).toEqual({ "3": 2055, "4": 209821 })
    expect(s.reduced).toBe(0)
    expect(s.certified).toBe(211876)
    expect(s.unresolved).toBe(0)
    expect(s.bestRank).toBe(4)
    expect(s.reducedRows).toHaveLength(0)
  })

  it("re-certifies every sampled head and boundary row independently", () => {
    for (const s of PER_K) {
      expect(s.certified + s.unresolved).toBe(s.subsets)
      for (const row of [...s.head, ...s.boundary]) {
        expect(row.k).toBe(s.k)
        expect(row.indices).toHaveLength(s.k)
        expect(row.indices).toEqual([...row.indices].sort((x, y) => x - y))
        expect(new Set(row.indices).size).toBe(s.k)
        for (const i of row.indices) {
          expect(i).toBeGreaterThanOrEqual(0)
          expect(i).toBeLessThan(FLOOR_RANK)
        }
        expect(row.masks).toEqual(row.indices.map((i) => FLOOR[i] as Mask))
        expect(row.hash).toBe(auditHashMasks(row.masks as readonly AuditMask[]))
        expect(row.hash).toBe(hashState(row.masks))
        expect(row.certified).toBe(true)
        expect(row.rank).toBe(s.k)
        expect(row.reduced).toBe(false)
        const ind = certifyInd(row.masks)
        expect(ind.dim).toBe(row.dim)
        expect(ind.rank).toBe(row.rank)
        expect(recombineTerms(row.masks)).toBeNull()
      }
      for (const row of s.head) expect([s.k - 1, s.k]).toContain(row.dim)
      for (const row of s.boundary) {
        expect(row.dim).toBe(s.k - 1)
        expect(hasRank1Basis(gf2Basis(xorSlices(row.masks.map(termSlices))).basis)).toBe(false)
      }
    }
  })
})

/* --------------------------------------------------- artifacts */

describe("committed artifacts", () => {
  it("exists and is non-empty", () => {
    expect(existsSync(NDJSON_PATH)).toBe(true)
    expect(existsSync(JSON_PATH)).toBe(true)
    expect(ndjsonRows.length).toBeGreaterThan(70)
    expect(ndjsonRaw.endsWith("\n")).toBe(true)
  })

  it("uses unique keys covering exactly the deterministic lane output", () => {
    expect(ndjsonRows).toHaveLength(readKeys(NDJSON_PATH).size)
    const expected = new Set<string>([
      "anchor:floor",
      "control:naive64",
      "control:floor49",
      "control:trunc47",
      "control:merge-detector",
      "summary:2",
      "summary:3",
      "summary:4",
      "verdict",
    ])
    for (const s of PER_K) {
      for (const row of [...s.reducedRows, ...s.boundary, ...s.head]) {
        expected.add(`cand:${s.k}:${row.indices.join("-")}`)
      }
    }
    expect([...readKeys(NDJSON_PATH)].sort()).toEqual([...expected].sort())
  })

  it("re-derives the anchor row from its recorded masks", () => {
    const row = rowByKey("anchor:floor")
    expect(row["kind"]).toBe("anchor")
    expect(row["taskId"]).toBe("M8-N1-mergeWide")
    expect(row["round"]).toBe("M8-N1")
    expect(row["field"]).toBe(FIELD)
    const masks = readMasks(row["masks"], "anchor.masks")
    expect(masks).toHaveLength(49)
    expect(readNumber(row["rank"], "anchor.rank")).toBe(49)
    expect(readNumber(row["mm"], "anchor.mm")).toBe(0)
    expect(readNumber(row["mismatches"], "anchor.mismatches")).toBe(0)
    expect(readNumber(row["mmIndependent"], "anchor.mmIndependent")).toBe(0)
    expect(row["consistent"]).toBe(true)
    expect(readString(row["hash"], "anchor.hash")).toBe(FLOOR_HASH)
    expect(mismatchIndependent(masks)).toBe(0)
    expect(auditHashMasks(masks as readonly AuditMask[])).toBe(FLOOR_HASH)
    expect(verifyMod2(masksToScheme(masks)).correct).toBe(true)
  })

  it("re-derives the known-answer controls", () => {
    const naive = rowByKey("control:naive64")
    expect(readNumber(naive["rank"], "naive.rank")).toBe(64)
    expect(readNumber(naive["mm"], "naive.mm")).toBe(0)
    expect(naive["solvable"]).toBe(true)
    expect(readNumber(naive["supportRank"], "naive.supportRank")).toBe(64)

    const floor = rowByKey("control:floor49")
    expect(readNumber(floor["rank"], "floor.rank")).toBe(49)
    expect(floor["solvable"]).toBe(true)
    expect(readNumber(floor["supportRank"], "floor.supportRank")).toBe(49)

    const trunc = rowByKey("control:trunc47")
    expect(readNumber(trunc["rank"], "trunc.rank")).toBe(47)
    expect(trunc["solvable"]).toBe(false)
    expect(trunc["supportRank"]).toBeNull()

    const detector = rowByKey("control:merge-detector")
    const entries = detector["detector"]
    if (!Array.isArray(entries)) throw new Error("detector: expected array")
    expect(entries).toHaveLength(5)
    const byName = new Map<string, Json>()
    for (const entry of entries) {
      const rec = asRecord(entry, "detector entry")
      byName.set(readString(rec["name"], "detector.name"), rec)
    }
    const single = byName.get("single-term-rank1")
    if (single === undefined) throw new Error("missing single-term control")
    expect(readNumber(single["dim"], "single.dim")).toBe(1)
    expect(readNumber(single["rank"], "single.rank")).toBe(1)
    expect(single["reduced"]).toBe(false)

    const zero = byName.get("duplicate-cancels-to-zero")
    if (zero === undefined) throw new Error("missing duplicate control")
    expect(readNumber(zero["dim"], "zero.dim")).toBe(0)
    expect(zero["replacementExact"]).toBe(true)

    const triple = byName.get("triple-duplicate-is-rank1")
    if (triple === undefined) throw new Error("missing triple control")
    expect(readNumber(triple["rank"], "triple.rank")).toBe(1)
    expect(readNumber(triple["replacementRank"], "triple.replacementRank")).toBe(1)
    expect(triple["replacementExact"]).toBe(true)

    const pair = byName.get("independent-pair-is-rank2")
    if (pair === undefined) throw new Error("missing pair control")
    expect(readNumber(pair["dim"], "pair.dim")).toBe(2)
    expect(readNumber(pair["rank"], "pair.rank")).toBe(2)
    expect(pair["reduced"]).toBe(false)
    expect(pair["replacementRank"]).toBeNull()

    const synth = byName.get("synthetic-rank2-from-3-terms")
    if (synth === undefined) throw new Error("missing synthetic control")
    expect(readNumber(synth["dim"], "synth.dim")).toBe(2)
    expect(readNumber(synth["rank"], "synth.rank")).toBe(2)
    expect(readNumber(synth["replacementRank"], "synth.replacementRank")).toBe(2)
    expect(synth["replacementExact"]).toBe(true)
  })

  it("matches every summary row against a fresh enumeration", () => {
    for (const s of PER_K) {
      const row = rowByKey(`summary:${s.k}`)
      expect(row["kind"]).toBe("merge-summary")
      expect(row["field"]).toBe(FIELD)
      expect(readNumber(row["subsets"], "summary.subsets")).toBe(s.subsets)
      expect(row["dimHistogram"]).toEqual(s.dimHistogram)
      expect(readNumber(row["reduced"], "summary.reduced")).toBe(s.reduced)
      expect(readNumber(row["certified"], "summary.certified")).toBe(s.certified)
      expect(readNumber(row["unresolved"], "summary.unresolved")).toBe(s.unresolved)
      expect(readNumber(row["bestRank"], "summary.bestRank")).toBe(s.bestRank ?? -1)
      expect(s.reduced).toBe(0)
    }
  })

  it("re-derives every candidate row from its masks and indices", () => {
    const candidates = ndjsonRows.filter((row) => row["kind"] === "candidate")
    expect(candidates.length).toBeGreaterThan(0)
    for (const row of candidates) {
      const where = `candidate ${String(row["key"])}`
      expect(row["taskId"]).toBe("M8-N1-mergeWide")
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
      expect(readNumber(row["rank"], `${where}.rank`)).toBe(ind.rank ?? -1)
      expect(row["reduced"]).toBe(false)
      expect(row["certified"]).toBe(true)
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
    expect(row["mergingK"]).toEqual([2, 3, 4])
    const perK = row["perK"]
    if (!Array.isArray(perK)) throw new Error("verdict.perK: expected array")
    expect(perK).toHaveLength(3)
    for (const entry of perK) {
      const rec = asRecord(entry, "verdict.perK entry")
      const k = readNumber(rec["k"], "verdict.perK.k")
      const s = summaryOf(k)
      expect(readNumber(rec["subsets"], "verdict.perK.subsets")).toBe(s.subsets)
      expect(readNumber(rec["reduced"], "verdict.perK.reduced")).toBe(0)
      expect(readNumber(rec["unresolved"], "verdict.perK.unresolved")).toBe(0)
      expect(readNumber(rec["bestRank"], "verdict.perK.bestRank")).toBe(s.bestRank ?? -1)
    }
  })

  it("commits a consistent JSON certificate", () => {
    expect(jsonCert["taskId"]).toBe("M8-N1-mergeWide")
    expect(jsonCert["round"]).toBe("M8-N1")
    expect(jsonCert["field"]).toBe(FIELD)
    expect(readNumber(jsonCert["targetRank"], "cert.targetRank")).toBe(TARGET_RANK)
    expect(readNumber(jsonCert["floorRank"], "cert.floorRank")).toBe(FLOOR_RANK)
    expect(readString(jsonCert["floorHash"], "cert.floorHash")).toBe(FLOOR_HASH)
    expect(jsonCert["mergingK"]).toEqual([2, 3, 4])
    expect(readString(jsonCert["verdict"], "cert.verdict")).toBe(VERDICT_BOUNDED)
    expect(readNumber(jsonCert["witnesses"], "cert.witnesses")).toBe(0)
    expect(readString(jsonCert["ndjson"], "cert.ndjson")).toBe("M8N1_mergeWide.ndjson")

    const perK = jsonCert["perK"]
    if (!Array.isArray(perK)) throw new Error("cert.perK: expected array")
    expect(perK).toHaveLength(3)
    for (const entry of perK) {
      const rec = asRecord(entry, "cert.perK entry")
      const k = readNumber(rec["k"], "cert.perK.k")
      const s = summaryOf(k)
      expect(readNumber(rec["subsets"], "cert.perK.subsets")).toBe(s.subsets)
      expect(rec["dimHistogram"]).toEqual(s.dimHistogram)
      expect(readNumber(rec["reduced"], "cert.perK.reduced")).toBe(0)
      expect(readNumber(rec["certified"], "cert.perK.certified")).toBe(s.certified)
      expect(readNumber(rec["unresolved"], "cert.perK.unresolved")).toBe(0)
      expect(readNumber(rec["bestRank"], "cert.perK.bestRank")).toBe(s.bestRank ?? -1)
    }

    const controls = asRecord(jsonCert["controls"], "cert.controls")
    expect(controls["floorHash"]).toBe(FLOOR_HASH)
    expect(readNumber(controls["floorRank"], "cert.controls.floorRank")).toBe(49)
    expect(readNumber(controls["floorMm"], "cert.controls.floorMm")).toBe(0)
    expect(controls["floorSolvable"]).toBe(true)
    expect(readNumber(controls["floorSupportRank"], "cert.controls.floorSupportRank")).toBe(49)
    expect(readNumber(controls["naiveRank"], "cert.controls.naiveRank")).toBe(64)
    expect(readNumber(controls["naiveMm"], "cert.controls.naiveMm")).toBe(0)
    expect(controls["naiveSolvable"]).toBe(true)
    expect(readNumber(controls["trunc47Rank"], "cert.controls.trunc47Rank")).toBe(47)
    expect(controls["trunc47Solvable"]).toBe(false)
    expect(controls["detector"]).toHaveLength(5)

    const generatedAt = readString(jsonCert["generatedAt"], "cert.generatedAt")
    expect(Number.isNaN(Date.parse(generatedAt))).toBe(false)
    expect(readString(jsonCert["statement"], "cert.statement")).toContain("no rank<=47 witness")
    expect(readString(jsonCert["residual"], "cert.residual")).toContain(
      "NOT a claim of impossibility",
    )
  })

  it("writes no scheme module on a bounded red", () => {
    expect(existsSync(SCHEME_PATH)).toBe(false)
  })
})

/* --------------------------------------------------- gate + provenance hygiene */

describe("gate and provenance hygiene", () => {
  it("does not export a scheme or import AlphaTensor data", () => {
    expect((mergeWide as Record<string, unknown>)["scheme"]).toBeUndefined()
    const src = readFileSync(new URL("./M8N1_mergeWide.ts", import.meta.url), "utf-8")
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
    expect(MERGING_KS).toEqual([2, 3, 4])
    expect(MERGE_CAP).toBe(64)
    expect(VERDICT_BOUNDED).toBe("BOUNDED-RED")
  })
})
