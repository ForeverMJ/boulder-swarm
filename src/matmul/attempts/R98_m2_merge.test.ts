import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { checkArtifact } from "../tools/verifyAll"
import type { Scheme } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import {
  anchorOf as anchorOfA,
  anchorStepsUpTo as stepsUpToA,
  combos as combosA,
  compactAll as compactAllA,
  droppedSum as droppedSumA,
  enumerateRefinements as enumA,
  factorRank1 as facA,
  FLAT as FLAT_A,
  screenRow as screenRowA,
} from "./R97_m2_famA_search"
import {
  anchorOf as anchorOfB,
  compactAll as compactAllB,
  droppedSum as droppedSumB,
  enumerateRefinements as enumB,
  factorRank1 as facB,
} from "./R97_m2_famB_search"
import {
  checkClaimsReproduce,
  mergeDir,
  mergeShards,
  plannedForBase,
  reverifySurvivor,
  rowsPerAnchorFor,
} from "./R98_m2_merge"
import type { ClaimsCheck, ShardControl, ShardInput, ShardSurvivor } from "./R98_m2_merge"

const HERE = dirname(fileURLToPath(import.meta.url))
const RPA = 12650
const FIX_CLAIMS: ClaimsCheck = { ok: true, detail: "fixture" }

async function freshDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "r98merge-"))
}

function controlsFixture(): ShardControl[] {
  return [
    { name: "base-exact", pass: true, gating: true, detail: "verify(): rank23/mm0" },
    { name: "positive-control-rank1", pass: true, gating: true, detail: "40/40 planted accepted" },
    { name: "factorisation-roundtrip", pass: true, gating: true, detail: "40/40 reproduced" },
    { name: "negative-control-rank2", pass: true, gating: true, detail: "40/40 rejected" },
    { name: "band-relation", pass: true, gating: true, detail: "C(25,4)=12650" },
    { name: "t11-row-reproduction", pass: true, gating: true, detail: "0 survivors, 0 undecided" },
  ]
}

function firstGoodAnchorA(): { anchor: Scheme; stepsStr: string } {
  for (const steps of stepsUpToA(enumA(famA), 2)) {
    try {
      const anchor = anchorOfA(famA, steps)
      return { anchor, stepsStr: steps.map((s) => `${s.term}:${s.mode}:${s.mask}`).join("|") }
    } catch {
      continue
    }
  }
  throw new Error("no non-degenerate famA anchor")
}

/** Survivor record whose claimed checker fields come from a real verify() run. */
function constructedSurvivorA(): ShardSurvivor {
  const { anchor, stepsStr } = firstGoodAnchorA()
  const terms = compactAllA(anchor)
  const drop = [0, 1, 2, 3]
  const deficit = droppedSumA(terms, drop)
  const fac = facA(deficit)
  const killed = new Set(drop)
  const triples = anchor.triples.filter((_, i) => !killed.has(i))
  if (fac !== undefined && fac.u.length > 0) triples.push({ u: fac.u, v: fac.v, w: fac.w })
  const cv = verify({ n: 3, triples })
  return {
    anchor: stepsStr,
    drop,
    candidateTerms: triples.length,
    checkerCorrect: cv.correct,
    checkerRank: cv.rank,
    mismatches: cv.mismatches,
    reason: "test-fixture-from-real-verify",
  }
}

function constructedSurvivorB(): ShardSurvivor {
  for (const steps of stepsUpToA(enumB(famB), 2)) {
    let anchor: Scheme
    try {
      anchor = anchorOfB(famB, steps)
    } catch {
      continue
    }
    const terms = compactAllB(anchor)
    const drop = [0, 1, 2, 3]
    const deficit = droppedSumB(terms, drop)
    const fac = facB(deficit)
    const killed = new Set(drop)
    const triples = anchor.triples.filter((_, i) => !killed.has(i))
    if (fac !== undefined && fac.u.length > 0) triples.push({ u: fac.u, v: fac.v, w: fac.w })
    const cv = verify({ n: 3, triples })
    return {
      anchor: steps.map((s) => `${s.term}:${s.mode}:${s.mask}`).join("|"),
      drop,
      candidateTerms: triples.length,
      checkerCorrect: cv.correct,
      checkerRank: cv.rank,
      mismatches: cv.mismatches,
      note: "test-fixture-from-real-verify",
    }
  }
  throw new Error("no non-degenerate famB anchor")
}

