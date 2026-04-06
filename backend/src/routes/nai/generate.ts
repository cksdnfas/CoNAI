import { Router, type Request, type Response } from 'express'
import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import { preprocessMetadata, type NAIMetadataInputParams, type NAIMetadataParams } from '../../utils/nai/metadata'
import { buildNaiRequestBody, normalizeBase64ImageData } from '../../utils/nai/requestBuilder'
import { getToken } from '../../utils/nai/auth'
import { GenerationHistoryService } from '../../services/generationHistoryService'
import type { GeneratedImageSaveOptions } from '../../utils/fileSaver'

const router = Router()

/** Resolve a usable NovelAI token from the request header or persisted backend auth. */
function resolveToken(req: Request) {
  return req.headers.authorization?.replace('Bearer ', '') || getToken()
}

/** Extract the best error message from a NovelAI HTTP failure. */
function resolveNaiErrorMessage(error: any) {
  let errorMessage = error.message

  if (error.response?.data) {
    try {
      const errorData = Buffer.isBuffer(error.response.data)
        ? JSON.parse(error.response.data.toString())
        : error.response.data
      errorMessage = errorData.message || errorData.statusMessage || errorMessage
      console.error('[NAI Generate] Parsed error data:', errorData)
    } catch (parseError) {
      const dataStr = Buffer.isBuffer(error.response.data)
        ? error.response.data.toString()
        : JSON.stringify(error.response.data)
      console.error('[NAI Generate] Raw error data (parse failed):', dataStr)
      console.error('[NAI Generate] Parse error:', parseError)
    }
  }

  return errorMessage
}

/** Send a consistent error response for NovelAI route failures. */
function respondWithNaiError(res: Response, error: any, fallbackError: string) {
  console.error('[NAI Generate] Full error:', {
    message: error.message,
    status: error.response?.status,
    statusText: error.response?.statusText,
    hasData: !!error.response?.data,
    code: error.code,
  })

  const errorMessage = resolveNaiErrorMessage(error)

  if (error.response?.status === 401) {
    res.status(401).json({ error: 'Invalid or expired token' })
    return
  }

  if (error.response?.status === 402) {
    res.status(402).json({ error: 'Active subscription required' })
    return
  }

  if (error.code === 'ECONNABORTED') {
    res.status(408).json({ error: 'Request timeout. Try again.' })
    return
  }

  res.status(500).json({
    error: fallbackError,
    details: errorMessage,
  })
}

/** Parse a zipped NovelAI image response into a base64 image list. */
function unpackGeneratedImages(payload: Buffer) {
  const zip = new AdmZip(payload)
  return zip.getEntries().map((entry: any, index: number) => ({
    filename: `nai_${Date.now()}_${index}.png`,
    data: entry.getData().toString('base64'),
  }))
}

