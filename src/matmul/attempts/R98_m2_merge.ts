/**
 * R98-m2 merge — merge job for the R98 m=2 shard streams.
 *
 * The R98 layer screens rank-22 schemes sharing 21 terms with a
 * TWO-SUPPORT-SPLIT (m=2) refinement anchor over two bases, T12d_fam_A and
 * T12d_fam_B. At m=2 an anchor has 23+2=25 terms and a row drops k=m+2=4 of
 * them (21 kept, j=1), so every screened anchor contributes exactly
 * C(25,4)=12650 rows. Each row decides rank(D)<=1 for the dropped-term
 * deficit D exactly over the integers. Field discipline: integer arithmetic
 * throughout, so a refutation holds over Q, Z and every F_p alike. Bounds
 * untouched: 19 <= R <= 23 over Q/R, 21 <= R_F2 <= 23 over F_2.
 *
 * SHARD CONTRACT (what an R98 shard file must contain):
 *   file: R98_m2_<base>_shard<shard>of<shards>.json
 *   base: "T12d_fam_A" (alias "famA") or "T12d_fam_B" (alias "famB")
 *   m: 2; anchorsPlanned: bigint-as-string over the CURRENT code revision;
 *   rowsPerAnchor = C(23+m, m+2); per-shard screened/refused/row counters;
 *   start/cursor (or start/resumeFrom) checkpoint; gating controls array;
 *   survivors array with anchor ("term:mode:mask|..."), drop, and the
 *   checker fields the screening run observed.
 *
 * MERGE GUARANTEES (checked in order; every failure is named, never hidden):
 *   1. every shard present and distinct (0..shards-1, filename matches body);
 *   2. totals reconcile: rowsScreened = refuted+survivor+undecided per shard,
 *      rowsScreened = screened*rowsPerAnchor, rowsSurvivor = survivors.length,
 *      rowsScreenedTotal + rowsUnscreened = rowsPlanned, and anchorsPlanned
 *      re-derived from the current code agrees with the shards;
 *   3. no checkpoint ahead of work (cursor/resumeFrom consistent with start
 *      and with the rows actually screened);
 *   4. gating controls green on every shard (a shard with no controls, or a
 *      red gating control, fails the merge);
 *   5. every survivor re-derived from its anchor+drop and re-verified with
 *      checker.verify; claimed fields must match the recomputation exactly;
 *   6. tools/verifyAll still ALL-CLAIMS-REPRODUCE (re-checked read-only:
 *      the four rank-23 schemes re-verified, every R*.json self-consistent).
 *
 * PARTITION (per base): closed rows (refuted) vs unresolved rows (undecided:
 * named shard-window targets for follow-up, NEVER counted as refutations)
 * vs unscreened anchors/rows (planned minus visited, with per-shard resume
 * cursors). Row-level identities of undecided rows are not recorded by the
 * shard instruments, so unresolved targets name the shard window, not the
 * row — what was not measured is recorded as not measured.
 */
import { readdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { checkArtifact } from "../tools/verifyAll"
import type { Scheme } from "../types"
import { scheme as t11 } from "./T11_solution"
import { scheme as t12variant } from "./T12_rank23_variant"
import { scheme as famAScheme } from "./T12d_fam_A"
import { scheme as famBScheme } from "./T12d_fam_B"
import {
  anchorOf as anchorOfA,
  anchorSpaceCount as anchorSpaceCountA,
  compactAll as compactAllA,
  droppedSum as droppedSumA,
  enumerateRefinements as enumerateRefinementsA,
  factorRank1 as factorRank1A,
} from "./R97_m2_famA_search"
import {
  anchorOf as anchorOfB,
  anchorSpaceCount as anchorSpaceCountB,
  compactAll as compactAllB,
  droppedSum as droppedSumB,
  enumerateRefinements as enumerateRefinementsB,
  factorRank1 as factorRank1B,
} from "./R97_m2_famB_search"

const HERE = dirname(fileURLToPath(import.meta.url))

export const ROUND = "R98-m2"
export const M = 2
export const BASE_RANK = 23
export const SHARD_PATTERN = /^R98_m2_(.+)_shard(\d+)of(\d+)\.json$/

export function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i += 1) r = (r * (n - i)) / (i + 1)
  return Math.round(r)
}

