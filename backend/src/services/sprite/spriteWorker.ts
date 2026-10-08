import { parentPort } from 'worker_threads'
import { isSpriteError } from './spriteErrors'
import { SPRITE_TASKS, type SpriteTaskName } from './spriteTasks'

/**
 * Sprite worker thread entry. Receives `{ type: 'run', id, task, payload }`, runs the task from spriteTasks (pure file
 * work, no databases) and answers `{ type: 'progress' | 'result' | 'error', id, … }`. `{ type: 'cancel', id }` aborts
 * a running task (ffmpeg is killed, pixel loops stop at the next frame).
 */

type Incoming =
  | { type: 'run'; id: number; task: SpriteTaskName; payload: unknown }
  | { type: 'cancel'; id: number }

const controllers = new Map<number, AbortController>()

parentPort?.on('message', (message: Incoming) => {
  if (message.type === 'cancel') {
    controllers.get(message.id)?.abort()
    return
  }
  if (message.type !== 'run') return
  const controller = new AbortController()
  controllers.set(message.id, controller)
  const task = SPRITE_TASKS[message.task] as (payload: unknown, ctx: unknown) => Promise<unknown>
  void (async () => {
    try {
      if (!task) throw new Error(`Unknown sprite task: ${message.task}`)
      const result = await task(message.payload, {
        signal: controller.signal,
        progress: (progress: unknown) => parentPort?.postMessage({ type: 'progress', id: message.id, progress }),
      })
      parentPort?.postMessage({ type: 'result', id: message.id, result })
    } catch (error) {
      parentPort?.postMessage({
        type: 'error',
        id: message.id,
        error: {
          message: error instanceof Error ? error.message : String(error),
          sprite: isSpriteError(error),
          statusCode: isSpriteError(error) ? error.statusCode : undefined,
        },
      })
    } finally {
      controllers.delete(message.id)
    }
  })()
})
