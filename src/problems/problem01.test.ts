import { describe, expect, test } from "bun:test"
import { solveTwoSum } from "./problem01"

describe("two-sum", () => {
  test("basic", () => {
    expect([...solveTwoSum([2, 7, 11, 15], 9)].sort()).toEqual([0, 1])
  })
  test("negative", () => {
    expect([...solveTwoSum([-3, 4, 3, 90], 0)].sort()).toEqual([0, 2])
  })
  test("duplicate", () => {
    expect([...solveTwoSum([3, 3], 6)].sort()).toEqual([0, 1])
  })
  test("large target", () => {
    expect([...solveTwoSum([1, 2, 5, 9], 11)].sort()).toEqual([1, 3])
  })
  test("first last", () => {
    expect([...solveTwoSum([5, 1, 4, 2], 7)].sort()).toEqual([0, 3])
  })
})