export function rowsPerAnchorFor(m: number): number {
  return binomial(BASE_RANK + m, m + 2)
}

export type ShardControl = {
  readonly name: string
  readonly pass: boolean
  readonly gating?: boolean
  readonly detail?: string
}

export type ShardSurvivor = {
  readonly anchor: string
  readonly drop: readonly number[]
  readonly candidateTerms?: number
  readonly checkerCorrect: boolean
  readonly checkerRank: number
  readonly mismatches: number
  readonly reason?: string
  readonly note?: string
  readonly base?: string
}

export type ShardInput = {
  readonly base: string
  readonly m?: number
  readonly shard: number
  readonly shards: number
  readonly anchorsPlanned: string | number
  readonly rowsPerAnchor: number
  readonly anchorsScreened?: number
  readonly anchorsCompleted?: number
  readonly anchorsVisited?: number
  readonly anchorsRefused?: number
  readonly rowsScreened: number
  readonly rowsRefuted: number
  readonly rowsSurvivor: number
  readonly rowsUndecided: number
  readonly start?: number
  readonly startCursor?: number
  readonly cursor?: number
  readonly resumeFrom?: number
  readonly timedOut?: boolean
  readonly controls?: readonly ShardControl[]
  readonly survivors?: readonly ShardSurvivor[]
}

export type NormalizedShard = {
  readonly file: string
  readonly base: string
  readonly m: number
  readonly shard: number
  readonly shards: number
  readonly planned: bigint
  readonly rowsPerAnchor: number
  readonly screened: number
  readonly refused: number
  readonly visited: number
  readonly rowsScreened: number
  readonly rowsRefuted: number
  readonly rowsSurvivor: number
  readonly rowsUndecided: number
  readonly start: number
  readonly cursor: number
  readonly resumeExact: boolean
  readonly controls: readonly ShardControl[]
  readonly survivors: readonly ShardSurvivor[]
}

function isInt(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0
}

function parsePlanned(v: unknown): bigint | undefined {
  try {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return BigInt(v)
    if (typeof v === "string" && /^[0-9]+$/.test(v)) return BigInt(v)
    return undefined
  } catch {
    return undefined
  }
}

export function canonicalBase(base: string): "A" | "B" | undefined {
  if (base === "T12d_fam_A" || base === "famA" || base === "fam-A") return "A"
  if (base === "T12d_fam_B" || base === "famB" || base === "fam-B") return "B"
  return undefined
}

export function plannedForBase(which: "A" | "B", m: number): bigint {
  if (which === "A") return anchorSpaceCountA(enumerateRefinementsA(famAScheme), m)
  return anchorSpaceCountB(enumerateRefinementsB(famBScheme), m)
}

