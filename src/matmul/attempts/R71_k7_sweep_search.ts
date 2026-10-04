/**
 * R71 — Lane A continuation of R70's k=7 band. WHY A NEW DRIVER. R70's `main()` always restarts
 * `dropSets` from index 0, truncates `R70_k7_band.json.ndjson` and overwrites `R70_k7_band.json`,
 * so running it again would destroy the R70 record (CAMPAIGN.md R70) rather than extend it. R71
 * therefore READS the R70 cursors, resumes past them, shards the band across processes, and writes
 * its own round-forward artifacts. Nothing R70 recorded is edited or overwritten.
 *
 * WHAT IS REUSED, VERBATIM. The refutation ladder is R70's, unchanged and imported, not rebuilt:
 * `screenDropSet` (modpFlatDim -> exact rational flatDim -> clique -> minBoxCover), `dropSets`
 * (lazy lexicographic k-subsets), `maxAdded` (j = k - (baseTerms - 22)), and `BASES`. Every stage is
 * field-free and every kill is a PROVEN lower bound on the decomposition rank of the deficit, so a
 * refuted row is refuted over Z and every F_p as well as over Q/R.
 *
 * THE ONE DELIBERATE CHANGE, AND ITS PRICE. R70 spent up to `maxRowMs` (default 20000 ms) on the
 * expensive box-cover fallback inside the sweep: 136 T12d_fam_A rows cost 148518 ms, ~1.1 s/row,
 * because a handful of rows reached `minBoxCover` at 400000 nodes each. That is the wrong place to
 * spend a wall clock. R71 SPLITS the work in two phases:
 *   phase 1 (`--phase sweep`, parallel, one shard per core): the cheap stages plus a SHORT
 *     `maxRowMs` ceiling. A row that runs out of time keeps every bound it already proved and is
 *     emitted UNRESOLVED. This is the honest verdict for a budget-limited row and it costs ~1.5 s.
 *   phase 2 (`R71_k7_adjudicate_search.ts`): every UNRESOLVED row from all shards re-enters the SAME
 *     ladder with a large node budget and many clique restarts, off the sweep's critical path.
 * So a budget-limited row is never silently dropped and never silently counted as refuted; it is
 * carried forward by name into phase 2.
 *
 * SHARDING AND RESUME, precisely. Within a base the rows are indexed by their lexicographic rank t.
 * Shard s of n processes exactly the rows with `(t + baseIndex) % n === s`, starting at
 * `t0 = max(R70.screened, shardCursor)` where `shardCursor` is this shard's own checkpoint. A
 * checkpoint is only appended after the shard has finished counting the rows it just handled, so a
 * checkpoint is never ahead of the work. Re-running a shard re-walks the generator (no arithmetic)
 * from 0 to `t0` and then resumes; nothing is screened twice and nothing is skipped.
 *
 * HONEST LIMITS, stated before the numbers.
 *   - This screens the drop-k/add-j neighbourhood of the NAMED bases only. It says nothing about
 *     repairs that modify surviving terms, add non-rank-1 factors, or start from another base, and
 *     nothing about rank 22 itself.
 *   - A row that survives every stage is UNRESOLVED, not a witness. A band is NOT closed while any
 *     row is UNRESOLVED or UNSCREENED, and this driver prints both sets by name.
 *   - A bounded sweep is a bounded sweep: `unscreened > 0` is reported as UNSCREENED, never as a
 *     refutation, and never as a proof that the remaining rows are dead.
 *   - 19 <= R <= 23 over Q/R is untouched by this round.
 *
 * Exactness: no float is compared for equality anywhere. modpFlatDim is integer arithmetic mod p
 * with p < 2^24; flatDim is exact BigInt rational elimination; clique and cover are 9-bit mask ints.
 */

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { BASES, type Row, dropSets, maxAdded, screenDropSet, type ScreenOptions } from "./R70_k7_band_search"
import { baseDeficit } from "../tools/modpFlatDim"
import type { Triple } from "../tools/absorbRepair"

const HERE = dirname(fileURLToPath(import.meta.url))

type R70Report = {
  readonly round: string
  readonly k: number
  readonly bases: readonly {
    readonly base: string
    readonly baseTerms: number
    readonly j: number
    readonly band: number
    readonly screened: number
    readonly refuted: number
    readonly unresolved: readonly (readonly number[])[]
    readonly unscreenedFrom: number | null
  }[]
  readonly totals: { readonly band: number; readonly screened: number; readonly unscreened: number }
}

