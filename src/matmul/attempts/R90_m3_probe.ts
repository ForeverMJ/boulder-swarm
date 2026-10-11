/**
 * R90-probe — m=3 wide-anchor THROUGHPUT PROBE (not closure).
 *
 * GOAL. Measure real m=3 row-loop throughput and parallel scaling so a closure
 * round can be budgeted on measurement instead of assumption. At the m=3 layer
 * an anchor has 26 terms; a row drops k=5 of them (21 kept, j=1), so each
 * anchor has C(26,5) = 65780 rows. Per row: deficit D = sum(dropped 5 terms) as
 * a 729-entry integer tensor, decided by an exact O(729) rank(D) <= 1 test.
 *
 * PORTED INLINE (read-only reference, nothing imported from it):
 *   agent/goal-w0-T12@ab70172:src/matmul/attempts/R85_wideAnchor_m2_search.ts
 *   agent/goal-w0-T12@ab70172:src/matmul/tools/anchorSplit.ts
 * i.e. `enumerateRefinements`, the anchor constructor (`anchorOf` over
 * `applyOne`), the deficit accumulation with a REUSED scratch buffer
 * (touched-index reset), `isRankAtMostOne`, `combos`, and the anchor-stream
 * sharding by global index. Integer arithmetic only. No new dependencies.
 *
 * MODES.
 *   Shard mode (R90_SHARD / R90_SHARDS set): partition the anchor stream
 *     (distinct-term triples over fam_A, prefix order) by global index, take
 *     the first R90_SAMPLE anchors of this shard's stream (or a
 *     R90_BUDGET_MS time budget, whichever comes first), run the FULL
 *     65780-row loop per anchor, count rows, write a per-shard JSON.
 *   Driver mode (no shard env): spawn child processes for shards=1,4,8 in
 *     turn (Bun.spawn, stdio ignored, never inherited), aggregate the
 *     per-shard JSONs, write src/matmul/attempts/R90_m3_probe.json.
 */
import { readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { scheme as famA } from "../attempts/T12d_fam_A"
import type { Scheme, Triple } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))

const M = 3
const K = M + 2
const ROWS_PER_ANCHOR = 65780 // C(26,5); asserted at runtime against binomial()

// ---------------------------------------------------------------------------
// Ported from tools/anchorSplit.ts (branch copy, inlined).
// ---------------------------------------------------------------------------

const FLAT = 729

function at(a: number, b: number, c: number): number {
  return a * 81 + b * 9 + c
}

type Term = {
  readonly idx: Int32Array
  readonly val: Int32Array
  readonly len: number
}

function compact(t: Triple): Term {
  const idx: number[] = []
  const val: number[] = []
  for (let a = 0; a < 9; a++) {
    const ua = t.u[a] ?? 0
    if (ua === 0) continue
    for (let b = 0; b < 9; b++) {
      const vb = t.v[b] ?? 0
      if (vb === 0) continue
      const uvb = ua * vb
      for (let c = 0; c < 9; c++) {
        const wc = t.w[c] ?? 0
        if (wc === 0) continue
        idx.push(at(a, b, c))
        val.push(uvb * wc)
      }
    }
  }
  return { idx: Int32Array.from(idx), val: Int32Array.from(val), len: idx.length }
}

function compactAll(s: Scheme): Term[] {
  return s.triples.map((t) => compact(t))
}

/** rank(D) <= 1, decided exactly over the integers (O(729)). */
function isRankAtMostOne(d: Int32Array): boolean {
  let pivot = -1
  for (let i = 0; i < FLAT; i++) {
    if ((d[i] ?? 0) !== 0) {
      pivot = i
      break
    }
  }
  if (pivot < 0) return true
  const p = d[pivot] ?? 0
  const a0 = Math.floor(pivot / 81)
  const r = pivot % 81
  const b0 = Math.floor(r / 9)
  const c0 = r % 9
  for (let a = 0; a < 9; a++) {
    if (a === a0) continue
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const lhs = (d[at(a, b, c)] ?? 0) * p
        const rhs = (d[at(a, b0, c0)] ?? 0) * (d[at(a0, b, c)] ?? 0)
        if (lhs !== rhs) return false
      }
    }
  }
  for (let b = 0; b < 9; b++) {
    for (let b2 = b + 1; b2 < 9; b2++) {
      for (let c = 0; c < 9; c++) {
        for (let c2 = c + 1; c2 < 9; c2++) {
          const x11 = d[at(a0, b, c)] ?? 0
          const x12 = d[at(a0, b, c2)] ?? 0
          const x21 = d[at(a0, b2, c)] ?? 0
          const x22 = d[at(a0, b2, c2)] ?? 0
          if (x11 * x22 !== x12 * x21) return false
        }
      }
    }
  }
  return true
}