function shardA(
  shard: number,
  shards: number,
  planned: string,
  opts?: {
    rowsUndecided?: number
    survivors?: ShardSurvivor[]
    cursor?: number
    controls?: ShardControl[]
    screened?: number
    refused?: number
  },
): ShardInput {
  const screened = opts?.screened ?? 2
  const refused = opts?.refused ?? 1
  const survivors = opts?.survivors ?? []
  const undecided = opts?.rowsUndecided ?? 0
  const rowsScreened = screened * RPA
  return {
    base: "T12d_fam_A",
    m: 2,
    shard,
    shards,
    anchorsPlanned: planned,
    rowsPerAnchor: RPA,
    anchorsCompleted: screened,
    anchorsRefused: refused,
    rowsScreened,
    rowsRefuted: rowsScreened - survivors.length - undecided,
    rowsSurvivor: survivors.length,
    rowsUndecided: undecided,
    startCursor: 0,
    cursor: opts?.cursor ?? 50,
    timedOut: true,
    controls: opts?.controls ?? controlsFixture(),
    survivors,
  }
}

function shardB(
  shard: number,
  shards: number,
  planned: string,
  opts?: { controls?: ShardControl[]; resumeFrom?: number; screened?: number; refused?: number },
): ShardInput {
  const screened = opts?.screened ?? 2
  const refused = opts?.refused ?? 1
  return {
    base: "T12d_fam_B",
    m: 2,
    shard,
    shards,
    anchorsPlanned: planned,
    rowsPerAnchor: RPA,
    anchorsScreened: screened,
    anchorsRefused: refused,
    anchorsVisited: screened + refused,
    rowsScreened: screened * RPA,
    rowsRefuted: screened * RPA,
    rowsSurvivor: 0,
    rowsUndecided: 0,
    start: 10,
    resumeFrom: opts?.resumeFrom ?? 10 + screened + refused,
    timedOut: false,
    controls: opts?.controls ?? controlsFixture(),
    survivors: [],
  }
}

