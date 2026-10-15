import type { PixelPreviewProfile } from './image-detail-pixel-preview-utils'

type PixelPreviewWorkerProfile = Pick<PixelPreviewProfile, 'colorCount' | 'ditherStrength' | 'edgeBoost' | 'sharpness'>

export type PixelPreviewWorkerResponse = {
  imageData: ImageData
  warning?: string
}

/** Start a cancellable worker task for expensive pixel-preview processing. */
export function createPixelPreviewWorkerTask(imageData: ImageData, profile: PixelPreviewWorkerProfile, signal?: AbortSignal) {
  let worker: Worker | null = null
  let settled = false
  let rejectTask: (error: unknown) => void
  const cleanup = () => {
    settled = true
    signal?.removeEventListener('abort', cancel)
    if (worker) {
      worker.onmessage = null
      worker.onerror = null
      worker.onmessageerror = null
      worker.terminate()
      worker = null
    }
  }
  const fail = (error: unknown) => {
    if (settled) return
    cleanup()
    rejectTask(error)
  }
  const cancel = () => fail(new DOMException('Aborted', 'AbortError'))

  const promise = new Promise<PixelPreviewWorkerResponse>((resolve, reject) => {
    rejectTask = reject
    if (signal?.aborted) { cancel(); return }
    try {
      worker = new Worker(new URL('./image-detail-pixel-preview.worker.ts', import.meta.url), { type: 'module' })
      worker.onmessage = (event: MessageEvent<PixelPreviewWorkerResponse>) => {
        if (settled) return
        cleanup()
        resolve(event.data)
      }
      worker.onerror = fail
      worker.onmessageerror = () => fail(new Error('Could not read pixel preview result.'))
      signal?.addEventListener('abort', cancel, { once: true })
      worker.postMessage({ imageData, profile }, [imageData.data.buffer])
    } catch (error) {
      fail(error)
    }
  })

  return { promise, cancel }
}