export function normalizeShard(
  file: string,
  raw: unknown,
): { readonly ok: true; readonly shard: NormalizedShard } | { readonly ok: false; readonly problem: string } {
  if (typeof raw !== "object" || raw === null) return { ok: false, problem: `${file}: shard body is not an object` }
  const d = raw as Record<string, unknown>
  const base = d["base"]
  if (typeof base !== "string" || canonicalBase(base) === undefined) {
    return { ok: false, problem: `${file}: unknown or missing base ${JSON.stringify(base)}` }
  }
  const mRaw = d["m"]
  const m = mRaw === undefined ? M : mRaw
  if (m !== M) return { ok: false, problem: `${file}: m=${JSON.stringify(mRaw)}, this merge only covers m=${M}` }
  const shard = d["shard"]
  const shards = d["shards"]
  if (!isInt(shard) || !isInt(shards) || shards < 1 || shard >= shards) {
    return { ok: false, problem: `${file}: bad shard id ${JSON.stringify(shard)} of ${JSON.stringify(shards)}` }
  }
  const planned = parsePlanned(d["anchorsPlanned"])
  if (planned === undefined) return { ok: false, problem: `${file}: anchorsPlanned is not a non-negative integer` }
  const rowsPerAnchor = d["rowsPerAnchor"]
  if (!isInt(rowsPerAnchor)) return { ok: false, problem: `${file}: rowsPerAnchor is not an integer` }
  const screened = d["anchorsScreened"] ?? d["anchorsCompleted"] ?? d["anchorsVisited"]
  const refused = d["anchorsRefused"] ?? 0
  const visitedRaw = d["anchorsVisited"]
  if (!isInt(screened) || !isInt(refused)) {
    return { ok: false, problem: `${file}: anchor counters missing (need screened/completed and refused)` }
  }
  const visited = isInt(visitedRaw) ? visitedRaw : screened + refused
  const rowsScreened = d["rowsScreened"]
  const rowsRefuted = d["rowsRefuted"]
  const rowsSurvivor = d["rowsSurvivor"]
  const rowsUndecided = d["rowsUndecided"]
  if (!isInt(rowsScreened) || !isInt(rowsRefuted) || !isInt(rowsSurvivor) || !isInt(rowsUndecided)) {
    return { ok: false, problem: `${file}: row counters must all be non-negative integers` }
  }
  const start = d["start"] ?? d["startCursor"] ?? 0
  const cursorRaw = d["cursor"] ?? d["resumeFrom"] ?? start
  const resumeExact = d["resumeFrom"] !== undefined
  if (!isInt(start) || !isInt(cursorRaw)) {
    return { ok: false, problem: `${file}: checkpoint (start/cursor/resumeFrom) must be non-negative integers` }
  }
  const controls = d["controls"] ?? []
  const survivors = d["survivors"] ?? []
  if (!Array.isArray(controls) || !Array.isArray(survivors)) {
    return { ok: false, problem: `${file}: controls and survivors must be arrays` }
  }
  return {
    ok: true,
    shard: {
      file,
      base,
      m,
      shard,
      shards,
      planned,
      rowsPerAnchor,
      screened,
      refused,
      visited,
      rowsScreened,
      rowsRefuted,
      rowsSurvivor,
      rowsUndecided,
      start,
      cursor: cursorRaw,
      resumeExact,
      controls: controls as readonly ShardControl[],
      survivors: survivors as readonly ShardSurvivor[],
    },
  }
}

export type StepTuple = { readonly term: number; readonly mode: 0 | 1 | 2; readonly mask: number }

export function parseAnchorSteps(anchor: string): StepTuple[] | undefined {
  if (anchor.length === 0) return undefined
  const out: StepTuple[] = []
  for (const part of anchor.split("|")) {
    const seg = part.split(":")
    if (seg.length !== 3) return undefined
    const term = Number(seg[0])
    const mode = Number(seg[1])
    const mask = Number(seg[2])
    if (!Number.isInteger(term) || term < 0 || !Number.isInteger(mask) || mask <= 0) return undefined
    if (mode !== 0 && mode !== 1 && mode !== 2) return undefined
    out.push({ term, mode: mode as 0 | 1 | 2, mask })
  }
  return out
}

export type ReverifyOutcome = {
  readonly ok: boolean
  readonly witness: boolean
  readonly reason: string
}

/**
 * Re-derive a survivor's candidate scheme from its anchor+drop with the same
 * instrument the screening runs use, then re-verify with checker.verify.
 * ok is true only when the recomputed (correct, rank, mismatches) triple
 * matches the shard's claimed fields exactly.
 */
