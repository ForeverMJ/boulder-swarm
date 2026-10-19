/**
 * M8-S1 altsupRest — close the named remainder that R141_altsup left open.
 *
 * R141 enumerated 1,176 unique algebraic 47-term supports (coset
 * row/col/diag/adiag/slope-line, symmetric transpose/cyclic S_3 orbits,
 * hyperplane restrictions) but exact-solved only its first 100 (all
 * INCONSISTENT, mm 40-80). This lane re-derives the SAME enumeration by
 * importing R141's construction (no invented supports), skips the 100
 * supports R141 already retired by their recorded FNV-1a hashes, and
 * exact-solves EVERY remaining support over F_2 with R141's per-axis
 * gaussSolve machinery.
 *
 * Per-support checkpoints land in M8S1_altsupRest.ndjson plus a summary json.
 * A CONSISTENT support that verifies under BOTH verifyMod2 AND verify would be
 * written to M8S1_scheme.ts and reported SHIPPED; otherwise this lane exports
 * NO `scheme` and the verdict is BOUNDED-NO-CLOSURE with the solved/total
 * counts stated. No budget-driven refutation: every non-retired support is
 * solved, and anything left unsolved would be reported UNRESOLVED, never as an
 * impossibility. Field F_2 throughout; no AlphaTensor tensors.
 * File-ownership: attempts/M8S1_altsupRest* and attempts/M8S1_scheme.ts only.
 */
import { readFileSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import type { F2Term, SolveReport, SupportEntry } from "./R141_altsup"
import { enumerateAlgebraicSupports, seedF2, solveSupport, toSchemeF2 } from "./R141_altsup"

const HERE = dirname(fileURLToPath(import.meta.url))

export const NDJSON = join(HERE, "M8S1_altsupRest.ndjson")
export const SUMMARY_JSON = join(HERE, "M8S1_altsupRest_summary.json")
export const R141_NDJSON = join(HERE, "R141_altsup.ndjson")
export const SCHEME_PATH = join(HERE, "M8S1_scheme.ts")

export const TASK_ID = "M8-S1-altsupRest"
export const FIELD = "F_2"
export const N4 = 16
export const TARGET_RANK = 47
/** R141's full census of unique algebraic 47-term supports. */
export const R141_CENSUS = 1176
/** How many of those R141 already retired (its first-100 slice). */
export const R141_RETIRED = 100
export const VERDICT_SHIPPED = "SHIPPED"
export const VERDICT_BOUNDED = "BOUNDED-NO-CLOSURE"

const HASH_RE = /^[0-9a-f]{8}$/

export type Disposition = "INCONSISTENT-retire" | "CONSISTENT-F2-ONLY" | "SHIPPED"

export type AxisRow = {
  readonly axis: 0 | 1 | 2
  readonly ok: boolean
  readonly mmBefore: number
  readonly mmAfter: number
}

export type SupportRow = {
  readonly kind: "support"
  readonly hash: string
  readonly source: string
  readonly axis: 0 | 1 | 2
  readonly mmBefore: number
  readonly mmAfter: number
  readonly intMmAfter: number
  readonly verifyF2: boolean
  readonly disposition: Disposition
  readonly perAxis: readonly AxisRow[]
}

export type Controls = {
  readonly floorSeedConsistent: boolean
  readonly retiredHash: string | null
  readonly retiredInconsistent: boolean
}

export type Summary = {
  readonly kind: "summary"
  readonly task: string
  readonly field: string
  readonly n: number
  readonly targetRank: number
  readonly census: number
  readonly r141Retired: number
  readonly skippedToR141: number
  readonly solved: number
  readonly unresolved: number
  readonly consistent: number
  readonly shipped: string | null
  readonly verdict: string
  readonly bySource: Record<string, number>
  readonly controls: Controls
  readonly note: string
}

export type SweepResult = {
  readonly census: readonly SupportEntry[]
  readonly skipped: readonly SupportEntry[]
  readonly solved: readonly SupportRow[]
  readonly summary: Summary
}

/* ------------------------------------ R141 record */

/**
 * The hashes R141 recorded as retired, read from its checkpoint
 * (kind === "verdict" rows). This is the "record" the task dedupes against.
 */
export function readRetiredHashes(path: string = R141_NDJSON): string[] {
  const raw = readFileSync(path, "utf8")
  const seen = new Set<string>()
  const out: string[] = []
  for (const line of raw.split("\n")) {
    const s = line.trim()
    if (s.length === 0) continue
    const row = JSON.parse(s) as Record<string, unknown>
    if (row["kind"] !== "verdict") continue
    const h = row["hash"]
    if (typeof h !== "string" || !HASH_RE.test(h)) throw new Error(`bad retired hash: ${String(h)}`)
    if (!seen.has(h)) {
      seen.add(h)
      out.push(h)
    }
  }
  return out
}

/* ------------------------------------ per-support solve */

export type SolveOne = {
  readonly row: SupportRow
  readonly ships: boolean
  readonly solved: readonly F2Term[]
}

function concludingAxis(rep: SolveReport): 0 | 1 | 2 {
  const last = rep.perAxis[rep.perAxis.length - 1]
  return last === undefined ? 2 : last.axis
}

function toAxisRows(rep: SolveReport): AxisRow[] {
  return rep.perAxis.map((a) => ({
    axis: a.axis,
    ok: a.ok,
    mmBefore: a.mmBefore,
    mmAfter: a.mmAfter,
  }))
}

/** Exact-solve one enumerated support over F_2 and classify its disposition. */
export function solveOne(entry: SupportEntry): SolveOne {
  const terms: F2Term[] = entry.masks.map(([u, v, w]) => ({ u, v, w }))
  const rep = solveSupport(terms)
  const scheme = toSchemeF2(rep.solved)
  const verifyF2 = verifyMod2(scheme).correct
  const verifyInt = verify(scheme).correct
  const ships = rep.consistent && verifyF2 && verifyInt
  const disposition: Disposition = ships
    ? "SHIPPED"
    : rep.consistent
      ? "CONSISTENT-F2-ONLY"
      : "INCONSISTENT-retire"
  const row: SupportRow = {
    kind: "support",
    hash: entry.hash,
    source: entry.source,
    axis: concludingAxis(rep),
    mmBefore: rep.mmBefore,
    mmAfter: rep.mmAfter,
    intMmAfter: rep.intMmAfter,
    verifyF2,
    disposition,
    perAxis: toAxisRows(rep),
  }
  return { row, ships, solved: rep.solved }
}

/* ------------------------------------ artifacts */

function f2Vec(m: number): string {
  return Array.from({ length: N4 }, (_, i) => (m >> i) & 1).join(", ")
}

/** Emit attempts/M8S1_scheme.ts for a dual-verified (F_2 and Q) witness. */
export function writeScheme(terms: readonly F2Term[]): void {
  const body = [
    `/** M8-S1 altsupRest exact ship: CONSISTENT rank-47 support, verifies over F_2 and Q. */`,
    `import type { Scheme } from "../types"`,
    `export const scheme: Scheme = {`,
    `  n: 4,`,
    `  triples: [`,
    ...terms.map((t) => `    { u: [${f2Vec(t.u)}], v: [${f2Vec(t.v)}], w: [${f2Vec(t.w)}] },`),
    `  ],`,
    `}`,
    ``,
  ]
  writeFileSync(SCHEME_PATH, body.join("\n"), "utf8")
}

/* ------------------------------------ driver */

/**
 * Re-derive the R141 census, skip its 100 retired supports, exact-solve every
 * remaining support, and checkpoint the results. Deterministic and idempotent.
 */
export function runSweep(): SweepResult {
  const retiredHashes = readRetiredHashes()
  const retiredSet = new Set(retiredHashes)
  const census = enumerateAlgebraicSupports()
  const skipped = census.filter((e) => retiredSet.has(e.hash))
  const todo = census.filter((e) => !retiredSet.has(e.hash))

  const floorSeedConsistent = solveSupport(seedF2()).consistent
  const firstRetired = skipped[0]
  const retiredInconsistent =
    firstRetired === undefined
      ? false
      : !solveSupport(firstRetired.masks.map(([u, v, w]) => ({ u, v, w }))).consistent

  const bySource: Record<string, number> = {}
  const solved: SupportRow[] = []
  const lines: string[] = []
  let consistent = 0
  let shipped: SupportRow | null = null
  let shipTerms: F2Term[] | null = null

  lines.push(
    JSON.stringify({
      kind: "start",
      task: TASK_ID,
      field: FIELD,
      n: 4,
      targetRank: TARGET_RANK,
      census: census.length,
      r141Retired: retiredSet.size,
      skippedToR141: skipped.length,
      queued: todo.length,
      controls: {
        floorSeedConsistent,
        retiredHash: firstRetired?.hash ?? null,
        retiredInconsistent,
      },
    }),
  )

  for (const e of todo) {
    const one = solveOne(e)
    solved.push(one.row)
    bySource[e.source] = (bySource[e.source] ?? 0) + 1
    if (one.row.mmAfter === 0) consistent++
    if (one.ships && shipped === null) {
      shipped = one.row
      shipTerms = [...one.solved]
    }
    lines.push(JSON.stringify(one.row))
  }

  const summary: Summary = {
    kind: "summary",
    task: TASK_ID,
    field: FIELD,
    n: 4,
    targetRank: TARGET_RANK,
    census: census.length,
    r141Retired: retiredSet.size,
    skippedToR141: skipped.length,
    solved: solved.length,
    unresolved: todo.length - solved.length,
    consistent,
    shipped: shipped === null ? null : shipped.hash,
    verdict: shipped === null ? VERDICT_BOUNDED : VERDICT_SHIPPED,
    bySource,
    controls: {
      floorSeedConsistent,
      retiredHash: firstRetired?.hash ?? null,
      retiredInconsistent,
    },
    note: "exact F_2 solve of every R141_altsup support not already retired by R141; bounded sweep, no exhaustion or impossibility claimed; unresolved rows are UNRESOLVED, never refutations",
  }
  lines.push(JSON.stringify(summary))

  writeFileSync(NDJSON, `${lines.join("\n")}\n`, "utf8")
  writeFileSync(SUMMARY_JSON, `${JSON.stringify(summary, null, 2)}\n`, "utf8")
  if (shipped !== null && shipTerms !== null) writeScheme(shipTerms)

  return { census, skipped, solved, summary }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const res = runSweep()
    const s = res.summary
    console.log(
      `M8S1_altsupRest census=${s.census} skippedToR141=${s.skippedToR141} solved=${s.solved} unresolved=${s.unresolved} consistent=${s.consistent} verdict=${s.verdict}`,
    )
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
