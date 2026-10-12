/**
 * R98-m2 reconcile — reconcile R90's SIZING-FAILED on the current main files.
 *
 * R90 counted anchors with the distinct term:mode SLOT closed form
 * (e2 = (S1^2 - S2)/2 over slot-group sizes) while the quoted ground-truth
 * numbers (fam_A 4169972, fam_B 5383004) are R85 `anchorSpaceCount` values,
 * which count anchors on DISTINCT TERMS (at most one refinement per term).
 * On top of that, fam_A was replaced on main (commit 7cb279c) after the R85
 * measurement, so the old fam_A number is unreproducible on the current file
 * under ANY formula. This module enumerates the refinement pools of all three
 * m=2 sweep bases (T11_solution, T12d_fam_A, T12d_fam_B) on the CURRENT files
 * and reports BOTH counts per base side by side, so every historic number is
 * named with the formula that produced it instead of failing a cross-check.
 *
 * Anchor semantics (m=2): base (23 terms) + 2 refinement steps = 25 terms; a
 * row drops k = m+2 = 4 terms (21 kept, j = 1), so
 * rowsPerAnchor = C(25,4) = 12650. The m=2 sweeps iterate the DISTINCT-TERM
 * anchor space (`anchorStepsUpTo`: one refinement per term, ordered by term),
 * so the shard plan below partitions the DP (distinct-term) counts, not e2.
 *
 * Field discipline: integer counting only; bounds untouched
 * (19 <= R <= 23 over Q/R, 21 <= R_F2 <= 23 over F_2). No band is closed by
 * this sizing: verdict is RECONCILED-NO-CLOSURE, never a closure claim.
 */
import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { Scheme } from "../types"
import { scheme as famA } from "./T12d_fam_A"
import { scheme as famB } from "./T12d_fam_B"
import { scheme as t11 } from "./T11_solution"

const HERE = dirname(fileURLToPath(import.meta.url))

export const M = 2
export const ROWS_PER_ANCHOR_M2 = 12650
export const SHARDS_PER_BASE = 8
export const VERDICT = "RECONCILED-NO-CLOSURE"