router.post('/image', async (req: Request<{}, {}, NAIMetadataInputParams & { imageSaveOptions?: GeneratedImageSaveOptions }>, res: Response): Promise<void> => {
  try {
    const token = resolveToken(req)
    if (!token) {
      res.status(401).json({ error: 'NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.' })
      return
    }

    const metadata = preprocessMetadata(req.body)
    const requestBody = await buildNaiRequestBody(metadata)

    console.log('[NAI Generate] Request params:', {
      resolution: `${metadata.width}x${metadata.height}`,
      steps: metadata.steps,
      model: requestBody.model,
      sampler: metadata.sampler,
      scheduler: metadata.noise_schedule,
      scale: metadata.scale,
      n_samples: metadata.n_samples,
      characterCount: metadata.characters?.length || 0,
      vibeCount: metadata.vibes?.length || 0,
      characterReferenceCount: metadata.character_refs?.length || 0,
      tokenLength: token.length,
      tokenPrefix: token.substring(0, 10) + '...',
    })

    const response = await axios.post('https://image.novelai.net/ai/generate-image', requestBody, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'https://novelai.net',
        Referer: 'https://novelai.net',
      },
      responseType: 'arraybuffer',
      timeout: 120000,
    })

    const images = unpackGeneratedImages(Buffer.from(response.data))
    const historyIds: number[] = []

    try {
      const groupId = metadata.groupId

      for (let index = 0; index < images.length; index += 1) {
        const historyId = await GenerationHistoryService.createNAIHistory({
          model: metadata.model || 'unknown',
          sampler: metadata.sampler || 'unknown',
          seed: (metadata.seed || 0) + index,
          steps: metadata.steps || 28,
          scale: metadata.scale || 7.0,
          parameters: requestBody.parameters,
          positivePrompt: metadata.prompt,
          negativePrompt: metadata.negative_prompt,
          width: metadata.width || 1024,
          height: metadata.height || 1024,
          groupId,
          metadata: {
            action: metadata.action,
            n_samples: metadata.n_samples,
            batch_index: index,
            noise_schedule: metadata.noise_schedule,
          },
        })

        historyIds.push(historyId)

        const imageBuffer = Buffer.from(images[index].data, 'base64')
        GenerationHistoryService.processAndUploadImage(historyId, imageBuffer, 'novelai', req.body.imageSaveOptions)
          .catch((historyError) => console.error(`[NAI Generate] Background upload failed for history ${historyId}:`, historyError))
      }
    } catch (historyError) {
      console.error('[NAI Generate] Failed to create history:', historyError)
      res.status(500).json({
        error: 'Failed to create generation history',
        details: historyError instanceof Error ? historyError.message : 'Unknown error',
      })
      return
    }

    res.json({
      historyIds,
      count: historyIds.length,
      metadata: {
        prompt: metadata.prompt,
        negative_prompt: metadata.negative_prompt,
        seed: metadata.seed,
        resolution: `${metadata.width}x${metadata.height}`,
        steps: metadata.steps,
        scale: metadata.scale,
        sampler: metadata.sampler,
        scheduler: metadata.noise_schedule,
        model: requestBody.model,
      },
    })
  } catch (error: any) {
    respondWithNaiError(res, error, 'Image generation failed')
  }
})

router.post('/encode-vibe', async (req: Request<{}, {}, { image?: string; model?: string; information_extracted?: number }>, res: Response): Promise<void> => {
  try {
    const token = resolveToken(req)
    if (!token) {
      res.status(401).json({ error: 'NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.' })
      return
    }

    const image = normalizeBase64ImageData(req.body.image)
    if (!image) {
      res.status(400).json({ error: 'Vibe 인코딩에는 이미지가 필요합니다.' })
      return
    }

    const response = await axios.post('https://image.novelai.net/ai/encode-vibe', {
      image,
      model: req.body.model || 'nai-diffusion-4-5-curated',
      information_extracted: typeof req.body.information_extracted === 'number' ? req.body.information_extracted : 1,
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Origin: 'https://novelai.net',
        Referer: 'https://novelai.net',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    })

    res.json({
      encoded: Buffer.from(response.data).toString('base64'),
    })
  } catch (error: any) {
    respondWithNaiError(res, error, 'Vibe encode failed')
  }
})

router.post('/upscale', async (req: Request<{}, {}, { image?: string; scale?: number }>, res: Response): Promise<void> => {
  try {
    const token = resolveToken(req)
    if (!token) {
      res.status(401).json({ error: 'NovelAI 인증이 필요합니다. 먼저 토큰으로 로그인하세요.' })
      return
    }

    const image = normalizeBase64ImageData(req.body.image)
    if (!image) {
      res.status(400).json({ error: '업스케일에는 원본 이미지가 필요합니다.' })
      return
    }

    const imageBuffer = Buffer.from(image, 'base64')
    const imageMetadata = await sharp(imageBuffer).metadata()
    const response = await axios.post('https://api.novelai.net/ai/upscale', {
      image,
      width: imageMetadata.width,
      height: imageMetadata.height,
      scale: typeof req.body.scale === 'number' ? req.body.scale : 2,
    }, {
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      responseType: 'arraybuffer',
      timeout: 60000,
    })

    const upscaledZip = new AdmZip(Buffer.from(response.data))
    const firstEntry = upscaledZip.getEntries()[0]
    if (!firstEntry) {
      res.status(500).json({ error: 'Upscale returned no image data' })
      return
    }

    res.json({
      image: firstEntry.getData().toString('base64'),
      filename: `nai-upscale-${Date.now()}.png`,
      sourceBytes: imageBuffer.length,
    })
  } catch (error: any) {
    respondWithNaiError(res, error, 'Upscale failed')
  }
})

export default router
