export function solveSearch(nums: readonly number[], target: number): number {
  let lo = 0
  let hi = nums.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const v = nums[mid]
    if (v === undefined) break
    if (v === target) return mid
    if (v < target) lo = mid + 1
    else hi = mid - 1
  }
  return -1
}
