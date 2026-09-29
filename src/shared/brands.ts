export type Brand<T, Name extends string> = T & { readonly __brand: Name }

export type TaskId = Brand<string, "TaskId">
export type WorkerId = Brand<number, "WorkerId">

export function taskId(s: string): TaskId {
  return s as TaskId
}

export function workerId(n: number): WorkerId {
  return n as WorkerId
}
