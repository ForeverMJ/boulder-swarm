import { writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { buildTarget } from "../types"
import { scheme as base } from "./T11_solution"

const HERE = dirname(fileURLToPath(import.meta.url))
const NN = 9
const NT = NN * NN * NN
const VALS = [-2, -1, 0, 1, 2]
const SMALL = [-1, 0, 1]
const BUDGET_MS = 100_000

const target3 = buildTarget(3)
const target = new Array<number>(NT).fill(0)
for (let a = 0; a < NN; a++) {
  for (let b = 0; b < NN; b++) {
    for (let c = 0; c < NN; c++) {
      target[a * 81 + b * 9 + c] = target3[a]?.[b]?.[c] ?? 0
    }
  }
}

type Mat = number[][]

function toMats(skip: number[]): [Mat, Mat, Mat] {
  const U: Mat = []
  const V: Mat = []
  const W: Mat = []
  for (let s = 0; s < base.triples.length; s++) {
    if (skip.includes(s)) continue
    const t = base.triples[s]
    if (t === undefined) continue
    U.push([...t.u])
    V.push([...t.v])
    W.push([...t.w])
  }
  return [U, V, W]
}

function baseGot(U: Mat, V: Mat, W: Mat): number[] {
  const g = new Array<number>(NT).fill(0)
  for (let r = 0; r < U.length; r++) {
    const u = U[r] ?? []
    const v = V[r] ?? []
    const w = W[r] ?? []
    for (let a = 0; a < NN; a++) {
      const ua = u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < NN; b++) {
        const uv = ua * (v[b] ?? 0)
        if (uv === 0) continue
        for (let c = 0; c < NN; c++) {
          const k = a * 81 + b * 9 + c
          g[k] = (g[k] ?? 0) + uv * (w[c] ?? 0)
        }
      }
    }
  }
  return g
}

function scoreWith(bg: number[], u: number[], v: number[], w: number[]): { mm: number; l1: number } {
  let mm = 0
  let l1 = 0
  for (let a = 0; a < NN; a++) {
    for (let b = 0; b < NN; b++) {
      for (let c = 0; c < NN; c++) {
        const k = a * 81 + b * 9 + c
        const d = (bg[k] ?? 0) + (u[a] ?? 0) * (v[b] ?? 0) * (w[c] ?? 0) - (target[k] ?? 0)
        if (d !== 0) {
          mm++
          l1 += Math.abs(d)
        }
      }
    }
  }
  return { mm, l1 }
}

function randInt(n: number): number {
  return Math.floor(Math.random() * n)
}

function randomSparse(): number[] {
  const v = new Array<number>(NN).fill(0)
  for (let i = 0; i < NN; i++) {
    const r = Math.random()
    v[i] = r < 0.5 ? 0 : SMALL[randInt(SMALL.length)] ?? 0
  }
  return v
}

