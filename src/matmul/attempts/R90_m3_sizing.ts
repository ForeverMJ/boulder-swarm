/**
 * R90-size — exact sizing of the m=3 wide-anchor layer over the two rank-23
 * base families T12d_fam_A and T12d_fam_B (each `export const scheme`).
 *
 * At layer m an anchor is base + m refinement steps with pairwise DISTINCT
 * term:mode slots. m=3 anchors have 26 terms; a row drops k=m+2=5 of them
 * (21 kept, j=1), so rowsPerAnchor = C(26,5) = 65780. Streaming all m=3
 * anchors is infeasible, so the anchor count comes from a CLOSED FORM, not
 * enumeration: group the refinement list by slot key (`term:mode`), group
 * sizes g_1..g_G, S_i = sum(g^i), then
 *   anchorsM2 = e2 = (S1^2 - S2)/2
 *   anchorsM3 = e3 = (S1^3 - 3*S1*S2 + 2*S3)/6.
 * All products use BigInt; JSON values are exact (< 2^53, checked at runtime).
 *
 * `enumerateRefinements` below is a port of the reference implementation on
 * branch agent/goal-w0-T12@ab70172
 * (src/matmul/tools/anchorSplit.ts), copied inline: every support
 * bipartition of every factor of every term, in a fixed order.
 *
 * GROUND-TRUTH CROSS-CHECK (m=2: fam_A = 4169972, fam_B = 5383004) — FAILED,
 * honestly. The port is verified correct: run against the branch's own
 * anchorSplit.ts it yields identical pool sizes (4474 / 3458 current files,
 * 3034 branch-era fam_A), and grouping the branch-era fam_A pool by TERM
 * reproduces 4169972 exactly, as does the current fam_B pool (5383004).
 * Those ground-truth numbers are R85's `anchorSpaceCount` values, which count
 * anchors on DISTINCT TERMS (R85's `anchorStepsUpTo` picks at most one
 * refinement per term), while this task's closed form counts DISTINCT
 * term:mode slots — a strictly larger set whenever one term has refinements
 * in two modes (branch-era fam_A: e2 = 4246780 vs dp2 = 4169972; current
 * fam_B: e2 = 5488356 vs dp2 = 5383004). On top of that, fam_A has since been
 * replaced on main (commit 7cb279c), so no formula on the current file can
 * reproduce the old number (current fam_A: e2 = 9256528). Per the task RULES
 * the JSON therefore carries verdict SIZING-FAILED with this note — no counts
 * fabricated; the honestly computed e2/e3 numbers are still reported.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Scheme } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"

const HERE = dirname(fileURLToPath(import.meta.url))

const ROWS_PER_ANCHOR_M3 = 65780
const ROWS_PER_SEC_PER_SHARD = 200000
const CLOSURE_BUDGET_CORE_HOURS = 28 * 3

const GROUND_TRUTH_M2: Readonly<Record<string, bigint>> = {
  T12d_fam_A: 4169972n,
  T12d_fam_B: 5383004n,
}

/** One split step: which term, which of its three modes, which support half. */
type Refinement = {
  readonly term: number
  /** 0 = u, 1 = v, 2 = w. */
  readonly mode: 0 | 1 | 2
  /** Bitmask over the 9 indices of that factor; bit set = first part. */
  readonly mask: number
}

function popcount(x: number): number {
  let c = 0
  let v = x
  while (v !== 0) {
    c += v & 1
    v >>>= 1
  }
  return c
}

/** Port of `enumerateRefinements` from tools/anchorSplit.ts (branch above). */
function enumerateRefinements(s: Scheme): Refinement[] {
  const out: Refinement[] = []
  for (let term = 0; term < s.triples.length; term += 1) {
    const t = s.triples[term]
    if (t === undefined) continue
    const factors = [t.u, t.v, t.w] as const
    for (let mode = 0 as 0 | 1 | 2; mode < 3; mode = (mode + 1) as 0 | 1 | 2) {
      const f = factors[mode]
      let supp = 0
      for (let i = 0; i < 9; i += 1) if ((f[i] ?? 0) !== 0) supp |= 1 << i
      const size = popcount(supp)
      if (size < 2) continue
      for (let mask = 1; mask < 512; mask += 1) {
        if ((mask & ~supp) !== 0) continue
        const inside = popcount(mask)
        if (inside === 0 || inside === size) continue
        out.push({ term, mode, mask })
      }
    }
  }
  return out
}

function binomialBig(n: number, k: number): bigint {
  let r = 1n
  for (let i = 0n; i < BigInt(k); i += 1n) r = (r * (BigInt(n) - i)) / (i + 1n)
  return r
}

type BaseEntry = {
  readonly name: string
  readonly refinements: number
  readonly slots: number
  readonly anchorsM2: number
  readonly anchorsM3: number
  readonly rowsPerAnchor: number
  readonly totalRowsM3: number
}

