import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { verify } from "../checker"
import { buildReduced, mMatrix, reductionCertificate } from "./rankTest"
import type { Scheme } from "../types"

type Mat = number[][]

export function identity(n: number): Mat {
  return Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)))
}

export function det(a: Mat): number {
  const n = a.length
  if (n === 2) return (a[0]?.[0] ?? 0) * (a[1]?.[1] ?? 0) - (a[0]?.[1] ?? 0) * (a[1]?.[0] ?? 0)
  if (n === 3) {
    const m = (i: number, j: number): number => a[i]?.[j] ?? 0
    return (
      m(0, 0) * (m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1)) -
      m(0, 1) * (m(1, 0) * m(2, 2) - m(1, 2) * m(2, 0)) +
      m(0, 2) * (m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0))
    )
  }
  throw new RangeError(`unsupported size ${n}`)
}

function transpose(a: Mat): Mat {
  const n = a.length
  const out: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const row = out[j]
      if (row !== undefined) row[i] = a[i]?.[j] ?? 0
    }
  }
  return out
}

export function invUnimodular(a: Mat): Mat {
  const d = det(a)
  if (d !== 1 && d !== -1) throw new RangeError("not unimodular")
  const t = transpose(a)
  const m = (i: number, j: number): number => t[i]?.[j] ?? 0
  let cof: number[][]
  if (a.length === 2) {
    cof = [
      [m(1, 1), -m(0, 1)],
      [-m(1, 0), m(0, 0)],
    ]
  } else {
    cof = [
      [
        m(1, 1) * m(2, 2) - m(1, 2) * m(2, 1),
        -(m(0, 1) * m(2, 2) - m(0, 2) * m(2, 1)),
        m(0, 1) * m(1, 2) - m(0, 2) * m(1, 1),
      ],
      [
        -(m(1, 0) * m(2, 2) - m(1, 2) * m(2, 0)),
        m(0, 0) * m(2, 2) - m(0, 2) * m(2, 0),
        -(m(0, 0) * m(1, 2) - m(0, 2) * m(1, 0)),
      ],
      [
        m(1, 0) * m(2, 1) - m(1, 1) * m(2, 0),
        -(m(0, 0) * m(2, 1) - m(0, 1) * m(2, 0)),
        m(0, 0) * m(1, 1) - m(0, 1) * m(1, 0),
      ],
    ]
  }
  const s = d === 1 ? 1 : -1
  return cof.map((row) => row.map((v) => v * s))
}

/**
 * Applies (alpha, beta) to a mode whose index is the pair (i,j): the two indices
 * transform independently, i.e. a Kronecker action, NOT a matrix product.
 */
export function modeVec(v: readonly number[], alpha: Mat, beta: Mat): number[] {
  const n = alpha.length
  const out = new Array<number>(n * n).fill(0)
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      let s = 0
      for (let ip = 0; ip < n; ip++) {
        for (let jp = 0; jp < n; jp++) {
          const coef = (alpha[i]?.[ip] ?? 0) * (beta[j]?.[jp] ?? 0)
          if (coef !== 0) s += coef * (v[ip * n + jp] ?? 0)
        }
      }
      out[i * n + j] = s
    }
  }
  return out
}

/** The verified de Groote automorphism: mode1 (g,h), mode2 (h^-1,k), mode3 (g^-1,k^-1). */
export function applyAuto(scheme: Scheme, g: Mat, h: Mat, k: Mat): Scheme {
  const gi = invUnimodular(g)
  const hi = invUnimodular(h)
  const ki = invUnimodular(k)
  return {
    n: scheme.n,
    triples: scheme.triples.map((t) => ({
      u: modeVec(t.u, g, h),
      v: modeVec(t.v, hi, k),
      w: modeVec(t.w, gi, ki),
    })),
  }
}

export function mulberry(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function randomUnimodular(rnd: () => number, bound: number, n: number): Mat {
  for (let attempt = 0; attempt < 500; attempt++) {
    const m: Mat = Array.from({ length: n }, () => new Array<number>(n).fill(0))
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const row = m[i]
        if (row !== undefined) row[j] = Math.floor(rnd() * (2 * bound + 1)) - bound
      }
    }
    const d = det(m)
    if (d === 1 || d === -1) return m
  }
  const out = identity(n)
  const r0 = out[0]
  if (r0 !== undefined) r0[1] = 1
  return out
}

const HERE = dirname(fileURLToPath(import.meta.url))
const ATT = join(HERE, "..", "attempts")

// no-excuse-ok: catch
async function main(): Promise<void> {
  try {
    const args = process.argv.slice(2)
    const name = args[0] ?? "T11_solution.ts"
    const count = Number.parseInt(args[1] ?? "200", 10)
    const out = args[2] ?? "R15_equivariant.json"
    const mod = (await import(join(ATT, name))) as { scheme: Scheme }
    const base = mod.scheme
    const n = base.n
    const rnd = mulberry(20260929)
    const t0 = Date.now()
    const seen = new Set<string>()
    const rows: unknown[] = []
    let incorrect = 0
    let reducibleHits = 0

    for (let trial = 0; trial < count; trial++) {
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
        incorrect++
        continue
      }
      const sig = mMatrix(img)
        .map((r) => r.map((f) => f.n.toString() + "/" + f.d.toString()).join(","))
        .join("|")
      const fresh = !seen.has(sig)
      seen.add(sig)
      if (!fresh) continue
      const mrows = mMatrix(img)
      let reducible = 0
      let reducedOk = false
      for (let kk = 0; kk < img.triples.length; kk++) {
        const cert = reductionCertificate(mrows, kk)
        if (cert === null) continue
        reducible++
        try {
          const reduced = buildReduced(img, kk, cert)
          if (verify(reduced).correct && reduced.triples.length === img.triples.length - 1) {
            reducedOk = true
            await writeFile(
              join(ATT, "R15_win.ts"),
              `import type { Scheme } from "../types"\n\nexport const scheme: Scheme = {\n  n: ${n},\n  triples: [\n${reduced.triples.map((t) => `    { u: [${t.u.join(",")}], v: [${t.v.join(",")}], w: [${t.w.join(",")}] },`).join("\n")}\n  ],\n}\n`,
              "utf-8",
            )
          }
        } catch (e) {
          if (e instanceof Error) {
            reducedOk = false
          } else {
            throw e
          }
        }
      }
      if (reducible > 0) reducibleHits++
      rows.push({ trial, fresh, reducible, reducedOk })
    }
    const payload = {
      family: name,
      automorphism: "de Groote via Kronecker mode action: mode1 (g,h), mode2 (h^-1,k), mode3 (g^-1,k^-1)",
      trials: count,
      distinctSchemes: seen.size,
      incorrectImages: incorrect,
      reducibleHits,
      verdict: reducibleHits > 0 ? "REDUCIBLE-MEMBER-FOUND" : "ALL-IRREDUCIBLE-IN-RESTRICTED-ANSATZ",
      elapsedMs: Date.now() - t0,
    }
    await writeFile(join(ATT, out), JSON.stringify(payload, null, 2), "utf-8")
    console.log(
      `verdict=${payload.verdict} distinct=${seen.size}/${count} incorrect=${incorrect} reducible=${reducibleHits} ${payload.elapsedMs}ms -> ${out}`,
    )
  } catch (e) {
    console.error("unhandled:", e)
    process.exit(1)
  }
}

if (import.meta.main) {
  await main()
}
