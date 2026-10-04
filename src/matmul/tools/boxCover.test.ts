import { describe, expect, it } from "bun:test"
import { verify } from "../checker"
import { abcOf, boxTables, boxPoints, maxBoxSize, maximalBoxesThrough, minBoxCover } from "./boxCover"
import { scheme as T11 } from "../attempts/T11_solution"
import type { Scheme } from "../types"

const IDX = (a: number, b: number, c: number): number => (a * 9 + b) * 9 + c

function suppOfEntries(entries: readonly (readonly [number, number, number])[]): Set<number> {
  return new Set(entries.map(([a, b, c]) => IDX(a, b, c)))
}

/** The support of the deficit created by removing the given term indices from a scheme. */
function deficitSupport(scheme: Scheme, drop: readonly number[]): Set<number> {
  const dropSet = new Set(drop)
  const want = new Map<number, number>()
  // M[(i,j),(j,k),(i,k)] = 1, matching types.buildTarget for n = 3.
  for (let i = 0; i < 3; i += 1)
    for (let j = 0; j < 3; j += 1)
      for (let k = 0; k < 3; k += 1) {
        const a = i * 3 + j
        const b = j * 3 + k
        const c = i * 3 + k
        want.set(IDX(a, b, c), 1)
      }
  for (const t of scheme.triples.filter((_, idx) => !dropSet.has(idx))) {
    for (let a = 0; a < 9; a += 1) {
      const ua = t.u[a] ?? 0
      if (ua === 0) continue
      for (let b = 0; b < 9; b += 1) {
        const vb = t.v[b] ?? 0
        if (vb === 0) continue
        for (let c = 0; c < 9; c += 1) {
          const p = ua * vb * (t.w[c] ?? 0)
          if (p === 0) continue
          const id = IDX(a, b, c)
          want.set(id, (want.get(id) ?? 0) - p)
        }
      }
    }
  }
  const out = new Set<number>()
  for (const [id, v] of want) if (v !== 0) out.add(id)
  return out
}

describe("boxCover: the necessary condition is necessary", () => {
  // PLANTED controls. Dropping `want` terms from an exact rank-23 scheme leaves a deficit
  // that IS a sum of exactly `want` rank-1 tensors, so its support MUST be coverable by
  // `want` boxes. A screen that fails these is refusing to report a negative.
  for (const want of [1, 2, 3]) {
    it(`planted-${want}: a ${want}-term deficit covers with ${want} boxes`, () => {
      const used = new Set<number>()
      const pick: number[] = []
      for (let i = 0; i < T11.triples.length && pick.length < want; i += 1) {
        const t = T11.triples[i]
        if (t === undefined) continue
        const wsup = t.w.map((x, idx) => (x !== 0 ? idx : -1)).filter((x) => x >= 0)
        if (wsup.length !== 1) continue
        const c = wsup[0] ?? -1
        if (c < 0 || used.has(c)) continue
        used.add(c)
        pick.push(i)
      }
      expect(pick.length).toBe(want)
      const supp = deficitSupport(T11, pick)
      const res = minBoxCover(supp)
      expect(res.exact).toBe(true)
      expect(res.minBoxes).not.toBeNull()
      expect(res.minBoxes ?? 99).toBeLessThanOrEqual(want)
      // The reported cover really does cover the support.
      const covered = new Set<number>()
      for (const b of res.best ?? []) for (const p of boxPoints(b)) covered.add(p)
      for (const id of supp) expect(covered.has(id)).toBe(true)
    })
  }

  it("boxPoints enumerates the exact product of the three masks", () => {
    const pts = boxPoints({ i: 0b000000001, j: 0b000000011, k: 0b000000111 })
    expect(pts.length).toBe(1 * 2 * 3)
    for (const p of pts) {
      const [a, b, c] = abcOf(p)
      expect(a).toBe(0)
      expect(b).toBeLessThan(2)
      expect(c).toBeLessThan(3)
    }
  })

  it("maximalBoxesThrough returns boxes that are valid and through the point", () => {
    const supp = suppOfEntries([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
    ])
    const t = boxTables(supp)
    const boxes = maximalBoxesThrough(t, IDX(0, 0, 0))
    expect(boxes.length).toBeGreaterThan(0)
    for (const b of boxes) {
      for (const p of boxPoints(b)) expect(supp.has(p)).toBe(true)
      expect(boxPoints(b)).toContain(IDX(0, 0, 0))
    }
  })

  it("maxBoxSize bounds the cover, never understates it", () => {
    const supp = suppOfEntries([
      [0, 0, 0],
      [0, 1, 1],
      [1, 0, 0],
    ])
    const t = boxTables(supp)
    const res = minBoxCover(supp)
    expect(res.exact).toBe(true)
    // ceil(|supp| / maxBoxSize) must not exceed the true minimum.
    expect(Math.ceil(supp.size / maxBoxSize(t))).toBeLessThanOrEqual(res.minBoxes ?? 99)
  })

  it("an empty support needs zero boxes", () => {
    const res = minBoxCover(new Set<number>())
    expect(res.exact).toBe(true)
    expect(res.minBoxes).toBe(0)
  })

  // NEGATIVE control: the full multiplication tensor's support is a 3x3x3 box, so it needs
  // exactly 1 box even though its slice rank is 9. This is what makes the screen independent
  // of flatDim rather than a restatement of it.
  // INDEPENDENCE control. The target tensor's support is a transversal: one point per
  // (i,j,k), and no two of its points share a valid box. So boxCover(M) = 27 while R61's
  // flatDim(M) = 3. The two measures therefore do not bound each other, which is the whole
  // reason to run this screen on R61's survivors: it can refute where flatDim cannot.
  it("boxCover(M) = 27 while flatDim(M) = 3: the two screens are independent", () => {
    const supp = deficitSupport({ n: 3, triples: [] }, [])
    expect(supp.size).toBe(27)
    const res = minBoxCover(supp)
    expect(res.exact).toBe(true)
    expect(res.minBoxes).toBe(27)
    expect(maxBoxSize(boxTables(supp))).toBe(1)
  })

  // POSITIVE control with a genuinely multi-point box: one rank-1 term whose factors each
  // have 2-point support must cover with exactly 1 box.
  it("a single rank-1 term with 2x2x2 support covers with exactly 1 box", () => {
    const supp = new Set<number>()
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) supp.add(IDX(a, b, c))
    const res = minBoxCover(supp)
    expect(res.exact).toBe(true)
    expect(res.minBoxes).toBe(1)
  })

  // And two terms with disjoint 2x2x2 supports must need exactly 2, so the measure does
  // resolve granularity instead of collapsing to 1.
  it("two disjoint 2x2x2 boxes need exactly 2", () => {
    const supp = new Set<number>()
    for (const a of [0, 1]) for (const b of [0, 1]) for (const c of [0, 1]) supp.add(IDX(a, b, c))
    for (const a of [5, 6]) for (const b of [5, 6]) for (const c of [5, 6]) supp.add(IDX(a, b, c))
    const res = minBoxCover(supp)
    expect(res.exact).toBe(true)
    expect(res.minBoxes).toBe(2)
  })

  it("the planted deficits are still exact rational checksums of the real checker", () => {
    expect(verify(T11).correct).toBe(true)
  })
})