/** One support-split refinement step: term, factor mode, support half-mask. */
export type Refinement = {
  readonly term: number
  readonly mode: 0 | 1 | 2
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

/** Port of `enumerateRefinements` (R97/R98 search drivers, R90 sizing). */
export function enumerateRefinements(s: Scheme): Refinement[] {
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

export function binomialBig(n: number, k: number): bigint {
  let r = 1n
  for (let i = 0n; i < BigInt(k); i += 1n) r = (r * (BigInt(n) - i)) / (i + 1n)
  return r
}

/** Distinct term:mode SLOT elementary symmetric counts e2 (m=2) and e3 (m=3). */
export function slotCounts(pool: readonly Refinement[]): { e2: bigint; e3: bigint } {
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
  return { e2: (s1 * s1 - s2) / 2n, e3: (s1 * s1 * s1 - 3n * s1 * s2 + 2n * s3) / 6n }
}

/**
 * Distinct-TERM DP count (R85/R97 `anchorSpaceCount`): anchors pick at most
 * one refinement per term, so group the pool by TERM and take e_m over the
 * per-term group sizes. This is the count the m=2 sweeps iterate.
 */
export function distinctTermCount(pool: readonly Refinement[], m: number): bigint {
  const sizes = new Map<number, bigint>()
  for (const r of pool) sizes.set(r.term, (sizes.get(r.term) ?? 0n) + 1n)
  const dp: bigint[] = [1n, 0n, 0n]
  for (const n of sizes.values()) {
    for (let j = dp.length - 1; j >= 1; j -= 1) {
      dp[j] = (dp[j] ?? 0n) + (dp[j - 1] ?? 0n) * n
    }
  }
  return dp[m] ?? 0n
}

export type PerBaseEntry = {
  readonly name: string
  readonly refinements: number
  readonly slots: number
  readonly terms: number
  readonly slotE2: number
  readonly slotE3: number
  readonly distinctTermM2: number
  readonly rowsPerAnchor: number
  readonly totalRowsM2: number
}

export type HistoricEntry = {
  readonly value: number
  readonly label: string
  readonly formula: string
  readonly reproducesOnCurrentFiles: boolean
}

export type ShardEntry = {
  readonly shard: number
  readonly shards: number
  readonly selector: string
  readonly anchors: number
  readonly rows: number
  readonly start: number
}

export type ShardPlan = {
  readonly base: string
  readonly m: number
  readonly planned: number
  readonly rowsPerAnchor: number
  readonly rowsPlanned: number
  readonly shards: ShardEntry[]
  readonly completionCursor: number
}

function sizeBase(name: string, scheme: Scheme): { entry: PerBaseEntry; dp: bigint } {
  const pool = enumerateRefinements(scheme)
  const slotKeys = new Set(pool.map((r) => `${r.term}:${r.mode}`))
  const termKeys = new Set(pool.map((r) => r.term))
  const { e2, e3 } = slotCounts(pool)
  const dp = distinctTermCount(pool, M)
  const rpa = binomialBig(23 + M, M + 2)
  if (rpa !== BigInt(ROWS_PER_ANCHOR_M2)) throw new Error(`C(25,4) drift: ${rpa}`)
  const rows = dp * rpa
  for (const v of [e2, e3, dp, rows]) {
    if (v > 9007199254740991n) throw new Error("count exceeds 2^53, refuses lossy JSON")
  }
  return {
    entry: {
      name,
      refinements: pool.length,
      slots: slotKeys.size,
      terms: termKeys.size,
      slotE2: Number(e2),
      slotE3: Number(e3),
      distinctTermM2: Number(dp),
      rowsPerAnchor: ROWS_PER_ANCHOR_M2,
      totalRowsM2: Number(rows),
    },
    dp,
  }
}

/**
 * Shard plan for one m=2 sweep base. The drivers assign global anchor index
 * ai to shard (ai % shards === shard) and track a global cursor in the same
 * ai space, so shard s owns exactly the ai values with ai % shards === s
 * below planned; a fresh run starts every shard at 0 and a complete run ends
 * every shard at cursor === planned.
 */
export function shardPlanFor(base: string, planned: bigint, shards: number): ShardPlan {
  const p = Number(planned)
  const entries: ShardEntry[] = []
  for (let s = 0; s < shards; s += 1) {
    const anchors = Math.floor((p - s + shards - 1) / shards)
    entries.push({
      shard: s,
      shards,
      selector: `ai % ${shards} === ${s}`,
      anchors,
      rows: anchors * ROWS_PER_ANCHOR_M2,
      start: 0,
    })
  }
  return {
    base,
    m: M,
    planned: p,
    rowsPerAnchor: ROWS_PER_ANCHOR_M2,
    rowsPlanned: p * ROWS_PER_ANCHOR_M2,
    shards: entries,
    completionCursor: p,
  }
}

export function historicNumbers(): HistoricEntry[] {
  return [
    {
      value: 4169972,
      label: "R85 fam_A m=2 ground truth (branch-era file, pre-7cb279c)",
      formula: "distinct-term DP anchorSpaceCount",
      reproducesOnCurrentFiles: false,
    },
    {
      value: 5383004,
      label: "R85 fam_B m=2 ground truth; current T12d_fam_B distinct-term count",
      formula: "distinct-term DP anchorSpaceCount",
      reproducesOnCurrentFiles: true,
    },
    {
      value: 4246780,
      label: "branch-era fam_A distinct-slot pair count (R90 note)",
      formula: "distinct term:mode slot e2",
      reproducesOnCurrentFiles: false,
    },
    {
      value: 5488356,
      label: "current T12d_fam_B distinct-slot pair count",
      formula: "distinct term:mode slot e2",
      reproducesOnCurrentFiles: true,
    },
    {
      value: 9256528,
      label: "current T12d_fam_A distinct-slot pair count",
      formula: "distinct term:mode slot e2",
      reproducesOnCurrentFiles: true,
    },
    {
      value: 9069616,
      label: "current T12d_fam_A distinct-term count",
      formula: "distinct-term DP anchorSpaceCount",
      reproducesOnCurrentFiles: true,
    },
    {
      value: 428180,
      label: "current T11_solution m=2 planned (R98 sweepT11)",
      formula: "distinct-term DP anchorSpaceCount",
      reproducesOnCurrentFiles: true,
    },
    {
      value: 432852,
      label: "current T11_solution distinct-slot pair count",
      formula: "distinct term:mode slot e2",
      reproducesOnCurrentFiles: true,
    },
  ]
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const sized = [
      sizeBase("T11_solution", t11),
      sizeBase("T12d_fam_A", famA),
      sizeBase("T12d_fam_B", famB),
    ]
    const plans = sized.map((s) => shardPlanFor(s.entry.name, s.dp, SHARDS_PER_BASE))
    const totalAnchors = sized.reduce((a, s) => a + BigInt(s.entry.distinctTermM2), 0n)
    const totalRows = sized.reduce((a, s) => a + BigInt(s.entry.totalRowsM2), 0n)
    const payload = {
      perBase: sized.map((s) => s.entry),
      historicNumbers: historicNumbers(),
      shardPlan: plans,
      totalAnchorsM2: Number(totalAnchors),
      totalRowsM2: Number(totalRows),
      rowsPerAnchor: ROWS_PER_ANCHOR_M2,
      verdict: VERDICT,
      note: [
        "R90 SIZING-FAILED reconciled: the quoted ground truths (4169972/5383004) are",
        "distinct-TERM DP counts while R90's closed form counted distinct term:mode SLOT",
        "pairs; both counts are reported per base above and each historic number is",
        "tagged with its formula. fam_A was additionally replaced on main (7cb279c),",
        "so 4169972 cannot reproduce on the current file under any formula.",
        "Sizing only: no m=2 band is closed, no refutation is claimed, and bounds stand",
        "(19 <= R <= 23 over Q/R, 21 <= R_F2 <= 23 over F_2).",
        `m=2 totals ${totalAnchors} distinct-term anchors x 12650 rows = ${totalRows} rows.`,
      ].join(" "),
      generatedAt: new Date().toISOString(),
    }
    const out = join(HERE, "R98_m2_reconcile.json")
    await writeFile(out, `${JSON.stringify(payload, null, 2)}\n`, "utf8")
    console.log(`R98 reconcile -> ${out} verdict=${VERDICT}`)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
