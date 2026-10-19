/**
 * Colocated judge for M8-U1-band8c.
 *
 * It re-derives the k=8 partition rule from an independent naive flattening-rank
 * oracle, pins the module's classification to M8T1_band8's `mode1RankByIndices`
 * on a sample, reconciles the claimed partition against the landed
 * M8T1_band8.json, exercises the identity ledger end to end on a bounded run
 * into a temp dir, pins the honesty invariant (an unsnapped row is never
 * refuted), and — when the full-run artifacts exist — streams the real ledger
 * and verifies its identities.
 */
import { describe, expect, it } from "bun:test"
import { createReadStream, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"
import { verifyMod2 } from "../checker"
import type { Scheme } from "../types"
import { combCount, witnessMatches } from "./M8S1_band7"
import {
  KNOWN_REFUTE_ROWS,
  PLANTED_ADMIT_TERMS,
  buildScheme,
  masksToScheme,
  mode1RankByIndices,
} from "./M8T1_band8"
import {
  ADD_BUDGET,
  EXPECTED_REFUTES,
  EXPECTED_TOTAL,
  EXPECTED_UNRESOLVED,
  JSON_PATH,
  K,
  NDJSON_PATH,
  SCHEME_PATH,
  TASK_ID,
  classifyIndices,
  disposition,
  finalLine,
  main,
  parseArgs,
  postSolveIndices,
  runControls,
  sweepBand8U,
} from "./M8U1_band8c"
import type { RowClass } from "./M8U1_band8c"
import { FLOOR_RANK, TARGET_RANK } from "./R137_49band"
import type { Mask } from "./R137_49band"
import {
  BAND8_JSON_PATH,
  exactAxisRankIndices,
  exactMode1Rank,
  readBand8Counts,
  resolveTerms,
  termsOfIndices,
} from "./R143_band8c"

const HERE = dirname(fileURLToPath(import.meta.url))
const NB = 16

function bitsOf(mask: number): number[] {
  const out: number[] = []
  for (let p = 0; p < NB; p += 1) if (((mask >>> p) & 1) === 1) out.push(p)
  return out
}

function permute(axis: 0 | 1 | 2, t: Mask): readonly [number, number, number] {
  if (axis === 0) return [t[0], t[1], t[2]]
  if (axis === 1) return [t[1], t[0], t[2]]
  return [t[2], t[0], t[1]]
}

/** Independent exact mode-`axis` flattening rank (naive 16x256 Gauss elimination). */
function naiveAxisRank(terms: readonly Mask[], axis: 0 | 1 | 2): number {
  const rows: Uint8Array[] = Array.from({ length: NB }, () => new Uint8Array(NB * NB))
  for (const t of terms) {
    const [la, lb, lc] = permute(axis, t)
    for (const a of bitsOf(la)) {
      const row = rows[a]
      if (row === undefined) continue
      for (const b of bitsOf(lb)) {
        for (const c of bitsOf(lc)) {
          const at = b * NB + c
          row[at] = (row[at] ?? 0) ^ 1
        }
      }
    }
  }
  const basis: Uint8Array[] = []
  const pivots: number[] = []
  let rank = 0
  for (const src of rows) {
    const cur = src.slice()
    for (let k = 0; k < basis.length; k += 1) {
      const bk = basis[k]
      const pk = pivots[k]
      if (bk === undefined || pk === undefined) continue
      if ((cur[pk] ?? 0) === 1) {
        for (let i = 0; i < cur.length; i += 1) cur[i] = (cur[i] ?? 0) ^ (bk[i] ?? 0)
      }
    }
    let piv = -1
    for (let i = 0; i < cur.length; i += 1) {
      if ((cur[i] ?? 0) === 1) {
        piv = i
        break
      }
    }
    if (piv < 0) continue
    basis.push(cur)
    pivots.push(piv)
    rank += 1
  }
  return rank
}

function lcg(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function randomSubset(rand: () => number, k: number, n: number): number[] {
  const pool = Array.from({ length: n }, (_, i) => i)
  for (let i = 0; i < k; i += 1) {
    const j = i + Math.floor(rand() * (n - i))
    const tmp = pool[i] ?? 0
    pool[i] = pool[j] ?? 0
    pool[j] = tmp
  }
  return pool.slice(0, k).sort((a, b) => a - b)
}

function nextComb(idxs: number[], k: number, n: number): boolean {
  let i = k - 1
  while (i >= 0 && (idxs[i] ?? 0) === n - k + i) i -= 1
  if (i < 0) return false
  idxs[i] = (idxs[i] ?? 0) + 1
  for (let j = i + 1; j < k; j += 1) idxs[j] = (idxs[j - 1] ?? 0) + 1
  return true
}

describe("M8-U1-band8c controls", () => {
  it("re-derives the floor and passes the three gating controls", () => {
    const controls = runControls()
    expect(controls.allOk).toBe(true)
    expect(controls.floor.ok).toBe(true)
    expect(controls.floor.terms).toBe(49)
    expect(controls.floor.hash).toBe("f4640c18")
    expect(controls.floor.mismatchF2).toBe(0)
    expect(controls.plantedAdmit.ok).toBe(true)
    expect(controls.plantedAdmit.verdict).toBe("SNAPPED")
    expect(controls.plantedAdmit.terms).toBeLessThanOrEqual(controls.plantedAdmit.budget)
    expect(controls.knownRefute.length).toBe(KNOWN_REFUTE_ROWS.length)
    for (const row of controls.knownRefute) {
      expect(row.ok).toBe(true)
      expect(row.verdict).toBe("REFUTED")
    }
  })

  it("pins the two known-REFUTE k=6 sets by hash and rank", () => {
    const controls = runControls()
    const wantHashes = new Set(["fa885c4f", "c9a0e9e6"])
    expect(controls.knownRefute.length).toBe(2)
    for (const row of controls.knownRefute) {
      expect(row.dropIndices.length).toBe(6)
      expect(wantHashes.has(row.hash)).toBe(true)
      expect(row.hash).toBe(row.expectedHash)
      expect(row.mode1Rank).toBeGreaterThan(row.dropIndices.length - 2)
      expect(row.verdict).toBe("REFUTED")
    }
  })
})

describe("M8-U1-band8c classification", () => {
  it("equals mode1RankByIndices(idxs, 8) > 6 exactly on a sample", () => {
    const rand = lcg(0x5eed)
    const rows: number[][] = [
      [0, 1, 2, 3, 4, 5, 6, 7],
      [41, 42, 43, 44, 45, 46, 47, 48],
      [0, 1, 2, 3, 4, 7, 20, 30],
    ]
    for (const r of KNOWN_REFUTE_ROWS) rows.push([...r.dropIndices])
    for (let i = 0; i < 300; i += 1) rows.push(randomSubset(rand, K, FLOOR_RANK))

    for (const idxs of rows) {
      const band8 = mode1RankByIndices(idxs, idxs.length)
      const expected: RowClass = band8 > idxs.length - 2 ? "REFUTE" : "CANDIDATE"
      expect(classifyIndices(idxs, idxs.length)).toBe(expected)
      const shortCircuit =
        exactMode1Rank(idxs, idxs.length, idxs.length - 2) > idxs.length - 2
          ? "REFUTE"
          : "CANDIDATE"
      expect(classifyIndices(idxs, idxs.length)).toBe(shortCircuit)
      expect(band8).toBe(naiveAxisRank(termsOfIndices(idxs), 0))
    }
  })

  it("agrees with the three-axis naive oracle on candidate post-solve", () => {
    const rand = lcg(0xbeef)
    for (let i = 0; i < 120; i += 1) {
      const idxs = randomSubset(rand, K, FLOOR_RANK)
      const terms = termsOfIndices(idxs)
      expect(exactAxisRankIndices(idxs, K, 1)).toBe(naiveAxisRank(terms, 1))
      expect(exactAxisRankIndices(idxs, K, 2)).toBe(naiveAxisRank(terms, 2))
    }
  })

  it("classifies a bounded prefix exactly as the band8 rule does", () => {
    const limit = 100_000
    const seen: number[][] = []
    const result = sweepBand8U(
      { onCandidate: (idxs) => seen.push([...idxs]) },
      { limit, checkpointStep: 0 },
    )

    let refutes = 0
    let candidates = 0
    const expected: number[][] = []
    const idxs = [0, 1, 2, 3, 4, 5, 6, 7]
    for (let n = 0; n < limit; n += 1) {
      if (mode1RankByIndices(idxs, K) > ADD_BUDGET) refutes += 1
      else {
        candidates += 1
        expected.push([...idxs])
      }
      nextComb(idxs, K, FLOOR_RANK)
    }

    expect(result.processed).toBe(limit)
    expect(result.complete).toBe(false)
    expect(result.refutes).toBe(refutes)
    expect(result.candidates).toBe(candidates)
    expect(result.refutes + result.candidates).toBe(limit)
    expect(seen).toEqual(expected)
  })
})

describe("M8-U1-band8c partition", () => {
  it("matches C(49,8) and the landed M8T1_band8.json k=8 partition", () => {
    expect(combCount(FLOOR_RANK, K)).toBe(EXPECTED_TOTAL)
    expect(EXPECTED_TOTAL).toBe(450978066)
    expect(EXPECTED_REFUTES + EXPECTED_UNRESOLVED).toBe(EXPECTED_TOTAL)

    const raw = JSON.parse(readFileSync(BAND8_JSON_PATH, "utf-8")) as {
      results?: readonly {
        k: number
        total: number
        refutes: number
        unresolved: number
        admits: number
        complete: boolean
      }[]
    }
    const k8 = (raw.results ?? []).find((r) => r.k === K)
    expect(k8).toBeDefined()
    expect(k8?.total).toBe(EXPECTED_TOTAL)
    expect(k8?.refutes).toBe(EXPECTED_REFUTES)
    expect(k8?.unresolved).toBe(EXPECTED_UNRESOLVED)
    expect(k8?.admits).toBe(0)
    expect(k8?.complete).toBe(true)
    expect((k8?.refutes ?? 0) + (k8?.unresolved ?? 0)).toBe(k8?.total ?? -1)
    expect(readBand8Counts()).toEqual({
      total: EXPECTED_TOTAL,
      refutes: EXPECTED_REFUTES,
      unresolved: EXPECTED_UNRESOLVED,
    })
  })
})

describe("M8-U1-band8c honesty", () => {
  it("only refutes a candidate with an exact multi-axis lower bound above budget", () => {
    const seen: number[][] = []
    sweepBand8U(
      { onCandidate: (idxs) => seen.push([...idxs]) },
      { limit: 40000, checkpointStep: 0 },
    )
    const sample = seen.slice(0, 200)
    expect(sample.length).toBeGreaterThan(0)
    for (const idxs of sample) {
      const maxAxis = Math.max(
        exactAxisRankIndices(idxs, K, 0, ADD_BUDGET),
        exactAxisRankIndices(idxs, K, 1, ADD_BUDGET),
        exactAxisRankIndices(idxs, K, 2, ADD_BUDGET),
      )
      const decision = disposition(idxs, true)
      if (maxAxis > ADD_BUDGET) expect(decision.kind).toBe("REFUTED")
      else expect(decision.kind).not.toBe("REFUTED")
    }
  })

  it("never snaps or fabricates a refutation when the solve is withheld", () => {
    const seen: number[][] = []
    sweepBand8U(
      { onCandidate: (idxs) => seen.push([...idxs]) },
      { limit: 40000, checkpointStep: 0 },
    )
    const sample = seen.slice(0, 200)
    expect(sample.length).toBeGreaterThan(0)
    for (const idxs of sample) {
      const withheld = disposition(idxs, false)
      expect(withheld.kind).not.toBe("SNAPPED")
      const maxAxis = Math.max(
        exactAxisRankIndices(idxs, K, 0, ADD_BUDGET),
        exactAxisRankIndices(idxs, K, 1, ADD_BUDGET),
        exactAxisRankIndices(idxs, K, 2, ADD_BUDGET),
      )
      expect(withheld.kind).toBe(maxAxis > ADD_BUDGET ? "REFUTED" : "UNRESOLVED")
      if (maxAxis > ADD_BUDGET) expect(postSolveIndices(idxs)).toBe("REFUTED")
      else expect(postSolveIndices(idxs)).not.toBe("REFUTED")
    }
  })

  it("snaps the planted rank-2 admit and never over-claims it as refuted", () => {
    const planted: Mask[] = [...PLANTED_ADMIT_TERMS]
    const decision = resolveTerms(planted, planted.length - 2)
    expect(decision.verdict).toBe("SNAPPED")
    expect(decision.witness).not.toBeNull()
    expect(witnessMatches(decision.witness ?? [], planted)).toBe(true)
  })
})

describe("M8-U1-band8c ledger (bounded run into a temp dir)", () => {
  it("emits one identity per candidate and reconciles both partitions", async () => {
    const dir = mkdtempSync(join(tmpdir(), "m8u1-band8c-"))
    const ndjson = join(dir, "ledger.ndjson")
    const json = join(dir, "report.json")
    const scheme = join(dir, "scheme.ts")
    try {
      const limit = 40000
      const result = await main({
        limit,
        write: true,
        checkpointStep: 0,
        ndjsonPath: ndjson,
        jsonPath: json,
        schemePath: scheme,
      })

      expect(result.sweep.processed).toBe(limit)
      expect(result.sweep.complete).toBe(false)
      expect(result.report.presolve.unresolved).toBe(result.sweep.candidates)
      expect(result.report.presolve.refutes).toBe(result.sweep.refutes)
      expect(result.report.presolve.refutes + result.report.presolve.unresolved).toBe(limit)
      const ps = result.report.postsolve
      expect(ps.snapped + ps.refuted + ps.stillUnresolved).toBe(result.sweep.candidates)
      expect(result.report.reconciliation.observed).toEqual({
        total: result.sweep.total,
        refutes: result.sweep.refutes,
        unresolved: result.sweep.candidates,
      })

      const lines = readFileSync(ndjson, "utf-8")
        .trimEnd()
        .split("\n")
        .filter((l) => l.length > 0)
      expect(lines.length).toBe(result.sweep.candidates)
      expect(result.sweep.candidates).toBeGreaterThan(0)

      let prev: number[] | null = null
      for (const line of lines) {
        const idxs = JSON.parse(line) as number[]
        expect(idxs.length).toBe(K)
        for (let i = 0; i < K; i += 1) {
          const v = idxs[i] ?? -1
          expect(v).toBeGreaterThanOrEqual(0)
          expect(v).toBeLessThan(FLOOR_RANK)
          if (i > 0) expect(v).toBeGreaterThan(idxs[i - 1] ?? -1)
        }
        if (prev !== null) {
          let cmp = 0
          for (let i = 0; i < K; i += 1) {
            const a = idxs[i] ?? 0
            const b = prev[i] ?? 0
            if (a !== b) {
              cmp = a - b
              break
            }
          }
          expect(cmp).toBeGreaterThan(0)
        }
        prev = idxs
      }

      for (const line of lines.slice(0, 64)) {
        const idxs = JSON.parse(line) as number[]
        expect(mode1RankByIndices(idxs, K)).toBeLessThanOrEqual(ADD_BUDGET)
        expect(classifyIndices(idxs, K)).toBe("CANDIDATE")
      }

      const written = JSON.parse(readFileSync(json, "utf-8")) as {
        presolve: { unresolved: number }
      }
      expect(written.presolve.unresolved).toBe(result.sweep.candidates)

      const inert = await main({
        limit: 1000,
        write: false,
        checkpointStep: 0,
        ndjsonPath: join(dir, "inert.ndjson"),
        jsonPath: join(dir, "inert.json"),
        schemePath: join(dir, "inert_scheme.ts"),
      })
      expect(inert.report.presolve.processed).toBe(1000)
      expect(existsSync(join(dir, "inert.ndjson"))).toBe(false)
      expect(existsSync(join(dir, "inert.json"))).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe("M8-U1-band8c scheme emission", () => {
  it("builds an exact verifiable scheme from the floor minus a drop set plus a witness", () => {
    const drop = [0, 1, 2, 3, 4, 7]
    const dropped = termsOfIndices(drop)
    const masks = buildScheme(drop, dropped)
    expect(masks.length).toBe(FLOOR_RANK)
    const scheme = masksToScheme(masks)
    expect(verifyMod2(scheme).correct).toBe(true)
    expect(verifyMod2(scheme).mismatches).toBe(0)
    expect(scheme.triples.length).toBe(FLOOR_RANK)
  })

  it("verifies an exported M8U1 scheme artifact when a snap produced one", async () => {
    if (!existsSync(SCHEME_PATH)) return
    const mod = (await import(pathToFileURL(SCHEME_PATH).href)) as { scheme?: unknown }
    const scheme = mod.scheme as Scheme
    expect(verifyMod2(scheme).correct).toBe(true)
    expect(verifyMod2(scheme).mismatches).toBe(0)
    expect(scheme.triples.length).toBeLessThanOrEqual(TARGET_RANK)
  })
})

describe("M8-U1-band8c full ledger (when the artifact exists)", () => {
  it("streams the real identity ledger and verifies every sampled identity", async () => {
    if (!existsSync(NDJSON_PATH)) return
    const sampleEvery = Math.max(1, Math.floor(EXPECTED_UNRESOLVED / 64))
    const rl = createInterface({
      input: createReadStream(NDJSON_PATH, "utf-8"),
      crlfDelay: Number.POSITIVE_INFINITY,
    })
    let count = 0
    let badFormat = 0
    let orderViolations = 0
    let prev: number[] | null = null
    const samples: number[][] = []
    for await (const line of rl) {
      if (line.length === 0) continue
      const idxs = JSON.parse(line) as number[]
      if (idxs.length !== K) {
        badFormat += 1
        continue
      }
      for (let i = 0; i < K; i += 1) {
        const v = idxs[i] ?? -1
        if (v < 0 || v >= FLOOR_RANK || (i > 0 && v <= (idxs[i - 1] ?? -1))) {
          badFormat += 1
          break
        }
      }
      if (prev !== null) {
        let cmp = 0
        for (let i = 0; i < K; i += 1) {
          const a = idxs[i] ?? 0
          const b = prev[i] ?? 0
          if (a !== b) {
            cmp = a - b
            break
          }
        }
        if (cmp <= 0) orderViolations += 1
      }
      prev = idxs
      if (count % sampleEvery === 0) samples.push(idxs)
      count += 1
    }
    let sampleMismatch = 0
    for (const s of samples) {
      if (mode1RankByIndices(s, K) > ADD_BUDGET) sampleMismatch += 1
    }
    expect(badFormat).toBe(0)
    expect(orderViolations).toBe(0)
    expect(count).toBe(EXPECTED_UNRESOLVED)
    expect(sampleMismatch).toBe(0)

    const raw = JSON.parse(readFileSync(JSON_PATH, "utf-8")) as {
      presolve: { total: number; refutes: number; unresolved: number }
      ledger: { records: number }
    }
    expect(raw.presolve.total).toBe(EXPECTED_TOTAL)
    expect(raw.presolve.refutes).toBe(EXPECTED_REFUTES)
    expect(raw.presolve.unresolved).toBe(EXPECTED_UNRESOLVED)
    expect(raw.ledger.records).toBe(EXPECTED_UNRESOLVED)
  })
})

describe("M8-U1-band8c provenance hygiene", () => {
  it("imports no external tensor source and states the field", () => {
    const src = readFileSync(join(HERE, "M8U1_band8c.ts"), "utf-8").toLowerCase()
    expect(src).not.toMatch(/import[^\n]*alphatensor/)
    expect(src).not.toMatch(/require\([^)]*alphatensor/)
    expect(src).toContain("no alphatensor tensor")
    expect(src).toContain("f_2")
  })

  it("uses only node: builtins and sibling modules", () => {
    const src = readFileSync(join(HERE, "M8U1_band8c.ts"), "utf-8")
    const specs = [...src.matchAll(/^import[^\n]*?["']([^"']+)["']/gm)].map((m) => m[1] ?? "")
    expect(specs.length).toBeGreaterThan(0)
    for (const spec of specs) {
      expect(spec.startsWith("node:") || spec.startsWith("../") || spec.startsWith("./")).toBe(true)
    }
  })
})

describe("M8-U1-band8c final line and args", () => {
  it("emits the exact contract line", () => {
    expect(finalLine(1, 1)).toBe(
      `FINAL: {"task_id":"${TASK_ID}","verdict":"PASS","passed":1,"total":1}`,
    )
    expect(finalLine(0, 1)).toBe(
      `FINAL: {"task_id":"${TASK_ID}","verdict":"FAIL","passed":0,"total":1}`,
    )
  })

  it("parses the CLI bounds", () => {
    const opts = parseArgs([
      "--limit",
      "500",
      "--snap-cap",
      "10",
      "--checkpoint",
      "0",
      "--no-write",
    ])
    expect(opts.limit).toBe(500)
    expect(opts.snapCap).toBe(10)
    expect(opts.checkpointStep).toBe(0)
    expect(opts.write).toBe(false)
  })
})
