export function solveGroupAnagrams(strs: readonly string[]): string[][] {
  const map = new Map<string, string[]>()
  for (const s of strs) {
    const key = [...s].sort().join("")
    const g = map.get(key)
    if (g) g.push(s)
    else map.set(key, [s])
  }
  return [...map.values()]
}