export function reverifySurvivor(base: string, s: ShardSurvivor): ReverifyOutcome {
  const which = canonicalBase(base)
  if (which === undefined) return { ok: false, witness: false, reason: `unknown base ${JSON.stringify(base)}` }
  const steps = parseAnchorSteps(s.anchor)
  if (steps === undefined) return { ok: false, witness: false, reason: `unparseable anchor ${JSON.stringify(s.anchor)}` }
  if (!Array.isArray(s.drop) || s.drop.length !== M + 2) {
    return { ok: false, witness: false, reason: `drop must list exactly ${M + 2} indices` }
  }
  const drop = [...s.drop]
  try {
    const baseScheme: Scheme = which === "A" ? famAScheme : famBScheme
    const anchor = which === "A" ? anchorOfA(baseScheme, steps) : anchorOfB(baseScheme, steps)
    if (drop.some((t) => !Number.isInteger(t) || t < 0 || t >= anchor.triples.length)) {
      return { ok: false, witness: false, reason: `drop index out of range for a ${anchor.triples.length}-term anchor` }
    }
    if (new Set(drop).size !== drop.length) return { ok: false, witness: false, reason: "drop indices not distinct" }
    const terms = which === "A" ? compactAllA(anchor) : compactAllB(anchor)
    const deficit = which === "A" ? droppedSumA(terms, drop) : droppedSumB(terms, drop)
    const fac = which === "A" ? factorRank1A(deficit) : factorRank1B(deficit)
    const killed = new Set(drop)
    const triples = anchor.triples.filter((_, i) => !killed.has(i))
    if (fac !== undefined && fac.u.length > 0) triples.push({ u: fac.u, v: fac.v, w: fac.w })
    const cv = verify({ n: 3, triples })
    const witness = cv.correct && cv.rank <= 22
    const match =
      cv.correct === s.checkerCorrect && cv.rank === s.checkerRank && cv.mismatches === s.mismatches
    return {
      ok: match,
      witness,
      reason: match
        ? `recomputed rank${cv.rank}/mm${cv.mismatches}/correct=${cv.correct}, matches claim`
        : `claim correct=${s.checkerCorrect}/rank${s.checkerRank}/mm${s.mismatches} but recomputed correct=${cv.correct}/rank${cv.rank}/mm${cv.mismatches}`,
    }
  } catch (e) {
    return { ok: false, witness: false, reason: `re-derivation threw: ${String(e)}` }
  }
}

export type UnresolvedTarget = {
  readonly target: string
  readonly shard: number
  readonly anchorWindow: string
  readonly undecidedRows: number
}

export type BasePartition = {
  readonly base: string
  readonly m: number
  readonly shards: number
  readonly anchorsPlanned: string
  readonly anchorsVisited: number
  readonly anchorsUnscreened: string
  readonly rowsPlanned: string
  readonly rowsScreened: number
  readonly rowsRefuted: number
  readonly rowsSurvivor: number
  readonly rowsUndecided: number
  readonly rowsUnscreened: string
  readonly unresolvedTargets: readonly UnresolvedTarget[]
  readonly resume: readonly { readonly shard: number; readonly resumeFrom: number }[]
  readonly reverifiedSurvivors: number
  readonly witness: number
  readonly complete: boolean
}

export type ClaimsCheck = { readonly ok: boolean; readonly detail: string }

/**
 * Read-only re-derivation of the tools/verifyAll gate: the four exact rank-23
 * schemes must still verify, and every R*.json artifact in dir must still be
 * self-consistent. Writes nothing.
 */
export async function checkClaimsReproduce(dir: string): Promise<ClaimsCheck> {
  const problems: string[] = []
  const baselines: ReadonlyArray<readonly [string, Scheme]> = [
    ["T11_solution.ts", t11],
    ["T12_rank23_variant.ts", t12variant],
    ["T12d_fam_A.ts", famAScheme],
    ["T12d_fam_B.ts", famBScheme],
  ]
  for (const [file, s] of baselines) {
    const v = verify(s)
    if (!(v.correct && v.rank === BASE_RANK && v.mismatches === 0)) {
      problems.push(`${file}: rank${v.rank}/mm${v.mismatches}, expected rank23/mm0`)
    }
  }
  const files = (await readdir(dir)).filter((f) => /^R\d+.*\.json$/.test(f)).sort()
  for (const f of files) {
    const c = checkArtifact(await readFile(join(dir, f), "utf8"))
    if (!c.selfConsistent) problems.push(`${f}: ${c.note}`)
  }
  return {
    ok: problems.length === 0,
    detail:
      problems.length === 0
        ? `4/4 schemes exact rank23/mm0; ${files.length} artifacts self-consistent`
        : problems.join("; "),
  }
}

