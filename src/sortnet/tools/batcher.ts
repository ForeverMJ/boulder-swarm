import type { Comparator, Network } from "../types"

export function batcherNetwork(n: number): Network {
  const comparators: Comparator[] = []
  const merge = (start: number, length: number, stride: number): void => {
    const nextStride = stride * 2
    if (nextStride < length) {
      merge(start, length, nextStride)
      merge(start + stride, length, nextStride)
      for (let index = start + stride; index + stride < start + length; index += nextStride) {
        comparators.push([index, index + stride])
      }
      return
    }
    comparators.push([start, start + stride])
  }
  const sort = (start: number, length: number): void => {
    if (length <= 1) return
    const half = length / 2
    sort(start, half)
    sort(start + half, half)
    merge(start, length, 1)
  }

  let width = 1
  while (width < n) width *= 2
  sort(0, width)
  return { n, comparators: comparators.filter(([, right]) => right < n) }
}