export type Cursor = {
  readonly base: string
  readonly baseTerms: number
  readonly j: number
  readonly band: number
  readonly terms: readonly Triple[]
  readonly startFrom: number
}

export function cursorsFrom(r70: R70Report): readonly Cursor[] {
  return BASES.map((b, i) => {
    const rec = r70.bases[i]
    if (!rec || rec.base !== b.name) {
      throw new Error(`R70 base order changed: expected ${b.name} at index ${i}, got ${rec?.base ?? "none"}`)
    }
    const terms = b.scheme.triples as readonly Triple[]
    if (terms.length !== rec.baseTerms) throw new Error(`${b.name} term count moved: ${terms.length} vs R70 ${rec.baseTerms}`)
    return {
      base: b.name,
      baseTerms: rec.baseTerms,
      j: maxAdded(terms.length, r70.k),
      band: rec.band,
      terms,
      startFrom: rec.screened,
    }
  })
}

export type ShardProgress = {
  readonly shard: number
  readonly shards: number
  readonly cursors: readonly number[]
}

export async function loadProgress(path: string, shards: number, nBases: number): Promise<number[]> {
  const zero = new Array<number>(nBases).fill(0)
  let text: string
  try {
    text = await readFile(path, "utf8")
  } catch (e) {
    // A missing checkpoint is the cold-start case, not an error: the shard simply starts from the
    // R70 cursors.
    if (e instanceof Error && e.message.includes("ENOENT")) return zero
    throw e
  }
  let best = zero
  for (const line of text.split("\n")) {
    if (line.length === 0) continue
    let rec: { shard?: number; shards?: number; cursors?: readonly number[] }
    try {
      rec = JSON.parse(line) as { shard?: number; shards?: number; cursors?: readonly number[] }
    } catch {
      // A checkpoint line torn by a kill is not a checkpoint; the shard simply resumes from the
      // previous complete line, which is safe because a checkpoint is never ahead of the work.
      continue
    }
    if (rec.shard === undefined || rec.shards !== shards || !Array.isArray(rec.cursors)) continue
    if (rec.cursors.length !== nBases) continue
    for (let i = 0; i < nBases; i += 1) best[i] = Math.max(best[i] ?? 0, rec.cursors[i] ?? 0)
  }
  return best
}

export type SweepTally = {
  modp: number
  flatDim: number
  clique: number
  boxLower: number
  boxExact: number
  unres: number
  rows: number
}

function emptyTally(): SweepTally {
  return { modp: 0, flatDim: 0, clique: 0, boxLower: 0, boxExact: 0, unres: 0, rows: 0 }
}

