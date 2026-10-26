// Brace-balanced extraction: models pretty-print the FINAL plan JSON across lines,
// and a single-line regex truncates it into an unparseable fragment. The colon is
// optional: nemotron-3-ultra-free emits `FINAL {` (observed live, rounds 101-102).
// beam-free omits the marker entirely and writes bare JSON (round 115): fall back
// to the first brace-balanced object. Downstream schema validation rejects junk.
// Shared by opencodeWorker (agent output) and modelPool (probe verdict); keep it
// free of imports from either so neither direction creates a cycle.
export function parseFinal(out: string): string {
  let idx = -1
  for (const m of out.matchAll(/FINAL\s*:?/g)) idx = m.index
  const start = out.indexOf("{", idx === -1 ? 0 : idx)
  if (start === -1) return ""
  let depth = 0
  for (let i = start; i < out.length; i++) {
    const ch = out[i]
    if (ch === "{") depth++
    else if (ch === "}") {
      depth--
      if (depth === 0) return out.slice(start, i + 1)
    }
  }
  return ""
}
