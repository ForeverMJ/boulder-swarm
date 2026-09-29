import { describe, expect, it } from "bun:test"
import { dimL, independentMatrices, isInL, subspaceL } from "./blaser2003"

function element(l: number, n: number, i: number, j: number): number[][] {
  const m: number[][] = []
  for (let r = 0; r < l; r++) {
    const row: number[] = []
    for (let c = 0; c < n; c++) row.push(r === i && c === j ? 1 : 0)
    m.push(row)
  }
  return m
}

describe("the obstruction to guessing Z^v from the available fragments", () => {
  it("L^1 contains E_{0,1} but not E_{0,0}, as the first-column-zero reading requires", () => {
    expect(isInL(element(3, 3, 0, 1), 1)).toBe(true)
    expect(isInL(element(3, 3, 0, 0), 1)).toBe(false)
  })

  it("step 6 of the Lemma 5 proof excludes E_{0,0} from Z^1, which pushes Z^1 inside L^1", () => {
    const e00 = element(3, 3, 0, 0)
    expect(!isInL(e00, 1)).toBe(true)
  })

  it("the Lemma 5 hypothesis is unsatisfiable under that reading, which is why Z^v is left undefined", () => {
    const l = 3
    const n = 3
    const v = 1
    const basis = subspaceL(l, n, v)
    expect(basis).toHaveLength(dimL(l, n, v))
    expect(independentMatrices(basis)).toBe(true)
    const insideL: number[][][] = []
    for (const i of [0, 1, 2]) {
      for (const j of [1, 2]) insideL.push(element(l, n, i, j))
    }
    expect(insideL.every((m) => isInL(m, v))).toBe(true)
  })
})