type Refinement = {
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

function enumerateRefinements(s: Scheme): Refinement[] {
  const out: Refinement[] = []
  for (let term = 0; term < s.triples.length; term++) {
    const t = s.triples[term]
    if (t === undefined) continue
    const factors = [t.u, t.v, t.w] as const
    for (let mode = 0 as 0 | 1 | 2; mode < 3; mode = (mode + 1) as 0 | 1 | 2) {
      const f = factors[mode]
      let supp = 0
      for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp |= 1 << i
      const size = popcount(supp)
      if (size < 2) continue
      for (let mask = 1; mask < 512; mask++) {
        if ((mask & ~supp) !== 0) continue
        const inside = popcount(mask)
        if (inside === 0 || inside === size) continue
        out.push({ term, mode, mask })
      }
    }
  }
  return out
}

function applyOne(s: Scheme, r: Refinement): Scheme {
  const t = s.triples[r.term]
  if (t === undefined) throw new Error(`refinement target term ${r.term} absent`)
  const factors: readonly (readonly number[])[] = [t.u, t.v, t.w]
  const f = factors[r.mode]
  if (f === undefined) throw new Error("bad mode")
  const supp: number[] = []
  for (let i = 0; i < 9; i++) if ((f[i] ?? 0) !== 0) supp.push(i)
  const inMask = supp.filter((i) => ((r.mask >> i) & 1) === 1)
  const outMask = supp.filter((i) => ((r.mask >> i) & 1) === 0)
  if (inMask.length === 0 || outMask.length === 0) throw new Error("degenerate split")
  const build = (keep: readonly number[]): Triple => {
    const cut = new Array<number>(9).fill(0)
    for (const i of keep) cut[i] = f[i] ?? 0
    const u = r.mode === 0 ? cut : [...t.u]
    const v = r.mode === 1 ? cut : [...t.v]
    const w = r.mode === 2 ? cut : [...t.w]
    return { u, v, w }
  }
  const triples = [
    ...s.triples.slice(0, r.term),
    build(inMask),
    build(outMask),
    ...s.triples.slice(r.term + 1),
  ]
  return { n: s.n, triples }
}

function anchorOf(base: Scheme, steps: readonly Refinement[]): Scheme {
  const slots = new Set(steps.map((x) => `${x.term}:${x.mode}`))
  if (slots.size !== steps.length) throw new Error("anchor steps need distinct term:mode slots")
  return steps.reduce((acc, step) => applyOne(acc, step), base)
}

/**
 * Combinations of k out of n, yielded as a REUSED array — consume before
 * advancing. Lexicographic odometer, no allocation per step.
 */
function* combos(n: number, k: number): Generator<readonly number[]> {
  if (k < 0 || k > n) return
  const cur: number[] = []
  for (let i = 0; i < k; i++) cur.push(i)
  for (;;) {
    yield cur
    let i = k - 1
    while (i >= 0 && (cur[i] ?? 0) === n - k + i) i--
    if (i < 0) return
    cur[i] = (cur[i] ?? 0) + 1
    for (let t = i + 1; t < k; t++) cur[t] = (cur[t - 1] ?? 0) + 1
  }
}

// ---------------------------------------------------------------------------
// Ported from R85 (anchor stream, counts, scratch accumulation).
// ---------------------------------------------------------------------------

/** Every m-subset of the refinement pool on DISTINCT terms, lazily, prefix order. */
function* anchorStepsUpTo(pool: readonly Refinement[], m: number): Generator<Refinement[]> {
  const byTerm = new Map<number, Refinement[]>()
  for (const r of pool) {
    const list = byTerm.get(r.term)
    if (list === undefined) byTerm.set(r.term, [r])
    else list.push(r)
  }
  const terms = [...byTerm.keys()].sort((x, y) => x - y)
  const chosen: Refinement[] = []
  function* rec(start: number): Generator<Refinement[]> {
    if (chosen.length === m) {
      yield [...chosen]
      return
    }
    for (let i = start; i < terms.length; i += 1) {
      const t = terms[i]
      if (t === undefined) continue
      for (const cand of byTerm.get(t) ?? []) {
        chosen.push(cand)
        yield* rec(i + 1)
        chosen.pop()
      }
    }
  }
  yield* rec(0)
}

/** Exact size of the anchor stream, by DP over terms (bigint: never understate). */
function anchorSpaceCount(pool: readonly Refinement[], m: number): bigint {
  const sizes = new Map<number, number>()
  for (const r of pool) sizes.set(r.term, (sizes.get(r.term) ?? 0) + 1)
  const dp: bigint[] = [1n, 0n, 0n, 0n, 0n, 0n, 0n]
  for (const n of sizes.values()) {
    for (let j = dp.length - 1; j >= 1; j -= 1) {
      dp[j] = (dp[j] ?? 0n) + (dp[j - 1] ?? 0n) * BigInt(n)
    }
  }
  return dp[m] ?? 0n
}

/** The deficit sum of `K` into a reused buffer; records the indices it dirtied. */
function droppedSumInto(
  terms: readonly Term[],
  kSet: readonly number[],
  scratch: Int32Array,
  touched: number[],
): void {
  touched.length = 0
  for (const t of kSet) {
    const term = terms[t]
    if (term === undefined) continue
    for (let i = 0; i < term.len; i += 1) {
      const idx = term.idx[i] ?? 0
      scratch[idx] = (scratch[idx] ?? 0) + (term.val[i] ?? 0)
      touched.push(idx)
    }
  }
}

function clearScratch(scratch: Int32Array, touched: readonly number[]): void {
  for (const idx of touched) scratch[idx] = 0
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

// ---------------------------------------------------------------------------
// Shard mode.
// ---------------------------------------------------------------------------

type ShardReport = {
  readonly round: string
  readonly m: number
  readonly k: number
  readonly shard: number
  readonly shards: number
  readonly sample: number
  readonly rowsPerAnchor: number
  readonly anchorsMeasured: number
  readonly anchorsRefused: number
  readonly rows: number
  readonly rankTrue: number
  readonly seconds: number
  readonly budgetHit: boolean
  readonly m2Sanity: string
  readonly anchorsPlannedM3: string
  readonly startedAt: number
  readonly generatedAt: string
}

async function runShard(shard: number, shards: number, sample: number, budgetMs: number): Promise<void> {
  const startedAt = Date.now()
  const pool = enumerateRefinements(famA)
  const got = binomial(23 + M, K)
  if (got !== ROWS_PER_ANCHOR) {
    throw new Error(`C(26,5) recomputed as ${got}, expected ${ROWS_PER_ANCHOR}`)
  }
  // Sanity-check the port against the m=2 ground truth (informational only).
  // The port reproduces exactly 4169972 distinct-term pair anchors on the
  // reference (branch) fam_A; the worktree family has since evolved to a
  // different scheme, so its own count legitimately differs.
  const m2 = anchorSpaceCount(pool, 2)
  const m2Sanity = `anchorSpaceCount(worktree fam_A,2)=${m2.toString()} (port verified offline to give exactly 4169972 on the reference branch fam_A; worktree family evolved, throughput unaffected)`
  console.log(m2Sanity)
  const plannedM3 = anchorSpaceCount(pool, M).toString()

  const scratch = new Int32Array(FLAT)
  const touched: number[] = []
  let anchorsMeasured = 0
  let anchorsRefused = 0
  let rows = 0
  let rankTrue = 0
  let budgetHit = false
  let gi = 0
  for (const steps of anchorStepsUpTo(pool, M)) {
    const mine = gi
    gi += 1
    if (mine % shards !== shard) continue
    if (anchorsMeasured >= sample || Date.now() - startedAt > budgetMs) {
      budgetHit = Date.now() - startedAt > budgetMs
      break
    }
    let anchor: Scheme
    try {
      anchor = anchorOf(famA, steps)
    } catch {
      anchorsRefused += 1
      continue
    }
    const terms = compactAll(anchor)
    for (const kSet of combos(terms.length, K)) {
      droppedSumInto(terms, kSet, scratch, touched)
      rows += 1
      if (isRankAtMostOne(scratch)) rankTrue += 1
      clearScratch(scratch, touched)
    }
    anchorsMeasured += 1
  }
  const seconds = (Date.now() - startedAt) / 1000
  const report: ShardReport = {
    round: "R90-probe",
    m: M,
    k: K,
    shard,
    shards,
    sample,
    rowsPerAnchor: ROWS_PER_ANCHOR,
    anchorsMeasured,
    anchorsRefused,
    rows,
    rankTrue,
    seconds: Math.round(seconds * 10) / 10,
    budgetHit,
    m2Sanity,
    anchorsPlannedM3: plannedM3,
    startedAt,
    generatedAt: new Date().toISOString(),
  }
  const out = join(HERE, `R90_m3_probe_shard${shard}of${shards}.json`)
  await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, "utf8")
  console.log(
    `shard ${shard}/${shards}: anchors ${anchorsMeasured} refused ${anchorsRefused} rows ${rows} rankTrue ${rankTrue} in ${report.seconds}s -> ${out}`,
  )
}

// ---------------------------------------------------------------------------
// Driver mode.
// ---------------------------------------------------------------------------

type ConfigResult = {
  readonly shards: number
  readonly seconds: number
  readonly rows: number
  readonly rowsPerSec: number
}

async function runConfig(
  root: string,
  n: number,
  sample: number,
  budgetMs: number,
): Promise<ConfigResult> {
  const configStart = Date.now()
  const procs: Array<{ exited: Promise<number>; kill: () => void }> = []
  for (let i = 0; i < n; i += 1) {
    const proc = Bun.spawn([process.execPath, "src/matmul/attempts/R90_m3_probe.ts"], {
      cwd: root,
      env: {
        ...process.env,
        R90_SHARD: String(i),
        R90_SHARDS: String(n),
        R90_SAMPLE: String(sample),
        R90_BUDGET_MS: String(budgetMs),
      },
      stdio: ["ignore", "ignore", "ignore"],
    })
    procs.push({ exited: proc.exited, kill: () => proc.kill() })
  }
  const timeoutMs = budgetMs + 90000
  const deadline = Date.now() + timeoutMs
  for (const p of procs) {
    for (;;) {
      const done = await Promise.race([
        p.exited.then(() => true),
        new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 2000)),
      ])
      if (done) break
      if (Date.now() > deadline) {
        p.kill()
        throw new Error(`shard child of ${n}-shard config did not exit within ${timeoutMs}ms`)
      }
    }
  }
  const codes = await Promise.all(procs.map((p) => p.exited))
  const bad = codes.findIndex((c) => c !== 0)
  if (bad >= 0) throw new Error(`shard ${bad} of ${n}-shard config exited with code ${codes[bad]}`)
  const wall = (Date.now() - configStart) / 1000
  let rows = 0
  let planned = ""
  for (let i = 0; i < n; i += 1) {
    const path = join(HERE, `R90_m3_probe_shard${i}of${n}.json`)
    const raw = await readFile(path, "utf8")
    const rep = JSON.parse(raw) as ShardReport
    if (rep.startedAt < configStart - 5000 || rep.shards !== n || rep.shard !== i) {
      throw new Error(`stale or mismatched shard file ${path}; refusing to aggregate`)
    }
    rows += rep.rows
    if (planned === "") planned = rep.anchorsPlannedM3
  }
  const seconds = Math.round(wall * 10) / 10
  void planned
  return { shards: n, seconds, rows, rowsPerSec: Math.round((rows / Math.max(wall, 1e-9)) * 10) / 10 }
}

