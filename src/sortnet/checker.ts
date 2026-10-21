import type { Network, Verdict } from "./types"

export function verify(network: Network): Verdict {
  const size = network.comparators.length
  if (!Number.isInteger(network.n) || network.n < 1 || network.n > 16) {
    return { correct: false, size }
  }
  for (const [left, right] of network.comparators) {
    const validLeft = Number.isInteger(left) && left >= 0 && left < network.n
    const validRight = Number.isInteger(right) && right >= 0 && right < network.n
    if (!validLeft || !validRight || left === right) {
      return { correct: false, size }
    }
  }

  const inputCount = 2 ** network.n
  for (let input = 0; input < inputCount; input++) {
    const values = Array.from({ length: network.n }, (_, wire) => (input >> wire) & 1)
    for (const [leftIndex, rightIndex] of network.comparators) {
      const left = values[leftIndex] ?? 0
      const right = values[rightIndex] ?? 0
      if (left > right) {
        values[leftIndex] = right
        values[rightIndex] = left
      }
    }
    for (let wire = 1; wire < values.length; wire++) {
      if ((values[wire - 1] ?? 0) > (values[wire] ?? 0)) {
        return { correct: false, size, firstFailingInput: input }
      }
    }
  }
  return { correct: true, size }
}