describe("R98_m2_merge", () => {
  it("band relation: rowsPerAnchorFor(2) is C(25,4)=12650", () => {
    expect(rowsPerAnchorFor(2)).toBe(RPA)
  })

  it("happy path: famA x2 shards + famB x1 shard merge with reconciled totals", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const plannedB = plannedForBase("B", 2).toString()
    const res = mergeShards(
      [
        { file: "R98_m2_T12d_fam_A_shard0of2.json", raw: shardA(0, 2, plannedA, { survivors: [constructedSurvivorA()], rowsUndecided: 9 }) },
        { file: "R98_m2_T12d_fam_A_shard1of2.json", raw: shardA(1, 2, plannedA, { screened: 3, refused: 0, cursor: 60 }) },
        { file: "R98_m2_T12d_fam_B_shard0of1.json", raw: shardB(0, 1, plannedB) },
      ],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGED")
    expect(res.problems).toEqual([])
    expect(res.witnessTotal).toBe(0)
    const a = res.bases.find((b) => b.base === "T12d_fam_A")
    const b = res.bases.find((b) => b.base === "T12d_fam_B")
    expect(a?.shards).toBe(2)
    expect(a?.rowsScreened).toBe(5 * RPA)
    expect(a?.rowsSurvivor).toBe(1)
    expect(a?.rowsUndecided).toBe(9)
    expect(a?.rowsRefuted).toBe(5 * RPA - 10)
    expect(a?.reverifiedSurvivors).toBe(1)
    expect(a?.rowsUnscreened).toBe(((BigInt(plannedA) - 5n) * BigInt(RPA)).toString())
    expect(a?.rowsPlanned).toBe((BigInt(plannedA) * BigInt(RPA)).toString())
    expect(a?.complete).toBe(false)
    expect(b?.rowsScreened).toBe(2 * RPA)
    expect(b?.complete).toBe(false)
  })

  it("survivor re-verification agrees with the screening instrument row-for-row", () => {
    const { anchor, stepsStr } = firstGoodAnchorA()
    const terms = compactAllA(anchor)
    const scratch = new Int32Array(FLAT_A)
    const touched: number[] = []
    const flatScratch = new Int32Array(9 * 81)
    const oracle = { rows: 0, disagreements: 0 }
    let checked = 0
    let survivorsSeen = 0
    for (const drop of combosA(terms.length, 4)) {
      const vd = screenRowA(anchor, terms, drop, scratch, touched, flatScratch, oracle)
      if (vd.status !== "SURVIVOR") continue
      survivorsSeen += 1
      const rec: ShardSurvivor = {
        anchor: stepsStr,
        drop: [...drop],
        candidateTerms: vd.candidateTerms ?? 0,
        checkerCorrect: vd.checkerCorrect ?? false,
        checkerRank: vd.checkerRank ?? -1,
        mismatches: vd.mismatches ?? -1,
        reason: vd.reason,
      }
      const r = reverifySurvivor("T12d_fam_A", rec)
      expect(r.ok).toBe(true)
      checked += 1
      if (checked >= 3) break
    }
    if (survivorsSeen === 0) {
      const r = reverifySurvivor("T12d_fam_A", constructedSurvivorA())
      expect(r.ok).toBe(true)
    }
    expect(reverifySurvivor("T12d_fam_B", constructedSurvivorB()).ok).toBe(true)
  }, 30000)

  it("tampered survivor fails re-verification and fails the merge", () => {
    const good = constructedSurvivorA()
    const tampered: ShardSurvivor = {
      ...good,
      checkerCorrect: true,
      checkerRank: 22,
      mismatches: 0,
    }
    // Only run the tamper assertion when the fixture is not itself a witness.
    if (good.checkerCorrect && good.checkerRank <= 22) {
      expect(reverifySurvivor("T12d_fam_A", good).witness).toBe(true)
      return
    }
    expect(reverifySurvivor("T12d_fam_A", tampered).ok).toBe(false)
    const plannedA = plannedForBase("A", 2).toString()
    const res = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, plannedA, { survivors: [tampered] }) }],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGE-FAILED")
    expect(res.problems.some((p) => p.includes("recomputed") || p.includes("claim"))).toBe(true)
  })

  it("missing shard fails the merge and names the gap", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const res = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of2.json", raw: shardA(0, 2, plannedA) }],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGE-FAILED")
    expect(res.problems.some((p) => p.includes("shard 1 of 2 missing"))).toBe(true)
  })

  it("duplicated shard fails the merge", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const res = mergeShards(
      [
        { file: "R98_m2_T12d_fam_A_shard0of2.json", raw: shardA(0, 2, plannedA) },
        { file: "R98_m2_T12d_fam_A_shard0of2-dup.json", raw: shardA(0, 2, plannedA) },
      ],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGE-FAILED")
    expect(res.problems.some((p) => p.includes("duplicated"))).toBe(true)
  })

  it("tampered row totals fail reconciliation", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const bad = shardA(0, 1, plannedA)
    const tampered: ShardInput = { ...bad, rowsRefuted: bad.rowsRefuted + 1 }
    const res = mergeShards([{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: tampered }], FIX_CLAIMS)
    expect(res.verdict).toBe("MERGE-FAILED")
    expect(res.problems.some((p) => p.includes("rowsScreened"))).toBe(true)
  })

  it("checkpoint ahead of work fails (resumeFrom and cursor paths)", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const plannedB = plannedForBase("B", 2).toString()
    const ahead = mergeShards(
      [{ file: "R98_m2_T12d_fam_B_shard0of1.json", raw: shardB(0, 1, plannedB, { resumeFrom: 10 + 2 + 1 + 10 }) }],
      FIX_CLAIMS,
    )
    expect(ahead.verdict).toBe("MERGE-FAILED")
    expect(ahead.problems.some((p) => p.includes("checkpoint") || p.includes("resumeFrom"))).toBe(true)
    const cursorAhead = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, plannedA, { cursor: Number(BigInt(plannedA) + 100n) }) }],
      FIX_CLAIMS,
    )
    expect(cursorAhead.verdict).toBe("MERGE-FAILED")
    expect(cursorAhead.problems.some((p) => p.includes("ahead of anchorsPlanned"))).toBe(true)
  })

  it("red gating control fails; absent controls fail", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const red = controlsFixture().map((c, i) => (i === 0 ? { ...c, pass: false } : c))
    const r1 = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, plannedA, { controls: red }) }],
      FIX_CLAIMS,
    )
    expect(r1.verdict).toBe("MERGE-FAILED")
    expect(r1.problems.some((p) => p.includes("gating control FAILED"))).toBe(true)
    const r2 = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, plannedA, { controls: [] }) }],
      FIX_CLAIMS,
    )
    expect(r2.verdict).toBe("MERGE-FAILED")
    expect(r2.problems.some((p) => p.includes("no controls"))).toBe(true)
  })

  it("unresolved rows are named targets, never refutations", () => {
    const plannedA = plannedForBase("A", 2).toString()
    const res = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, plannedA, { rowsUndecided: 4 }) }],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGED")
    const a = res.bases[0]
    expect(a?.rowsUndecided).toBe(4)
    expect(a?.unresolvedTargets.length).toBe(1)
    expect(a?.unresolvedTargets[0]?.target).toContain("NOT a refutation")
    expect(a?.rowsRefuted).toBe((a?.rowsScreened ?? 0) - (a?.rowsUndecided ?? 0))
  })

  it("planned count must match the code revision", () => {
    const res = mergeShards(
      [{ file: "R98_m2_T12d_fam_A_shard0of1.json", raw: shardA(0, 1, "7") }],
      FIX_CLAIMS,
    )
    expect(res.verdict).toBe("MERGE-FAILED")
    expect(res.problems.some((p) => p.includes("anchorsPlanned"))).toBe(true)
  })

  it("mergeDir on an empty dir is honest and writes a clean artifact", async () => {
    const dir = await freshDir()
    const { result, outPath } = await mergeDir(dir, dir)
    expect(result.verdict).toBe("NO-SHARDS-NOTHING-MEASURED")
    expect(result.bases).toEqual([])
    const raw = await readFile(outPath, "utf8")
    const parsed = JSON.parse(raw) as { verdict: string }
    expect(parsed.verdict).toBe("NO-SHARDS-NOTHING-MEASURED")
    expect(checkArtifact(raw).selfConsistent).toBe(true)
  })

  it("mergeDir round-trips fixtures and the artifact stays verifyAll-clean", async () => {
    const dir = await freshDir()
    const plannedA = plannedForBase("A", 2).toString()
    const plannedB = plannedForBase("B", 2).toString()
    await writeFile(join(dir, "R98_m2_T12d_fam_A_shard0of1.json"), JSON.stringify(shardA(0, 1, plannedA)))
    await writeFile(join(dir, "R98_m2_T12d_fam_B_shard0of1.json"), JSON.stringify(shardB(0, 1, plannedB)))
    const { result, outPath } = await mergeDir(dir, dir)
    expect(result.verdict).toBe("MERGED")
    expect(result.claimsReproduce.ok).toBe(true)
    const raw = await readFile(outPath, "utf8")
    expect(checkArtifact(raw).selfConsistent).toBe(true)
    expect((JSON.parse(raw) as { verdict: string }).verdict).toBe("MERGED")
  })

  it("live repo claims still reproduce (read-only)", async () => {
    const claims = await checkClaimsReproduce(HERE)
    expect(claims.ok).toBe(true)
  }, 30000)
})
