export type Comparator = readonly [number, number]

export type Network = {
  readonly n: number
  readonly comparators: readonly Comparator[]
}

export type Verdict = {
  readonly correct: boolean
  readonly size: number
  readonly firstFailingInput?: number
}