function sizeBase(name: string, scheme: Scheme): {
  entry: BaseEntry
  anchorsM2: bigint
  anchorsM3: bigint
  totalRowsM3: bigint
} {
  const pool = enumerateRefinements(scheme)
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
  const e2 = (s1 * s1 - s2) / 2n
  const e3 = (s1 * s1 * s1 - 3n * s1 * s2 + 2n * s3) / 6n
  const rpa = binomialBig(26, 5)
  if (rpa !== BigInt(ROWS_PER_ANCHOR_M3)) throw new Error(`C(26,5) drift: ${rpa}`)
  const rows = e3 * rpa
  for (const v of [e2, e3, rows]) {
    if (v > 9007199254740991n) throw new Error("count exceeds 2^53, refuses lossy JSON")
  }
  return {
    entry: {
      name,
      refinements: pool.length,
      slots: groups.size,
      anchorsM2: Number(e2),
      anchorsM3: Number(e3),
      rowsPerAnchor: ROWS_PER_ANCHOR_M3,
      totalRowsM3: Number(rows),
    },
    anchorsM2: e2,
    anchorsM3: e3,
    totalRowsM3: rows,
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const sized = [sizeBase("T12d_fam_A", famA), sizeBase("T12d_fam_B", famB)]
    const totalAnchorsM3 = sized.reduce((a, s) => a + s.anchorsM3, 0n)
    const totalRowsM3 = sized.reduce((a, s) => a + s.totalRowsM3, 0n)
    const coreHours = Number(totalRowsM3) / ROWS_PER_SEC_PER_SHARD / 3600
    const wallHours28 = coreHours / 28

    const expected = sized.map((s) => GROUND_TRUTH_M2[s.entry.name] ?? -1n)
    const match = sized.every((s, i) => s.anchorsM2 === expected[i])

    let verdict: string
    let note: string
    if (!match) {
      verdict = "SIZING-FAILED"
      note = [
        "m=2 ground-truth cross-check failed, so no closure verdict is claimed.",
        `expected anchorsM2 fam_A=4169972 fam_B=5383004, computed ${sized[0]?.anchorsM2 ?? "?"} / ${sized[1]?.anchorsM2 ?? "?"} via the distinct-slot e2 closed form.`,
        "The port is not the cause: against the branch's own anchorSplit.ts it gives identical pool sizes, and grouping the branch-era fam_A pool by TERM reproduces 4169972 exactly (current fam_B by TERM gives 5383004).",
        "The quoted numbers are R85 anchorSpaceCount values (distinct TERM anchors); e2 counts distinct term:mode SLOT pairs, a larger set (branch-era fam_A e2=4246780; current fam_B e2=5488356).",
        "Additionally fam_A was replaced on main after the R85 measurement (commit 7cb279c), so the old number is unreproducible on the current file under any formula (current fam_A e2=9256528, distinct-term dp2=9069616).",
        `Informational sizing only: m=3 totals ${totalAnchorsM3} anchors x 65780 rows = ${totalRowsM3} rows, ~${Math.round(coreHours)} core-hours at ${ROWS_PER_SEC_PER_SHARD} rows/s/shard (~${Math.round(wallHours28)} wall-hours on 28 shards), far above the 28-shard x 3h (${CLOSURE_BUDGET_CORE_HOURS} core-hour) closure budget.`,
      ].join(" ")
    } else {
      const affordable = coreHours <= CLOSURE_BUDGET_CORE_HOURS
      verdict = affordable ? "CLOSURE-AFFORDABLE" : "CLOSURE-INFEASIBLE-BY-ENUMERATION"
      note = `m=2 ground truth reproduced exactly on both bases; m=3 totals ${totalAnchorsM3} anchors = ${totalRowsM3} rows, ~${Math.round(coreHours)} core-hours at ${ROWS_PER_SEC_PER_SHARD} rows/s/shard vs ${CLOSURE_BUDGET_CORE_HOURS} core-hour budget.`
    }

    const payload = {
      perBase: sized.map((s) => s.entry),
      totalAnchorsM3: Number(totalAnchorsM3),
      totalRowsM3: Number(totalRowsM3),
      assumedRowsPerSecPerShard: ROWS_PER_SEC_PER_SHARD,
      projectionCoreHours: coreHours,
      projectionWallHours28Shards: wallHours28,
      verdict,
      note,
      groundTruth: {
        expectedAnchorsM2: { T12d_fam_A: 4169972, T12d_fam_B: 5383004 },
        computedAnchorsM2: {
          T12d_fam_A: Number(sized[0]?.anchorsM2 ?? 0n),
          T12d_fam_B: Number(sized[1]?.anchorsM2 ?? 0n),
        },
        match,
      },
      generatedAt: new Date().toISOString(),
    }
    const out = join(HERE, "R90_m3_sizing.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`R90 sizing -> ${out} verdict=${verdict}`)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
