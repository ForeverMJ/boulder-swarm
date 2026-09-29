const PAIRS: Readonly<Record<string, string>> = { ")": "(", "]": "[", "}": "{" } as const

export function solveValid(s: string): boolean {
  const stack: string[] = []
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") {
      stack.push(ch)
    } else {
      const open = PAIRS[ch]
      if (open === undefined) return false
      if (stack.pop() !== open) return false
    }
  }
  return stack.length === 0
}
