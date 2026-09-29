import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, readdir } from "node:fs/promises"
import { verify } from "../checker"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const MATMUL = join(HERE, "..")
const ATT = join(MATMUL, "attempts")

interface Attempt {
  file: string
  exportName: string
  claimed: string
  expect: { rank: number; mismatch: number }
}

const VERIFIED_RANK23: Attempt[] = [
  { file: "T11_solution.ts", exportName: "scheme", claimed: "primary rank-23", expect: { rank: 23, mismatch: 0 } },
  { file: "T12_rank23_variant.ts", exportName: "scheme", claimed: "rank-23 variant", expect: { rank: 23, mismatch: 0 } },
  { file: "T12d_fam_A.ts", exportName: "scheme", claimed: "family A", expect: { rank: 23, mismatch: 0 } },
  { file: "T12d_fam_B.ts", exportName: "scheme", claimed: "family B", expect: { rank: 23, mismatch: 0 } },
]

interface Artifact {
  file: string
  verdict: string
  selfConsistent: boolean
  note: string
}

interface SchemeRow {
  kind: "scheme"
  file: string
  claimed: string
  rank: number
  mismatches: number
  expected: { rank: number; mismatch: number }
  verdict: "REPRODUCED" | "DRIFT"
}

export function checkArtifact(raw: string): { verdict: string; selfConsistent: boolean; note: string } {
  let d: Record<string, unknown>
  try {
    d = JSON.parse(raw) as Record<string, unknown>
  } catch {
    return { verdict: "UNPARSEABLE", selfConsistent: false, note: "not valid JSON" }
  }
  const verdict = typeof d["verdict"] === "string" ? (d["verdict"] as string) : "(no verdict field)"

  // Self-consistency. The point is to catch a tool that was edited after its
  // artifact was written, so the test must be one the artifact can actually
  // satisfy: RECOMPUTE each derived aggregate from the raw observations and
  // compare. A generic "is this number present somewhere in that array" test
  // is wrong, because an aggregate need not equal any individual observation.
  const problems: string[] = []
  const unverifiable: string[] = []
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9

  const rows = d["rows"]
  if (typeof d["recoveryRate"] === "number" && Array.isArray(rows) && rows.length > 0) {
    const withFlag = rows.filter(
      (r): r is Record<string, unknown> => typeof r === "object" && r !== null && "recovered" in r,
    )
    if (withFlag.length === rows.length) {
      const ok = withFlag.filter((r) => r["recovered"] === true).length
      const recomputed = ok / rows.length
      if (!near(recomputed, d["recoveryRate"] as number)) {
        problems.push(`recoveryRate=${String(d["recoveryRate"])} but recomputed ${recomputed} from rows`)
      }
    } else {
      unverifiable.push("recoveryRate (rows lack a uniform 'recovered' flag)")
    }
  }

  const bestByLevel = d["bestByLevel"]
  if (Array.isArray(bestByLevel) && bestByLevel.every((x) => typeof x === "number")) {
    const last = bestByLevel[bestByLevel.length - 1] as number
    for (const nk of ["best", "bestMismatch", "bestMm"]) {
      const v = d[nk]
      if (typeof v === "number" && !near(v, last)) {
        problems.push(`${nk}=${v} but bestByLevel ends at ${last}`)
      }
    }
  } else {
    for (const nk of ["best", "bestMismatch", "bestMm"]) {
      if (typeof d[nk] === "number") unverifiable.push(`${nk} (no bestByLevel trajectory to check against)`)
    }
  }

  return {
    verdict,
    selfConsistent: problems.length === 0,
    note:
      problems.length > 0
        ? problems.join("; ")
        : unverifiable.length > 0
          ? `consistent; not recomputable: ${unverifiable.join(", ")}`
          : "consistent",
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const rows: SchemeRow[] = []
    let allSchemesPass = true

    for (const a of VERIFIED_RANK23) {
      const mod = (await import(join(ATT, a.file))) as Record<string, unknown>
      const s = mod[a.exportName] as Scheme
      const res = verify(s)
      const ok = res.mismatches === a.expect.mismatch && res.rank === a.expect.rank
      if (!ok) allSchemesPass = false
      rows.push({
        kind: "scheme",
        file: a.file,
        claimed: a.claimed,
        rank: res.rank,
        mismatches: res.mismatches,
        expected: a.expect,
        verdict: ok ? "REPRODUCED" : "DRIFT",
      })
      console.log(
        `${ok ? "OK  " : "FAIL"} ${a.file} rank=${res.rank} mismatches=${res.mismatches} (${a.claimed})`,
      )
    }

    const files = (await readdir(ATT)).filter((f) => /^R\d+.*\.json$/.test(f)).sort()
    const artifacts: Artifact[] = []
    for (const f of files) {
      const c = checkArtifact(await readFile(join(ATT, f), "utf-8"))
      artifacts.push({ file: f, ...c })
      const bad = c.selfConsistent ? "" : `  <-- ${c.note}`
      console.log(`${c.selfConsistent ? "ok  " : "DRIFT"} ${f}  ${c.verdict}${bad}`)
    }

    const driftedArtifacts = artifacts.filter((a) => !a.selfConsistent)
    const driftedSchemes = rows.filter((r) => r.verdict === "DRIFT")
    const controls = artifacts.filter((a) => /CONTROL|_control/i.test(a.file))
    const controlsFailed = controls.filter((a) => /FAIL|control/i.test(a.verdict))

    const payload = {
      generatedBy: "tools/verifyAll.ts",
      purpose:
        "regenerate and cross-check every campaign claim from the current code, so artifacts cannot silently drift away from the tools that produced them",
      schemes: rows,
      artifacts,
      summary: {
        schemeCount: rows.length,
        allSchemesPass,
        artifactCount: artifacts.length,
        driftedArtifacts: driftedArtifacts.map((a) => a.file),
        driftedSchemes: driftedSchemes.map((s) => s.file),
        controlsRun: controls.length,
        controlsFailed: controlsFailed.map((a) => a.file),
        bestKnownRank: 23,
        bestKnownRank22: null,
        frontier:
          "rank 22 remains open; the best verified scheme in this repo has rank 23 and the campaign's negative results are scoped to specific ansatzes, never to optimality of rank 23",
      },
      verdict:
        allSchemesPass && driftedArtifacts.length === 0
          ? "ALL-CLAIMS-REPRODUCE"
          : "DRIFT-DETECTED",
    }
    await writeFile(join(ATT, "VERIFY_ALL.json"), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`\nverdict=${payload.verdict}`)
    console.log(`schemes=${payload.summary.schemeCount} artifacts=${payload.summary.artifactCount}`)
    console.log(`driftedArtifacts=${payload.summary.driftedArtifacts.length} driftedSchemes=${payload.summary.driftedSchemes.length}`)
    if (payload.verdict !== "ALL-CLAIMS-REPRODUCE") process.exit(1)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
