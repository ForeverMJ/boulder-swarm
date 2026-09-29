export function solveTwoSum(nums: readonly number[], target: number): readonly [number, number] {
  const seen = new Map<number, number>()
  for (let i = 0; i < nums.length; i++) {
    const v = nums[i]
    if (v === undefined) continue
    const need = target - v
    const j = seen.get(need)
    if (j !== undefined) return [j, i]
    seen.set(v, i)
  }
  throw new RangeError("no solution")
}