function bump(t: SweepTally, row: Row): void {
  t.rows += 1
  if (row.by === "modp") t.modp += 1
  else if (row.by === "flatDim") t.flatDim += 1
  else if (row.by === "clique") t.clique += 1
  else if (row.by === "boxCover-lower") t.boxLower += 1
  else if (row.by === "boxCover-exact") t.boxExact += 1
  else t.unres += 1
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const argv = process.argv.slice(2)
    const arg = (flag: string, dflt: number): number => {
      const i = argv.indexOf(flag)
      const v = i >= 0 ? argv[i + 1] : undefined
      return v === undefined ? dflt : Number(v)
    }
    const flag = (name: string): boolean => argv.includes(name)
    const shard = arg("--shard", 0)
    const shards = arg("--shards", 1)
    const budgetSeconds = arg("--budget-seconds", 900)
    const chunk = arg("--chunk", 5000)
    const k = arg("--k", 7)
    const opts: ScreenOptions = {
      maxNodes: arg("--max-nodes", 200000),
      restarts: arg("--restarts", 1),
      maxRowMs: arg("--max-row-ms", 1500),
    }
    const r70 = JSON.parse(await readFile(join(HERE, `R70_k${k}_band.json`), "utf8")) as R70Report
    const cursors = cursorsFrom(r70)
    const tag = shards > 1 ? `_s${shard}of${shards}` : ""
    const ckpt = join(HERE, `R71_k${k}_sweep${tag}.ndjson`)
    const unresPath = join(HERE, `R71_k${k}_unresolved${tag}.ndjson`)
    const summaryPath = join(HERE, `R71_k${k}_sweep${tag}.json`)
    if (shard === 0 && shards > 1) await mkdir(HERE, { recursive: true })

    const prior = await loadProgress(ckpt, shards, cursors.length)
    const deadline = Date.now() + budgetSeconds * 1000
    const live = cursors.map((c, b) => ({
      b,
      c,
      t0: Math.max(c.startFrom, prior[b] ?? 0),
      it: dropSets(c.baseTerms, k),
      tally: emptyTally(),
      next: Math.max(c.startFrom, prior[b] ?? 0),
      maxRankFloor: 0,
      budgetHit: 0,
    }))
    for (const L of live) {
      for (let t = 0; t < L.t0; t += 1) if (L.it.next().done) break
    }

    const totals = emptyTally()
    let stopped = false
    while (!stopped && live.some((L) => L.t0 < L.c.band)) {
      for (const L of live) {
        if (stopped || L.t0 >= L.c.band) continue
        const pending: string[] = []
        let n = 0
        for (;;) {
          if (n >= chunk || Date.now() > deadline) break
          const nx = L.it.next()
          if (nx.done) break
          const t = L.next
          L.next += 1
          if ((t + L.b) % shards !== shard) continue
          const row = screenDropSet(L.c.terms, baseDeficitOf(L), L.c.base, k, nx.value, opts)
          bump(L.tally, row)
          if (row.rankFloor > L.maxRankFloor) L.maxRankFloor = row.rankFloor
          if (row.budgetHit) L.budgetHit += 1
          if (!row.refuted) pending.push(JSON.stringify({ ...row, lex: t }))
          n += 1
        }
        L.t0 = L.next
        if (pending.length > 0) await appendFile(unresPath, `${pending.join("\n")}\n`)
        totals.rows += L.tally.rows
        totals.modp += L.tally.modp
        totals.flatDim += L.tally.flatDim
        totals.clique += L.tally.clique
        totals.boxLower += L.tally.boxLower
        totals.boxExact += L.tally.boxExact
        totals.unres += L.tally.unres
        await appendFile(
          ckpt,
          `${JSON.stringify({
            shard,
            shards,
            k,
            at: Date.now(),
            // Only now, after every row of this chunk has been counted, is the cursor moved.
            cursors: live.map((x) => x.next),
            tally: L.tally,
            unresolvedTotal: L.tally.unres,
            budgetHit: L.budgetHit,
            maxRankFloor: L.maxRankFloor,
          })}\n`,
        )
        if (Date.now() > deadline) stopped = true
      }
    }

    const progress = await loadProgress(ckpt, shards, cursors.length)
    const summary = {
      round: "R71",
      k,
      shard,
      shards,
      maxNodes: opts.maxNodes,
      restarts: opts.restarts,
      maxRowMs: opts.maxRowMs,
      bases: cursors.map((c, b) => ({
        base: c.base,
        baseTerms: c.baseTerms,
        j: c.j,
        band: c.band,
        resumedFrom: c.startFrom,
        sweptTo: progress[b] ?? c.startFrom,
        unscreened: c.band - Math.max(progress[b] ?? 0, c.startFrom),
      })),
      totals,
      budgetHitRows: live.reduce((a, x) => a + x.budgetHit, 0),
      maxRankFloor: live.reduce((a, x) => Math.max(a, x.maxRankFloor), 0),
      stoppedByBudget: stopped,
      honestLimits: [
        "Row screening only: the drop-k/add-j neighbourhood of the four named bases, nothing about rank 22 itself.",
        "A surviving row is UNRESOLVED, never a witness; phase 2 adjudicates it with a larger budget.",
        "unscreened > 0 means UNSCREENED, not refuted; a bounded sweep is a bounded sweep.",
        "19 <= R <= 23 over Q/R is untouched.",
      ],
    }
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`)
    console.log(`shard ${shard}/${shards}: ${totals.rows} rows; unresolved=${totals.unres}; unscreened=${summary.bases.reduce((a, x) => a + x.unscreened, 0)}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

/**
 * `baseDeficit` is a pure function of the base, so it is computed once per cursor and reused for
 * every row of that base instead of being rebuilt 245157 times.
 */
const defCache = new WeakMap<readonly Triple[], Int32Array>()
function baseDeficitOf(L: { readonly c: Cursor }): Int32Array {
  const hit = defCache.get(L.c.terms)
  if (hit) return hit
  const built = baseDeficit(L.c.terms)
  defCache.set(L.c.terms, built)
  return built
}

if (import.meta.main) {
  await main()
}
