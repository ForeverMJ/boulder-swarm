import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { naive } from "../schemes"
import { scoreTriples } from "./search"
import { applyTriple, cyclesOf, findAutomorphisms, orderOf, tripleKey } from "./symmetry"
import type { Automorphism } from "./symmetry"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Triple = { u: number[]; v: number[]; w: number[] }

function orbitClosure(g: Automorphism, t: Triple): Triple[] {
  const g1 = applyTriple(g, t)
  const g2 = applyTriple(g, g1)
  return [t, g1, g2]
}

function decompose(g: Automorphism, triples: readonly Triple[]): { orbits: Triple[][]; fixed: Triple[] } {
  const seen = new Set<string>()
  const orbits: Triple[][] = []
  const fixed: Triple[] = []
  for (const t of triples) {
    const k = tripleKey(t)
    if (seen.has(k)) continue
    const orb = orbitClosure(g, t)
    const isFixed = tripleKey(orb[1] ?? t) === k && tripleKey(orb[2] ?? t) === k
    for (const o of orb) seen.add(tripleKey(o))
    if (isFixed) fixed.push(t)
    else orbits.push([orb[0] ?? t])
  }
  return { orbits, fixed }
}

type Ansatz = {
  reps: Triple[]
  fixedVals: number[]
  nFixed: number
  cycles: number[][][]
  n: number
  g: Automorphism
}

function buildScheme(a: Ansatz): Scheme {
  const triples: { u: readonly number[]; v: readonly number[]; w: readonly number[] }[] = []
  for (const rep of a.reps) {
    for (const t of orbitClosure(a.g, rep)) triples.push(t)
  }
  const build = (fb: number, si: 0 | 1 | 2): number[] => {
    const v = new Array<number>(a.n * a.n).fill(0)
    for (let ci = 0; ci < (a.cycles[si]?.length ?? 0); ci++) {
      const val = a.fixedVals[fb * 300 + si * 100 + ci] ?? 0
      for (const pos of a.cycles[si]?.[ci] ?? []) v[pos] = val
    }
    return v
  }
  for (let fb = 0; fb < a.nFixed; fb++) {
    triples.push({ u: build(fb, 0), v: build(fb, 1), w: build(fb, 2) })
  }
  return { n: a.n, triples }
}

function paramsOf(a: Ansatz): number {
  return a.reps.length * 27 + a.nFixed * a.cycles.reduce((acc, m) => acc + m.length, 0)
}

function fixedMap(a: Ansatz): number[] {
  const out: number[] = []
  const perBlock = a.cycles.reduce((acc, m) => acc + m.length, 0)
  for (let fb = 0; fb < a.nFixed; fb++) {
    for (let si = 0; si < a.cycles.length; si++) {
      const m = a.cycles[si] ?? []
      for (let ci = 0; ci < m.length; ci++) out.push(fb * perBlock + si * 100 + ci)
    }
  }
  void perBlock
  return out
}

function readParam(a: Ansatz, idx: number): number {
  if (idx < a.reps.length * 27) {
    const b = Math.floor(idx / 27)
    const r = idx % 27
    const rep = a.reps[b]
    if (rep === undefined) return 0
    const arr = r < 9 ? rep.u : r < 18 ? rep.v : rep.w
    return arr[r % 9] ?? 0
  }
  const k = idx - a.reps.length * 27
  return a.fixedVals[fixedMap(a)[k] ?? -1] ?? 0
}

function writeParam(a: Ansatz, idx: number, val: number): void {
  if (idx < a.reps.length * 27) {
    const b = Math.floor(idx / 27)
    const r = idx % 27
    const rep = a.reps[b]
    if (rep === undefined) return
    if (r < 9) rep.u[r] = val
    else if (r < 18) rep.v[r - 9] = val
    else rep.w[r - 18] = val
    return
  }
  const k = fixedMap(a)[idx - a.reps.length * 27] ?? -1
  if (k >= 0) a.fixedVals[k] = val
}

function scoreOf(a: Ansatz): { mm: number; l1: number } {
  return scoreTriples(a.n, buildScheme(a).triples)
}

