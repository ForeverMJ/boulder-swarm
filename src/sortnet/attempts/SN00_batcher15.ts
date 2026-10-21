import { batcherNetwork } from "../tools/batcher"
import type { Network } from "../types"

export const network: Network = batcherNetwork(15)
