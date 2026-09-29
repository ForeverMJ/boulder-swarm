export function solveAnagram(s: string, t: string): boolean {
  if (s.length !== t.length) return false
  const counts = new Map<string, number>()
  for (const ch of s) counts.set(ch, (counts.get(ch) ?? 0) + 1)
  for (const ch of t) {
    const c = (counts.get(ch) ?? 0) - 1
    if (c < 0) return false
    if (c === 0) counts.delete(ch)
    else counts.set(ch, c)
  }
  return counts.size === 0
}
