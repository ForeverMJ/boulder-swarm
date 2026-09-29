export function solveMerge(intervals: readonly (readonly [number, number])[]): [number, number][] {
  if (intervals.length === 0) return []
  const sorted = [...intervals].sort((a, b) => a[0] - b[0])
  const first = sorted[0]
  if (first === undefined) return []
  const out: [number, number][] = [[first[0], first[1]]]
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]
    if (cur === undefined) continue
    const last = out[out.length - 1]
    if (last === undefined) continue
    if (cur[0] <= last[1]) {
      last[1] = Math.max(last[1], cur[1])
    } else {
      out.push([cur[0], cur[1]])
    }
  }
  return out
}
