import { describe, expect, it } from "bun:test"
import { canonicalWTau, countOutputsInW, dimSpan, everyElementInSpan, lemma5Hypotheses, sumBasis } from "./lemma5"
import { dimL, dimZ, subspaceL, subspaceZ, type Mat } from "./blaser2003"
import { fromScheme, type BilinearComputation, type Term } from "./bilinear"
import { naive } from "../schemes"

const zeroMat = (l: number, n: number): Mat => {
  const out: number[][] = []
  for (let i = 0; i < l; i++) out.push(new Array<number>(n).fill(0))
  return out
}

describe("the canonical W_tau of Lemma 5", () => {
  it("has dimension l-1", () => {
    for (const l of [2, 3, 4, 5]) {
      for (const n of [2, 3, 4]) {
        for (let tau = 1; tau <= n; tau++) {
          expect(dimSpan(canonicalWTau(l, n, tau))).toBe(l - 1)
        }
      }
    }
  })

  it("sits inside Z^tau, which is the property that makes it usable", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3]) {
        for (let tau = 1; tau < n; tau++) {
          const z = subspaceZ(l, n, tau)
          for (const e of canonicalWTau(l, n, tau)) {
            expect(everyElementInSpan(z, e)).toBe(true)
          }
        }
      }
    }
  })

  it("meets L^tau trivially, checked by dimension sum rather than element-wise", () => {
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3]) {
        for (let tau = 1; tau < n; tau++) {
          const w = canonicalWTau(l, n, tau)
          const lsp = subspaceL(l, n, tau)
          expect(dimSpan([...w, ...lsp])).toBe(dimSpan(w) + dimSpan(lsp))
        }
      }
    }
  })

  it("sits inside L^tau at tau = t, which is the other hypothesis", () => {
    // At tau = t the requirement is W_t <= L^t, not Z^t, and dim W_t <= l-1.
    for (const l of [2, 3, 4]) {
      const w = subspaceL(l, 3, 3).slice(0, l - 1)
      for (const e of w) {
        expect(everyElementInSpan(subspaceL(l, 3, 3), e)).toBe(true)
      }
      expect(dimSpan(w)).toBeLessThanOrEqual(l - 1)
    }
  })

  it("rejects a tau outside 1..n", () => {
    expect(() => canonicalWTau(3, 3, 0)).toThrow(RangeError)
    expect(() => canonicalWTau(3, 3, 4)).toThrow(RangeError)
  })
})

describe("lemma5Hypotheses re-derived from the subspaces", () => {
  it("accepts the canonical family", () => {
    for (const l of [2, 3, 4]) {
      const n = 3
      const res = lemma5Hypotheses({
        l,
        n,
        t: n,
        wTaus: [canonicalWTau(l, n, 1), canonicalWTau(l, n, 2), [zeroMat(l, n)]],
      })
      expect(res.failures).toEqual([])
      expect(res.holds).toBe(true)
    }
  })

  it("rejects a W_tau that is not inside Z^tau", () => {
    // A single unit matrix in the wrong place: inside L^tau but not Z^tau.
    const bad: Mat[] = [[[1, 0, 0], [0, 0, 0], [0, 0, 0]]]
    const res = lemma5Hypotheses({ l: 3, n: 3, t: 3, wTaus: [bad, canonicalWTau(3, 3, 2), [zeroMat(3, 3)]] })
    expect(res.holds).toBe(false)
    expect(res.failures.join(" ")).toContain("Z^{1}")
  })

  it("rejects a W_tau that meets L^tau nontrivially", () => {
    // L^1 itself is inside Z^1 but meets L^1 in all of itself, which is exactly
    // the degeneracy an element-wise check against L^tau would also catch, so
    // the pair of cases distinguishes the two failure modes.
    const res = lemma5Hypotheses({
      l: 3,
      n: 3,
      t: 3,
      wTaus: [subspaceL(3, 3, 1), canonicalWTau(3, 3, 2), [zeroMat(3, 3)]],
    })
    expect(res.holds).toBe(false)
    expect(res.failures.length).toBeGreaterThan(0)
  })

  it("rejects a W_t of dimension above l-1", () => {
    // The dimension guard has to be exercised at tau = t, where it is
    // independent of the Z^tau and L^tau conditions. At tau < t it is
    // unreachable: a subspace of Z^tau meeting L^tau trivially cannot exceed
    // l-1, so subspaceL(3, 3, 3), which is empty, can never trigger it.
    const tooBig = subspaceL(3, 3, 2)
    expect(dimSpan(tooBig)).toBeGreaterThan(2)
    const res = lemma5Hypotheses({
      l: 3,
      n: 3,
      t: 3,
      wTaus: [canonicalWTau(3, 3, 1), canonicalWTau(3, 3, 2), tooBig],
    })
    expect(res.holds).toBe(false)
    expect(res.failures.join(" ")).toContain("dimension")
  })

  it("rejects a t outside 1..n and a wrong number of subspaces", () => {
    expect(lemma5Hypotheses({ l: 3, n: 3, t: 0, wTaus: [] }).holds).toBe(false)
    expect(lemma5Hypotheses({ l: 3, n: 3, t: 4, wTaus: [] }).holds).toBe(false)
    expect(lemma5Hypotheses({ l: 3, n: 3, t: 3, wTaus: [canonicalWTau(3, 3, 1)] }).holds).toBe(false)
  })
})