function checkShardCounts(s: NormalizedShard, problems: string[]): void {
  const id = `${s.file} (shard ${s.shard})`
  if (s.rowsRefuted + s.rowsSurvivor + s.rowsUndecided !== s.rowsScreened) {
    problems.push(
      `${id}: rowsScreened=${s.rowsScreened} != refuted(${s.rowsRefuted})+survivor(${s.rowsSurvivor})+undecided(${s.rowsUndecided})`,
    )
  }
  if (s.rowsSurvivor !== s.survivors.length) {
    problems.push(`${id}: rowsSurvivor=${s.rowsSurvivor} != survivors.length=${s.survivors.length}`)
  }
  if (s.rowsScreened !== s.screened * s.rowsPerAnchor) {
    problems.push(
      `${id}: rowsScreened=${s.rowsScreened} != screened(${s.screened})*rowsPerAnchor(${s.rowsPerAnchor}); every screened anchor must contribute a full row loop`,
    )
  }
  const expectedRows = rowsPerAnchorFor(s.m)
  if (s.rowsPerAnchor !== expectedRows) {
    problems.push(`${id}: rowsPerAnchor=${s.rowsPerAnchor} != C(${BASE_RANK + s.m},${s.m + 2})=${expectedRows}`)
  }
  if (s.start > s.cursor) problems.push(`${id}: checkpoint cursor=${s.cursor} behind start=${s.start}`)
  if (BigInt(s.cursor) > s.planned) {
    problems.push(`${id}: checkpoint cursor=${s.cursor} ahead of anchorsPlanned=${s.planned.toString()}`)
  }
  if (s.rowsScreened > (s.cursor - s.start) * s.rowsPerAnchor) {
    problems.push(
      `${id}: rowsScreened=${s.rowsScreened} exceeds the cursor window (cursor-start=${s.cursor - s.start})*rowsPerAnchor=${(s.cursor - s.start) * s.rowsPerAnchor}; checkpoint ahead of work`,
    )
  }
  if (s.resumeExact && s.cursor !== s.start + s.visited) {
    problems.push(
      `${id}: resumeFrom=${s.cursor} != start(${s.start})+visited(${s.visited}); checkpoint ahead of work`,
    )
  }
  if (s.visited !== s.screened + s.refused) {
    problems.push(`${id}: visited=${s.visited} != screened(${s.screened})+refused(${s.refused})`)
  }
  if (s.controls.length === 0) {
    problems.push(`${id}: no controls recorded; gating controls must be green, not absent`)
  }
  for (const c of s.controls) {
    if (typeof c.name !== "string" || typeof c.pass !== "boolean") {
      problems.push(`${id}: malformed control entry ${JSON.stringify(c)}`)
      continue
    }
    if ((c.gating ?? true) && !c.pass) problems.push(`${id}: gating control FAILED: ${c.name}`)
  }
}

export type MergeResult = {
  readonly round: string
  readonly generatedAt: string
  readonly bases: readonly BasePartition[]
  readonly claimsReproduce: ClaimsCheck
  readonly witnessTotal: number
  readonly verdict: string
  readonly problems: readonly string[]
}