// Integer ALS: fix two factors, greedily optimize each coord of the third.
function alsRepair(bg: number[], deadline: number): { u: number[]; v: number[]; w: number[]; mm: number; l1: number } {
  let best = { u: new Array<number>(NN).fill(0), v: new Array<number>(NN).fill(0), w: new Array<number>(NN).fill(0), mm: NT, l1: Number.MAX_SAFE_INTEGER }
  let restarts = 0
  const costU = (u: number[], v: number[], w: number[], a0: number, val: number): number => {
    let cost = 0
    for (let b = 0; b < NN; b++) {
      for (let c = 0; c < NN; c++) {
        const k = a0 * 81 + b * 9 + c
        const d = (bg[k] ?? 0) + val * (v[b] ?? 0) * (w[c] ?? 0) - (target[k] ?? 0)
        if (d !== 0) cost += 100 + Math.abs(d)
      }
    }
    return cost
  }
  const costV = (u: number[], v: number[], w: number[], b0: number, val: number): number => {
    let cost = 0
    for (let a = 0; a < NN; a++) {
      for (let c = 0; c < NN; c++) {
        const k = a * 81 + b0 * 9 + c
        const d = (bg[k] ?? 0) + (u[a] ?? 0) * val * (w[c] ?? 0) - (target[k] ?? 0)
        if (d !== 0) cost += 100 + Math.abs(d)
      }
    }
    return cost
  }
  const costW = (u: number[], v: number[], w: number[], c0: number, val: number): number => {
    let cost = 0
    for (let a = 0; a < NN; a++) {
      for (let b = 0; b < NN; b++) {
        const k = a * 81 + b * 9 + c0
        const d = (bg[k] ?? 0) + (u[a] ?? 0) * (v[b] ?? 0) * val - (target[k] ?? 0)
        if (d !== 0) cost += 100 + Math.abs(d)
      }
    }
    return cost
  }
  while (Date.now() < deadline) {
    restarts++
    const u = randomSparse()
    const v = randomSparse()
    const w = randomSparse()
    for (let sweep = 0; sweep < 8; sweep++) {
      let changed = false
      for (let a = 0; a < NN; a++) {
        let bv = u[a] ?? 0
        let bc = costU(u, v, w, a, bv)
        for (const val of VALS) {
          const c = costU(u, v, w, a, val)
          if (c < bc) {
            bc = c
            bv = val
          }
        }
        if (bv !== (u[a] ?? 0)) {
          u[a] = bv
          changed = true
        }
      }
      for (let b = 0; b < NN; b++) {
        let bv = v[b] ?? 0
        let bc = costV(u, v, w, b, bv)
        for (const val of VALS) {
          const c = costV(u, v, w, b, val)
          if (c < bc) {
            bc = c
            bv = val
          }
        }
        if (bv !== (v[b] ?? 0)) {
          v[b] = bv
          changed = true
        }
      }
      for (let c = 0; c < NN; c++) {
        let bv = w[c] ?? 0
        let bc = costW(u, v, w, c, bv)
        for (const val of VALS) {
          const cc = costW(u, v, w, c, val)
          if (cc < bc) {
            bc = cc
            bv = val
          }
        }
        if (bv !== (w[c] ?? 0)) {
          w[c] = bv
          changed = true
        }
      }
      if (!changed) break
    }
    const s = scoreWith(bg, u, v, w)
    if (s.mm < best.mm || (s.mm === best.mm && s.l1 < best.l1)) {
      best = { u: [...u], v: [...v], w: [...w], mm: s.mm, l1: s.l1 }
      console.log(`T12b-ALS restart=${restarts} new-best mm=${s.mm} l1=${s.l1}`)
      if (s.mm === 0) break
    }
  }
  console.log(`T12b-ALS restarts=${restarts} best mm=${best.mm} l1=${best.l1}`)
  return best
}

// Bounded stochastic enumeration over sparse supports.
// Phase A enforces a shared support pattern (diagonal-symmetric family,
// symmetry reduction); phase B relaxes to independent supports.
function sparseEnum(bg: number[], deadline: number): { u: number[]; v: number[]; w: number[]; mm: number; l1: number } {
  let best = { u: new Array<number>(NN).fill(0), v: new Array<number>(NN).fill(0), w: new Array<number>(NN).fill(0), mm: NT, l1: Number.MAX_SAFE_INTEGER }
  const t0 = Date.now()
  let evals = 0
  const pickSupport = (size: number): number[] => {
    const idx = [0, 1, 2, 3, 4, 5, 6, 7, 8]
    for (let i = idx.length - 1; i > 0; i--) {
      const j = randInt(i + 1)
      const t = idx[i] ?? 0
      idx[i] = idx[j] ?? 0
      idx[j] = t
    }
    return idx.slice(0, size)
  }
  const fillVec = (sup: number[]): number[] => {
    const v = new Array<number>(NN).fill(0)
    for (const i of sup) v[i] = SMALL[randInt(SMALL.length)] ?? 0
    return v
  }
  while (Date.now() < deadline) {
    const frac = (Date.now() - t0) / (deadline - t0)
    const size = 1 + randInt(3)
    let u: number[]
    let v: number[]
    let w: number[]
    if (frac < 0.33) {
      const sup = pickSupport(size)
      u = fillVec(sup)
      v = fillVec(sup)
      w = fillVec(sup)
    } else {
      u = fillVec(pickSupport(size))
      v = fillVec(pickSupport(size))
      w = fillVec(pickSupport(size))
    }
    evals++
    const s = scoreWith(bg, u, v, w)
    if (s.mm < best.mm || (s.mm === best.mm && s.l1 < best.l1)) {
      best = { u, v, w, mm: s.mm, l1: s.l1 }
      console.log(`T12b-ENUM evals=${evals} new-best mm=${s.mm} l1=${s.l1} shared=${frac < 0.33}`)
      if (s.mm === 0) break
    }
  }
  console.log(`T12b-ENUM evals=${evals} best mm=${best.mm} l1=${best.l1}`)
  return best
}