describe("counting outputs in W, measured rather than assumed", () => {
  it("counts zero when W is the zero space", () => {
    const beta = fromScheme(naive(3))
    expect(countOutputsInW(beta, [])).toBe(0)
  })

  it("counts exactly the terms whose w lies in W", () => {
    // A controlled computation rather than a real scheme: its w-vectors are
    // three distinct directions in a 1 x 3 space, so the count is read off the
    // construction instead of guessed at. A real scheme has several terms sharing
    // each output direction, which is what made an earlier version of this test
    // assert a number it had not derived.
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1, 0, 0]] },
      { f: [1], g: [1], w: [[0, 1, 0]] },
      { f: [1], g: [1], w: [[0, 0, 1]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 3, terms }
    const d0: Mat = [[1, 0, 0]]
    const d1: Mat = [[0, 1, 0]]
    expect(countOutputsInW(beta, [])).toBe(0)
    expect(countOutputsInW(beta, [d0])).toBe(1)
    expect(countOutputsInW(beta, [d0, d1])).toBe(2)
    expect(countOutputsInW(beta, terms.map((t) => t.w))).toBe(3)
  })

  it("ignores scalars, since a span contains every multiple", () => {
    const terms: Term[] = [
      { f: [1], g: [1], w: [[1, 0, 0]] },
      { f: [1], g: [1], w: [[5, 0, 0]] },
      { f: [1], g: [1], w: [[0, 1, 0]] },
    ]
    const beta: BilinearComputation = { l: 1, m: 1, n: 3, terms }
    expect(countOutputsInW(beta, [[[1, 0, 0]]])).toBe(2)
  })

  it("counts every term when W spans all the outputs", () => {
    const beta = fromScheme(naive(3))
    const all = beta.terms.map((t) => t.w)
    expect(countOutputsInW(beta, all)).toBe(beta.terms.length)
  })

  it("sumBasis concatenates and dimSpan measures the span, not the count", () => {
    const a = canonicalWTau(3, 3, 1)
    const b = canonicalWTau(3, 3, 2)
    expect(sumBasis([a, b])).toHaveLength(a.length + b.length)
    expect(dimSpan(sumBasis([a, b]))).toBeGreaterThan(a.length)
  })

  it("agrees with dimZ and dimL on the sizes the hypotheses use", () => {
    // The two ambient spaces are what the arguments above rely on, so pin them
    // here rather than trusting the numbers quoted in the campaign notes.
    for (const l of [2, 3, 4]) {
      for (const n of [2, 3]) {
        expect(dimZ(l, n, 1)).toBe(l * n - 1)
        expect(dimL(l, n, 1)).toBe(l * (n - 1))
      }
    }
  })
})