export function mergeShards(
  inputs: ReadonlyArray<{ readonly file: string; readonly raw: unknown }>,
  claims: ClaimsCheck,
): MergeResult {
  const generatedAt = new Date().toISOString()
  const problems: string[] = []
  if (inputs.length === 0) {
    return {
      round: ROUND,
      generatedAt,
      bases: [],
      claimsReproduce: claims,
      witnessTotal: 0,
      verdict: "NO-SHARDS-NOTHING-MEASURED",
      problems: ["no R98 shard files found; nothing measured, nothing claimed"],
    }
  }
  const shards: NormalizedShard[] = []
  for (const { file, raw } of inputs) {
    const n = normalizeShard(file, raw)
    if (!n.ok) {
      problems.push(n.problem)
      continue
    }
    const m = SHARD_PATTERN.exec(file)
    if (m === null || Number(m[2]) !== n.shard.shard || Number(m[3]) !== n.shard.shards) {
      problems.push(`${file}: filename shard id does not match the embedded shard/shards fields`)
    }
    shards.push(n.shard)
  }
  const byBase = new Map<string, NormalizedShard[]>()
  for (const s of shards) {
    const list = byBase.get(s.base)
    if (list === undefined) byBase.set(s.base, [s])
    else list.push(s)
  }
  const bases: BasePartition[] = []
  let witnessTotal = 0
  for (const [base, group] of [...byBase.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const gProblems: string[] = []
    const shardsN = group[0]?.shards ?? 0
    if (group.some((s) => s.shards !== shardsN)) {
      gProblems.push(`${base}: shards disagree on shard count ${group.map((s) => s.shards).join(",")}`)
    }
    const seen = new Map<number, string>()
    for (const s of group) {
      const prev = seen.get(s.shard)
      if (prev !== undefined) gProblems.push(`${base}: shard ${s.shard} duplicated by ${prev} and ${s.file}`)
      else seen.set(s.shard, s.file)
    }
    for (let i = 0; i < shardsN; i += 1) {
      if (!seen.has(i)) gProblems.push(`${base}: shard ${i} of ${shardsN} missing`)
    }
    const first = group[0]
    if (first !== undefined) {
      for (const s of group) {
        if (s.m !== first.m) gProblems.push(`${base}: m mismatch ${s.m} vs ${first.m} in ${s.file}`)
        if (s.planned !== first.planned) {
          gProblems.push(`${base}: anchorsPlanned mismatch in ${s.file} (${s.planned} vs ${first.planned})`)
        }
        if (s.rowsPerAnchor !== first.rowsPerAnchor) {
          gProblems.push(`${base}: rowsPerAnchor mismatch in ${s.file}`)
        }
      }
      const which = canonicalBase(base)
      if (which !== undefined) {
        const recomputed = plannedForBase(which, first.m)
        if (recomputed !== first.planned) {
          gProblems.push(
            `${base}: anchorsPlanned=${first.planned.toString()} disagrees with the anchor space re-derived from current code (${recomputed.toString()}); shards must come from this revision`,
          )
        }
      }
    }
    for (const s of group) checkShardCounts(s, gProblems)
    let reverified = 0
    let witness = 0
    for (const s of group) {
      for (const sv of s.survivors) {
        const r = reverifySurvivor(base, sv)
        if (r.witness) witness += 1
        if (!r.ok) {
          gProblems.push(`${s.file}: survivor anchor=${sv.anchor} drop=[${[...sv.drop].join(",")}]: ${r.reason}`)
        } else reverified += 1
      }
    }
    witnessTotal += witness
    const screenedTotal = group.reduce((a, s) => a + s.screened, 0)
    const visitedTotal = group.reduce((a, s) => a + s.visited, 0)
    const planned = first?.planned ?? 0n
    if (BigInt(visitedTotal) > planned) gProblems.push(`${base}: visited=${visitedTotal} exceeds planned=${planned}`)
    const rowsScreened = group.reduce((a, s) => a + s.rowsScreened, 0)
    const rowsRefuted = group.reduce((a, s) => a + s.rowsRefuted, 0)
    const rowsSurvivor = group.reduce((a, s) => a + s.rowsSurvivor, 0)
    const rowsUndecided = group.reduce((a, s) => a + s.rowsUndecided, 0)
    const rpa = BigInt(first?.rowsPerAnchor ?? rowsPerAnchorFor(M))
    const rowsPlanned = planned * rpa
    const rowsUnscreened = (planned - BigInt(screenedTotal)) * rpa
    if (BigInt(rowsScreened) + rowsUnscreened !== rowsPlanned) {
      gProblems.push(
        `${base}: rowsScreened(${rowsScreened})+rowsUnscreened(${rowsUnscreened}) != rowsPlanned(${rowsPlanned})`,
      )
    }
    const unresolvedTargets: UnresolvedTarget[] = group
      .filter((s) => s.rowsUndecided > 0)
      .map((s) => ({
        target: `${base} shard${s.shard}of${s.shards} window [${s.start},${s.cursor}): ${s.rowsUndecided} undecided rows — re-screen target, NOT a refutation`,
        shard: s.shard,
        anchorWindow: `[${s.start},${s.cursor})`,
        undecidedRows: s.rowsUndecided,
      }))
    for (const p of gProblems) problems.push(p)
    bases.push({
      base,
      m: first?.m ?? M,
      shards: shardsN,
      anchorsPlanned: planned.toString(),
      anchorsVisited: visitedTotal,
      anchorsUnscreened: (planned - BigInt(visitedTotal)).toString(),
      rowsPlanned: rowsPlanned.toString(),
      rowsScreened,
      rowsRefuted,
      rowsSurvivor,
      rowsUndecided,
      rowsUnscreened: rowsUnscreened.toString(),
      unresolvedTargets,
      resume: group
        .map((s) => ({ shard: s.shard, resumeFrom: s.cursor }))
        .sort((a, b) => a.shard - b.shard),
      reverifiedSurvivors: reverified,
      witness,
      complete: gProblems.length === 0 && planned === BigInt(visitedTotal) && rowsUndecided === 0 && witness === 0,
    })
  }
  if (!claims.ok) problems.push(`tools/verifyAll drift: ${claims.detail}`)
  const verdict =
    problems.length > 0 ? "MERGE-FAILED" : witnessTotal > 0 ? "WITNESS-FOUND" : "MERGED"
  return { round: ROUND, generatedAt, bases, claimsReproduce: claims, witnessTotal, verdict, problems }
}

export type MergeArtifact = MergeResult & {
  readonly generatedBy: string
  readonly purpose: string
  readonly scannedDir: string
}

export async function mergeDir(dir: string, outDir: string): Promise<{ readonly result: MergeResult; readonly outPath: string }> {
  const files = (await readdir(dir)).filter((f) => SHARD_PATTERN.test(f)).sort()
  const inputs: Array<{ file: string; raw: unknown }> = []
  for (const f of files) {
    try {
      inputs.push({ file: f, raw: JSON.parse(await readFile(join(dir, f), "utf8")) as unknown })
    } catch {
      inputs.push({ file: f, raw: undefined })
    }
  }
  const claims = await checkClaimsReproduce(dir)
  const result = mergeShards(inputs, claims)
  const artifact: MergeArtifact = {
    ...result,
    generatedBy: "attempts/R98_m2_merge.ts",
    purpose:
      "merge the R98 m=2 shard streams into a closed vs unresolved vs unscreened partition per base; unresolved rows are named follow-up targets, never refutations",
    scannedDir: dir,
  }
  const outPath = join(outDir, "R98_m2_merge.json")
  await writeFile(outPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8")
  return { result, outPath }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const scanDir = process.argv[2] ?? HERE
    const { result, outPath } = await mergeDir(scanDir, HERE)
    for (const b of result.bases) {
      console.log(
        `${b.base}: shards=${b.shards} screened=${b.rowsScreened} refuted=${b.rowsRefuted} survivor=${b.rowsSurvivor} undecided=${b.rowsUndecided} unscreened=${b.rowsUnscreened} reverified=${b.reverifiedSurvivors} witness=${b.witness} complete=${b.complete}`,
      )
      for (const t of b.unresolvedTargets) console.log(`  unresolved: ${t.target}`)
    }
    for (const p of result.problems) console.log(`problem: ${p}`)
    console.log(`claims: ${result.claimsReproduce.ok ? "ALL-CLAIMS-REPRODUCE" : "DRIFT-DETECTED"} (${result.claimsReproduce.detail})`)
    console.log(`verdict=${result.verdict} -> ${outPath}`)
    if (result.verdict !== "MERGED" && result.verdict !== "WITNESS-FOUND") process.exit(1)
  } catch (e) {
    console.log(`unhandled: ${String(e)}`)
    process.exit(1)
  }
}

if (import.meta.main) await main()
