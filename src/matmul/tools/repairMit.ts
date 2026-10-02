import { mismatches, type Repair, type Triple } from "./absorbRepair"
import type { SearchOptions, SearchReport } from "./repairSearch"

/**
 * R53 - widen the repair search to coordinates that act only as compensation.
 *
 * Round 52 searched edits confined to (u[7], v[4], w[7]) and said so honestly:
 * those are the only three that can move the defective entry directly, but a
 * repair may well need a coordinate elsewhere in the matrix purely to cancel the
 * collateral that a direct activation causes. That space was left unsearched, and
 * this closes it for single- and double-coordinate edits over ALL coordinates.
 *
 * The brute-force cost is what makes the widening non-obvious. There are
 * 22 * 27 * 4 = 2376 single-coordinate edits, and testing every pair is about
 * 2.8 million delta comparisons. Meet in the middle instead: a pair works exactly
 * when D(e1) + D(e2) = e_target, that is when D(e1) = e_target - D(e2), so hash
 * every single delta once and probe for complements. That is linear in the number
 * of edits rather than quadratic, which is what makes 2376 editable rather than
 * a number nobody would run.
 *
 * A found pair is still handed to the real verifier before being reported. The
 * arithmetic here is a shortcut for the search, not a substitute for ground truth.
 */
const TARGET_INDEX = (7 * 9 + 4) * 9 + 7

type Entry = readonly [index: number, delta: number]
type Edit = { readonly triple: number; readonly which: "u" | "v" | "w"; readonly pos: number; readonly value: number }

function deltaOf(base: readonly Triple[], edit: Edit): Map<number, number> {
  const out = new Map<number, number>()
  const cur = base[edit.triple]
  if (cur === undefined) return out
  const u0 = cur.u
  const v0 = cur.v
  const w0 = cur.w
  const edited = [...(edit.which === "u" ? u0 : edit.which === "v" ? v0 : w0)]
  edited[edit.pos] = edit.value
  // Entry (a,b,c) of one triple is u[a] * v[b] * w[c], flat-indexed a*81 + b*9 + c.
  // Exactly one of the three factors changes, so the other two keep their values;
  // reading a, b and c out of the edited vector instead would compute the cube of
  // one factor rather than the product of three.
  const u = edit.which === "u" ? edited : u0
  const v = edit.which === "v" ? edited : v0
  const w = edit.which === "w" ? edited : w0
  for (let a = 0; a < 9; a++) {
    for (let b = 0; b < 9; b++) {
      for (let c = 0; c < 9; c++) {
        const i = a * 81 + b * 9 + c
        const now = (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0)
        const was = (u0[a] ?? 0) * (v0[b] ?? 0) * (w0[c] ?? 0)
        if (now !== was) out.set(i, now - was)
      }
    }
  }
  return out
}

function keyOf(m: Map<number, number>): string {
  return [...m.entries()]
    .sort((x, y) => x[0] - y[0])
    .map(([i, d]) => `${i}:${d}`)
    .join(",")
}

function complementOf(m: Map<number, number>): Map<number, number> {
  // e_target - D(e), entry by entry. Negating D first and adding the target
  // afterwards double-counts at the target index: for D = {target: 1} that gives
  // 1 - (-1) = 2 instead of the empty complement.
  const out = new Map<number, number>()
  for (const i of new Set([...m.keys(), TARGET_INDEX])) {
    const want = (i === TARGET_INDEX ? 1 : 0) - (m.get(i) ?? 0)
    if (want !== 0) out.set(i, want)
  }
  return out
}

function apply(base: readonly Triple[], edits: readonly Edit[]): Triple[] {
  return base.map((t, i) => {
    const mine = edits.filter((e) => e.triple === i)
    if (mine.length === 0) return { u: [...t.u], v: [...t.v], w: [...t.w] }
    const cp = { u: [...t.u], v: [...t.v], w: [...t.w] }
    for (const e of mine) cp[e.which][e.pos] = e.value
    return cp
  })
}

export function searchRepairWide(base: readonly Triple[], opts?: SearchOptions): SearchReport {
  const values = opts?.values ?? [-2, -1, 1, 2]
  const budget = opts?.budget ?? 20_000

  const edits: Edit[] = []
  for (let t = 0; t < base.length; t++) {
    const cur = base[t]
    if (cur === undefined) continue
    for (const which of ["u", "v", "w"] as const) {
      for (let pos = 0; pos < 9; pos++) {
        const original = cur[which][pos] ?? 0
        for (const value of values) {
          if (value === original) continue
          edits.push({ triple: t, which, pos, value })
        }
      }
    }
  }

  const table = new Map<string, Edit[]>()
  const targetKey = keyOf(new Map([[TARGET_INDEX, 1]]))
  let considered = 0
  for (const e of edits) {
    if (considered >= budget) break
    considered += 1
    const k = keyOf(deltaOf(base, e))
    // A single edit can already be the whole repair, in which case its complement
    // is the empty delta and the pairing loop below skips it for want.size === 0.
    if (k === targetKey) {
      return {
        exhaustive: considered < budget && considered >= edits.length,
        candidatesTried: considered,
        repair: { triple: e.triple, which: e.which, pos: e.pos, value: e.value },
        scope:
          `single-coordinate edits over all 27 coordinates of all ${base.length} ` +
          `triples, values ${values.join(",")}; target entry ${TARGET_INDEX}`,
      }
    }
    const bucket = table.get(k)
    if (bucket === undefined) table.set(k, [e])
    else bucket.push(e)
  }

  let probes = 0
  for (const e of edits) {
    if (considered + probes >= budget) break
    probes += 1
    const want = complementOf(deltaOf(base, e))
    if (want.size === 0) continue
    const bucket = table.get(keyOf(want))
    if (bucket === undefined) continue
    for (const other of bucket) {
      const conflict =
        other.triple === e.triple && other.which === e.which && other.pos === e.pos
      if (conflict) continue
      const pair = [other, e]
      const patched = apply(base, pair)
      if (mismatches(patched) !== 0) continue
      const first = pair[0]
      const repair: Repair = {
        triple: first?.triple ?? 0,
        which: first?.which ?? "u",
        pos: first?.pos ?? 0,
        value: first?.value ?? 0,
      }
      return {
        exhaustive: considered + probes < budget && considered >= edits.length,
        candidatesTried: considered + probes,
        repair,
        scope:
          `single-coordinate edits over all 27 coordinates of all ` +
          `${base.length} triples, values ${values.join(",")}, paired by meet in ` +
          `the middle on complementary deltas; target entry ${TARGET_INDEX}`,
      }
    }
  }

  return {
    exhaustive: considered >= edits.length && probes >= edits.length,
    candidatesTried: considered + probes,
    repair: null,
    scope:
      `single-coordinate edits over all 27 coordinates of all ${base.length} ` +
      `triples, values ${values.join(",")}, paired by meet in the middle; ` +
      `target entry ${TARGET_INDEX}. Two-coordinate edits WITHIN one triple and ` +
      `edits of three or more coordinates are not covered.`,
  }
}