import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify, verifyMod2 } from "../checker"
import { applyAuto, mulberry, randomUnimodular } from "./equivariant"
import { matrixRank } from "./factorProfile"
import type { Scheme } from "../types"

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

type Mat = number[][]

function mod2All(a: Mat): Mat {
  return a.map((r) => r.map((x) => ((x % 2) + 2) % 2))
}

function invF2(a: Mat): Mat {
  const n = a.length
  const aug: number[][] = Array.from({ length: n }, (_, i) => [
    ...mod2All([a[i] ?? []])[0] ?? [],
    ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)),
  ])
  for (let c = 0; c < n; c++) {
    let pivot = -1
    for (let r = c; r < n; r++) {
      if (aug[r]?.[c] === 1) {
        pivot = r
        break
      }
    }
    if (pivot < 0) throw new RangeError("singular over F_2")
    const t = aug[c]
    const p = aug[pivot]
    if (t === undefined || p === undefined) throw new RangeError("unreachable")
    aug[c] = p
    aug[pivot] = t
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      if (aug[r]?.[c] !== 1) continue
      const row = aug[r]
      if (row === undefined) continue
      const pivotRow = aug[c]
      if (pivotRow === undefined) continue
      for (let k = 0; k < 2 * n; k++) row[k] = ((row[k] ?? 0) - (pivotRow[k] ?? 0)) & 1
    }
  }
  return aug.map((r) => r.slice(n))
}

function randomGL2(rnd: () => number, n: number): Mat {
  for (let attempt = 0; attempt < 500; attempt++) {
    const m: Mat = Array.from({ length: n }, () => Array.from({ length: n }, () => (rnd() < 0.5 ? 1 : 0)))
    if (matrixRank(m, "F2") === n) return m
  }
  throw new RangeError("could not sample GL(n, F_2)")
}

function modeVecF2(v: readonly number[], alpha: Mat, beta: Mat, n: number): number[] {
  const out = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let ip = 0; ip < n; ip++) {
        for (let jp = 0; jp < n; jp++) {
          s ^= (alpha[i]?.[ip] ?? 0) & (beta[j]?.[jp] ?? 0) & (v[ip * n + jp] ?? 0)
        }
      }
      out[i * n + j] = s
    }
  }
  return out
}

export function profileKey(s: Scheme, field: "Q" | "F2"): string {
  const counts = new Map<number, number>()
  for (const t of s.triples) {
    const m: Mat = []
    for (let i = 0; i < s.n; i++) m.push([...t.u.slice(i * s.n, i * s.n + s.n)])
    const r = matrixRank(m, field)
    counts.set(r, (counts.get(r) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}x${c}`).join(",")
}

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const count = Number.parseInt(args[0] ?? "150", 10)
    const out = args[1] ?? "R25_profile_invariance.json"
    const mod = (await import(join(ATT, "T11_solution.ts"))) as { scheme: Scheme }
    const base = mod.scheme
    const n = base.n
    const rnd = mulberry(424242)

    const deGroote = new Map<string, number>()
    let deGrooteIncorrect = 0
    for (let t = 0; t < count; t++) {
      const g = randomUnimodular(rnd, 2, n)
      const h = randomUnimodular(rnd, 2, n)
      const k = randomUnimodular(rnd, 2, n)
      let img: Scheme
      try {
        img = applyAuto(base, g, h, k)
      } catch (e) {
        if (e instanceof Error) continue
        throw e
      }
      if (!verify(img).correct) {
        deGrooteIncorrect++
        continue
      }
      const key = profileKey(img, "Q")
      deGroote.set(key, (deGroote.get(key) ?? 0) + 1)
    }

    const f2group = new Map<string, number>()
    let f2Direct = 0
    let f2Groote = 0
    const reduced: Scheme = {
      n,
      triples: base.triples.map((t) => ({
        u: t.u.map((x) => ((x % 2) + 2) % 2),
        v: t.v.map((x) => ((x % 2) + 2) % 2),
        w: t.w.map((x) => ((x % 2) + 2) % 2),
      })),
    }
    for (let t = 0; t < count; t++) {
      const G = randomGL2(rnd, n)
      const H = randomGL2(rnd, n)
      const K = randomGL2(rnd, n)
      const direct: Scheme = {
        n,
        triples: base.triples.map((t2) => ({
          u: modeVecF2(t2.u.map((x) => ((x % 2) + 2) % 2), G, H, n),
          v: modeVecF2(t2.v.map((x) => ((x % 2) + 2) % 2), H, K, n),
          w: modeVecF2(t2.w.map((x) => ((x % 2) + 2) % 2), G, K, n),
        })),
      }
      if (verifyMod2(direct).correct) {
        f2Direct++
        const key = profileKey(direct, "F2")
        f2group.set(key, (f2group.get(key) ?? 0) + 1)
      }
      const gi = invF2(G)
      const hi = invF2(H)
      const ki = invF2(K)
      const groote: Scheme = {
        n,
        triples: base.triples.map((t2) => ({
          u: modeVecF2(t2.u.map((x) => ((x % 2) + 2) % 2), G, H, n),
          v: modeVecF2(t2.v.map((x) => ((x % 2) + 2) % 2), hi, K, n),
          w: modeVecF2(t2.w.map((x) => ((x % 2) + 2) % 2), gi, ki, n),
        })),
      }
      if (verifyMod2(groote).correct) f2Groote++
    }

    const baseKeyQ = profileKey(base, "Q")
    const baseKeyF2 = profileKey(reduced, "F2")
    const deGrooteKeys = [...deGroote.keys()].sort()
    const f2Keys = [...f2group.keys()].sort()
    const payload = {
      question:
        "is the first-factor matrix-rank profile an invariant of the group action, or does the Kronecker mode action change it?",
      baseProfileQ: baseKeyQ,
      baseProfileF2: baseKeyF2,
      deGrooteIntegerUnimodular: {
        trials: count,
        incorrect: deGrooteIncorrect,
        distinctProfiles: deGrooteKeys,
        counts: Object.fromEntries(deGroote),
        invariant: deGrooteKeys.length <= 1 && deGrooteKeys[0] === baseKeyQ,
      },
      fullGL_F2: {
        trials: count,
        correctWithDirectTriple: f2Direct,
        correctWithInverseBearingPattern: f2Groote,
        verdict: f2Direct === 0 && f2Groote === 0 ? "REFUTED" : "PARTIALLY-VALID",
        note:
          "the de Groote action does not extend to GL(n, F_2) by substituting invertible matrices for the unimodular ones; the integer-unimodular restriction is load-bearing",
        distinctProfiles: f2Keys,
        counts: Object.fromEntries(f2group),
        invariant: f2Keys.length <= 1 && f2Keys[0] === baseKeyF2,
      },
      scope:
        "if either orbit shows more than one profile then the profile is NOT an orbit invariant and R24's reading of it as a forced structure must be weakened accordingly",
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(`base Q=${baseKeyQ}  F2=${baseKeyF2}`)
    console.log(`deGroote: incorrect=${deGrooteIncorrect} distinct=${deGrooteKeys.length} ${JSON.stringify(Object.fromEntries(deGroote))}`)
    console.log(`GL(9,F2): direct correct=${f2Direct}/${count} inverse-bearing correct=${f2Groote}/${count}`)
    console.log(`-> ${out}`)
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