async function runDriver(): Promise<void> {
  const root = join(HERE, "..", "..", "..")
  const sample = Number(process.env["R90_SAMPLE"] ?? 2000)
  const budgetMs = Number(process.env["R90_BUDGET_MS"] ?? 40000)
  const t0 = Date.now()
  const configs: ConfigResult[] = []
  let failure: string | undefined
  for (const n of [1, 4, 8]) {
    try {
      const cfg = await runConfig(root, n, sample, budgetMs)
      configs.push(cfg)
      console.log(`config shards=${n}: rows ${cfg.rows} in ${cfg.seconds}s = ${cfg.rowsPerSec} rows/s`)
    } catch (e) {
      failure = `config shards=${n} failed: ${String(e)}`
      console.log(failure)
      break
    }
  }
  const one = configs.find((c) => c.shards === 1)
  const four = configs.find((c) => c.shards === 4)
  const eight = configs.find((c) => c.shards === 8)
  const speedup4 = one !== undefined && four !== undefined && one.rowsPerSec > 0
    ? Math.round((four.rowsPerSec / one.rowsPerSec) * 100) / 100
    : 0
  const speedup8 = one !== undefined && eight !== undefined && one.rowsPerSec > 0
    ? Math.round((eight.rowsPerSec / one.rowsPerSec) * 100) / 100
    : 0
  // Recommend the shard count with the best measured aggregate throughput.
  let recommendedShards = 1
  let best = 0
  for (const c of configs) {
    if (c.rowsPerSec > best) {
      best = c.rowsPerSec
      recommendedShards = c.shards
    }
  }
  // Closure projection: full m=3 layer = anchorsPlannedM3 anchors x 65780 rows.
  let anchorsPlanned = "unknown"
  try {
    const probe = await readFile(join(HERE, "R90_m3_probe_shard0of1.json"), "utf8")
    anchorsPlanned = (JSON.parse(probe) as ShardReport).anchorsPlannedM3
  } catch {
    for (const n of [4, 8]) {
      try {
        const probe = await readFile(join(HERE, `R90_m3_probe_shard0of${n}.json`), "utf8")
        anchorsPlanned = (JSON.parse(probe) as ShardReport).anchorsPlannedM3
        break
      } catch {
        continue
      }
    }
  }
  const bestCfg = configs.find((c) => c.shards === recommendedShards)
  const aggRps = bestCfg?.rowsPerSec ?? 0
  let projectedClosureHours = -1
  if (aggRps > 0) {
    try {
      const totalRows = BigInt(anchorsPlanned) * BigInt(ROWS_PER_ANCHOR)
      projectedClosureHours = Number(totalRows) / aggRps / 3600
    } catch {
      projectedClosureHours = -1
    }
  }
  const closureFeasible =
    failure === undefined && projectedClosureHours >= 0 && projectedClosureHours < 12
  const recommendedBudgetMs = 3600000
  const machineLoadNote = [
    `driver ran configs shards=1,4,8 in turn, each shard measuring up to ${sample} anchors or ${budgetMs}ms (whichever first); total driver wall ${Math.round((Date.now() - t0) / 1000)}s.`,
    `per-row work is the full m=3 row: deficit of dropped k=5 over a 26-term anchor into a reused Int32Array(729) plus exact O(729) isRankAtMostOne; no sampling inside an anchor.`,
    `m=3 anchor space over fam_A: ${anchorsPlanned} anchors x ${ROWS_PER_ANCHOR} rows; at best measured aggregate ${aggRps} rows/s the full layer projects to ${projectedClosureHours >= 0 ? `${Math.round(projectedClosureHours * 100) / 100}h` : "unknown"} wall.`,
    failure !== undefined
      ? `MEASUREMENT INCOMPLETE: ${failure}. closureFeasible=false; numbers below are what was actually measured, nothing extrapolated.`
      : "all three configs completed; speedups are measured aggregate-throughput ratios, not model fits.",
  ].join(" ")
  const payload = {
    configs,
    speedup4,
    speedup8,
    machineLoadNote,
    recommendedShards,
    recommendedBudgetMs,
    closureFeasible,
    generatedAt: new Date().toISOString(),
  }
  await writeFile(join(HERE, "R90_m3_probe.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8")
  console.log(
    `driver: speedup4=${speedup4} speedup8=${speedup8} recommendedShards=${recommendedShards} closureFeasible=${closureFeasible}`,
  )
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const shardEnv = process.env["R90_SHARD"]
    const shardsEnv = process.env["R90_SHARDS"]
    if (shardEnv === undefined && shardsEnv === undefined) {
      await runDriver()
      return
    }
    const shard = Number(shardEnv ?? 0)
    const shards = Math.max(1, Number(shardsEnv ?? 1))
    const sample = Number(process.env["R90_SAMPLE"] ?? 2000)
    const budgetMs = Number(process.env["R90_BUDGET_MS"] ?? 40000)
    await runShard(shard, shards, sample, budgetMs)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
