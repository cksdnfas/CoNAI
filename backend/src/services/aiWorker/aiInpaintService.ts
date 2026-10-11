import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import sharp from 'sharp'
import { runtimePaths } from '../../config/runtimePaths'
import { aiGpuReady, checkAiDependencies, visionWorker } from './aiVisionService'
import { AiWorkerError } from './aiWorkerClient'

/** Longest side the editor sends; LaMa works on the crop around the painted area, never the whole picture. */
export const INPAINT_MAX_SIDE = 2048

/** What the worker and worker_lama import; the taggers' and embedders' libraries aren't needed. */
const INPAINT_PACKAGES = ['torch', 'huggingface-hub', 'pillow', 'numpy'] as const

type InpaintReply = { width: number; height: number; device: string }

/**
 * Fill the white part of `mask` in `image` with the anime/manga LaMa model (image editor AI erase).
 * Both inputs are encoded images of the same size; the result is a PNG of that size.
 */
export async function inpaintImage(image: Buffer, mask: Buffer): Promise<Buffer> {
  const dependencies = await checkAiDependencies(INPAINT_PACKAGES)
  if (!dependencies.available) {
    throw new AiWorkerError(dependencies.message, 'MissingDependency')
  }
  const [imageMeta, maskMeta] = await Promise.all([sharp(image).metadata(), sharp(mask).metadata()])
  if (!imageMeta.width || !imageMeta.height || imageMeta.width !== maskMeta.width || imageMeta.height !== maskMeta.height) {
    throw new AiWorkerError('Image and mask must be images of the same size', 'InvalidInput')
  }
  if (Math.max(imageMeta.width, imageMeta.height) > INPAINT_MAX_SIDE) {
    throw new AiWorkerError(`Inpaint input is limited to ${INPAINT_MAX_SIDE}px per side`, 'InvalidInput')
  }

  const base = path.join(runtimePaths.tempDir, `inpaint-${randomUUID()}`)
  const files = { image: `${base}-image.png`, mask: `${base}-mask.png`, output: `${base}-out.png` }
  try {
    // Re-encode both as PNG: the worker only reads PNG it can trust, whatever the browser sent.
    await Promise.all([
      sharp(image).png().toFile(files.image),
      sharp(mask).greyscale().png().toFile(files.mask),
    ])
    const device = (await aiGpuReady()) ? 'cuda' : 'cpu'
    const reply = await visionWorker.request<InpaintReply>('inpaint', { ...files, device }, { priority: 'high' })
    visionWorker.touch('lama', reply.device)
    return await fs.promises.readFile(files.output)
  } finally {
    await Promise.all(Object.values(files).map((file) => fs.promises.rm(file, { force: true })))
  }
}