function descend(a: Ansatz, lo: number, hi: number, steps: number): { mm: number; l1: number } {
  const values: number[] = []
  for (let v = lo; v <= hi; v++) values.push(v)
  const nParams = paramsOf(a)
  let best = scoreOf(a)
  for (let s = 0; s < steps; s++) {
    let improved = false
    for (let i = 0; i < nParams; i++) {
      const orig = readParam(a, i)
      for (const v of values) {
        if (v === orig) continue
        writeParam(a, i, v)
        const sc = scoreOf(a)
        if (sc.mm < best.mm || (sc.mm === best.mm && sc.l1 < best.l1)) {
          best = sc
          improved = true
        } else {
          writeParam(a, i, orig)
        }
      }
      if (best.mm === 0) return best
    }
    if (!improved) break
  }
  return best
}

function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const out = args[0] ?? "R12_z3search.json"
    const lo = Number.parseInt(args[1] ?? "-2", 10)
    const hi = Number.parseInt(args[2] ?? "2", 10)
    const restarts = Number.parseInt(args[3] ?? "6", 10)
    const autos = findAutomorphisms(3)
    const g = autos.find((a) => orderOf(a) === 3)
    if (g === undefined) {
      await writeFile(join(ATT, out), JSON.stringify({ error: "no order-3 automorphism" }, null, 2), "utf-8")
      console.log("no order-3 automorphism")
      return
    }
    const naiveTriples = naive(3).triples.map((t) => ({ u: [...t.u], v: [...t.v], w: [...t.w] }))
    const dec = decompose(g, naiveTriples)
    const naiveInfo = {
      total: naiveTriples.length,
      orbits: dec.orbits.length,
      fixed: dec.fixed.length,
      closed: dec.orbits.length * 3 + dec.fixed.length === naiveTriples.length,
      fixedKeys: dec.fixed.map((t) => tripleKey(t)),
    }
    console.log(
      `naive3: total=${naiveInfo.total} orbits=${naiveInfo.orbits} fixed=${naiveInfo.fixed} closed=${naiveInfo.closed}`,
    )

    const cycles = [cyclesOf(g.s1), cyclesOf(g.s2), cyclesOf(g.s3)]
    const rnd = mulberry(20260929)
    const rows: unknown[] = []
    let bestOverall = { mm: Number.POSITIVE_INFINITY, rank: -1, config: "" }

    for (const targetRank of [22, 23]) {
      for (const nFixed of [1, 2]) {
        const need = targetRank - nFixed
        if (need <= 0 || need % 3 !== 0) continue
        const nOrbits = need / 3
        if (dec.orbits.length < nOrbits) continue
        for (let r = 0; r < restarts; r++) {
          const a: Ansatz = {
            reps: Array.from({ length: nOrbits }, (_, i) => {
              const src = dec.orbits[(i + r) % dec.orbits.length]?.[0]
              return src === undefined
                ? { u: new Array<number>(9).fill(0), v: new Array<number>(9).fill(0), w: new Array<number>(9).fill(0) }
                : { u: [...src.u], v: [...src.v], w: [...src.w] }
            }),
            fixedVals: new Array<number>(600).fill(0),
            nFixed,
            cycles,
            n: 3,
            g,
          }
          for (let fb = 0; fb < nFixed; fb++) {
            for (let si = 0; si < 3; si++) {
              for (let ci = 0; ci < (cycles[si]?.length ?? 0); ci++) {
                a.fixedVals[fb * 300 + si * 100 + ci] = Math.floor(rnd() * 3) - 1
              }
            }
          }
          const sc = descend(a, lo, hi, 8)
          const rank = buildScheme(a).triples.length
          rows.push({ targetRank, nFixed, restart: r, mm: sc.mm, l1: sc.l1, rank })
          if (sc.mm < bestOverall.mm) {
            bestOverall = { mm: sc.mm, rank, config: `rank${targetRank} nFixed=${nFixed} r=${r}` }
          }
          if (sc.mm === 0) {
            const gt = verify(buildScheme(a))
            console.log(`SOLVED? rank=${targetRank} nFixed=${nFixed} truth=${gt.correct} gotRank=${gt.rank}`)
          }
        }
      }
    }
    const payload = {
      approach: "Z3-invariant ansatz: nFixed + nOrbits*3, seeded from naive(3) orbit structure",
      naiveInfo,
      rankTargets: { rank22: "1 fixed + 7 orbits", rank23: "2 fixed + 7 orbits" },
      trials: rows,
      best: bestOverall,
      verdict: bestOverall.mm === 0 ? "SOLVED" : "blocked",
      coefficientRange: [lo, hi],
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`verdict=${payload.verdict} best=${bestOverall.mm} rank=${bestOverall.rank} -> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

await main()
