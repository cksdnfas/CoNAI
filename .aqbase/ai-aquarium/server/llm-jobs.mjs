import { setTimeout as delay } from 'node:timers/promises'

// A bounded stop-confirmation wait, not a deadline on profile generation.
const CANCEL_WAIT_MS = 10_000
const cancellations = new WeakMap()

/** Cancellation acknowledges intent first. Read the terminal job afresh for its final delivery receipt. */
export function cancelAndWait(conai, jobId, world) {
  let jobs = cancellations.get(world)
  if (!jobs) { jobs = new Map(); cancellations.set(world, jobs) }
  if (jobs.has(jobId)) return jobs.get(jobId)
  const promise = (async () => {
    await conai.llm.cancel(jobId)
    const deadline = Date.now() + CANCEL_WAIT_MS
    for (;;) {
      const job = await conai.llm.get(jobId)
      if (!['queued', 'running'].includes(job.status)) return job
      if (Date.now() >= deadline) throw new Error('AI 작업 중단이 아직 끝나지 않았어. 슬롯은 지우지 않았어. 잠시 뒤 다시 시도해줘.')
      await delay(Math.max(1, Math.min(250, deadline - Date.now())))
    }
  })()
  jobs.set(jobId, promise)
  const remove = () => jobs.delete(jobId)
  void promise.then(remove, remove)
  return promise
}

/** Include cancellation already started by failure/away paths after their conversation was removed. */
export async function waitForCancellations(world) {
  while (cancellations.get(world)?.size) await Promise.all([...cancellations.get(world).values()])
}
