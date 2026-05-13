import type { PixelPreviewProfile } from './image-detail-pixel-preview-utils'

type PixelPreviewWorkerProfile = Pick<PixelPreviewProfile, 'colorCount' | 'ditherStrength' | 'edgeBoost' | 'sharpness'>

export type PixelPreviewWorkerResponse = {
  imageData: ImageData
  warning?: string
}

/** Start a cancellable worker task for expensive pixel-preview processing. */
export function createPixelPreviewWorkerTask(imageData: ImageData, profile: PixelPreviewWorkerProfile) {
  const worker = new Worker(new URL('./image-detail-pixel-preview.worker.ts', import.meta.url), { type: 'module' })
  let settled = false

  const promise = new Promise<PixelPreviewWorkerResponse>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<PixelPreviewWorkerResponse>) => {
      settled = true
      worker.terminate()
      resolve(event.data)
    }
    worker.onerror = (error) => {
      settled = true
      worker.terminate()
      reject(error)
    }
    worker.postMessage({ imageData, profile }, [imageData.data.buffer])
  })

  return {
    promise,
    cancel: () => {
      if (!settled) {
        worker.terminate()
      }
    },
  }
}