async function main(): Promise<void> {
  const t0 = Date.now()
  // Phase 1: drop-one sweep.
  const one: { drop: number; mm: number; l1: number }[] = []
  for (let d = 0; d < base.triples.length; d++) {
    const [U, V, W] = toMats([d])
    const g = baseGot(U, V, W)
    let mm = 0
    let l1 = 0
    for (let k = 0; k < NT; k++) {
      const dd = (g[k] ?? 0) - (target[k] ?? 0)
      if (dd !== 0) {
        mm++
        l1 += Math.abs(dd)
      }
    }
    one.push({ drop: d, mm, l1 })
  }
  one.sort((a, b) => a.mm - b.mm || a.l1 - b.l1)
  console.log(`T12b-DROP1 ${one.map((r) => `d${r.drop}=${r.mm}/${r.l1}`).join(" ")}`)
  // Phase 2: drop-two sweep, keep top 5.
  const two: { d1: number; d2: number; mm: number; l1: number }[] = []
  for (let d1 = 0; d1 < base.triples.length; d1++) {
    for (let d2 = d1 + 1; d2 < base.triples.length; d2++) {
      const [U, V, W] = toMats([d1, d2])
      const g = baseGot(U, V, W)
      let mm = 0
      let l1 = 0
      for (let k = 0; k < NT; k++) {
        const dd = (g[k] ?? 0) - (target[k] ?? 0)
        if (dd !== 0) {
          mm++
          l1 += Math.abs(dd)
        }
      }
      two.push({ d1, d2, mm, l1 })
    }
  }
  two.sort((a, b) => a.mm - b.mm || a.l1 - b.l1)
  console.log(`T12b-DROP2-top5 ${two.slice(0, 5).map((r) => `(${r.d1},${r.d2})=${r.mm}/${r.l1}`).join(" ")}`)
  // Phase 3: repair the best drop-one residual (rank 22 + 1 fresh = 23 effective,
  // but a 0-mismatch repair with a FRESH triple distinct from the dropped one
  // would give a new rank-23 family; rank 22 needs mm=0 without the fresh triple).
  const bestDrop = one[0]?.drop ?? 3
  const [BU, BV, BW] = toMats([bestDrop])
  const bg = baseGot(BU, BV, BW)
  const elapsed = Date.now() - t0
  const als = alsRepair(bg, t0 + BUDGET_MS * 0.6)
  const en = sparseEnum(bg, t0 + BUDGET_MS)
  console.log(`T12b-DROPK DONE drop=${bestDrop} als=${als.mm}/${als.l1} enum=${en.mm}/${en.l1} elapsedMs=${Date.now() - t0} sweeptime=${elapsed}`)
  const winner = als.mm < en.mm || (als.mm === en.mm && als.l1 <= en.l1) ? als : en
  await writeFile(
    join(HERE, "T12b_dropk_best.json"),
    JSON.stringify({ drop: bestDrop, mm: winner.mm, l1: winner.l1, u: winner.u, v: winner.v, w: winner.w }, null, 1),
  )
}

await main()
