import { describe, expect, test } from "bun:test"
import { solveMerge } from "./problem04"

describe("merge-intervals", () => {
  test("overlap", () => {
    expect(
      solveMerge([
        [1, 3],
        [2, 6],
        [8, 10],
        [15, 18],
      ]),
    ).toEqual([
      [1, 6],
      [8, 10],
      [15, 18],
    ])
  })
  test("touching", () => {
    expect(
      solveMerge([
        [1, 4],
        [4, 5],
      ]),
    ).toEqual([[1, 5]])
  })
  test("single", () => {
    expect(solveMerge([[1, 2]])).toEqual([[1, 2]])
  })
  test("empty", () => {
    expect(solveMerge([])).toEqual([])
  })
  test("unsorted", () => {
    expect(
      solveMerge([
        [4, 5],
        [1, 3],
      ]),
    ).toEqual([
      [1, 3],
      [4, 5],
    ])
  })
})
