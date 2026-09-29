import { describe, expect, test } from "bun:test"
import { solveGroupAnagrams } from "./problem08"

function norm(groups: string[][]): string[][] {
  return groups.map((g) => [...g].sort()).sort((a, b) => a.join(",").localeCompare(b.join(",")))
}

describe("group-anagrams", () => {
  test("basic", () => {
    expect(norm(solveGroupAnagrams(["eat", "tea", "tan", "ate", "nat", "bat"]))).toEqual(
      norm([
        ["bat"],
        ["nat", "tan"],
        ["ate", "eat", "tea"],
      ]),
    )
  })
  test("empty string", () => {
    expect(norm(solveGroupAnagrams([""]))).toEqual(norm([[""]]))
  })
  test("single char", () => {
    expect(norm(solveGroupAnagrams(["a"]))).toEqual(norm([["a"]]))
  })
  test("all same", () => {
    expect(norm(solveGroupAnagrams(["ab", "ba", "ab"]))).toEqual(norm([["ab", "ba", "ab"]]))
  })
  test("no anagrams", () => {
    expect(norm(solveGroupAnagrams(["abc", "def", "ghi"]))).toEqual(norm([["abc"], ["def"], ["ghi"]]))
  })
})
