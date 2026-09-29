export function solveLength(s: string): number {
  const last = new Map<string, number>()
  let start = 0
  let best = 0
  const chars = [...s]
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (ch === undefined) continue
    const prev = last.get(ch)
    if (prev !== undefined && prev >= start) start = prev + 1
    last.set(ch, i)
    best = Math.max(best, i - start + 1)
  }
  return best
}
