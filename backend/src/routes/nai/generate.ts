import { requirePermission } from '../../middleware/authMiddleware';
import { Router, type Request, type Response } from 'express'
import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import sharp from 'sharp'
import { normalizeBase64ImageData } from '../../utils/nai/requestBuilder'
import { getToken } from '../../utils/nai/auth'

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

router.post('/encode-vibe', requirePermission('generation.execute'), async (req: Request<{}, {}, { image?: string; model?: string; information_extracted?: number }>, res: Response): Promise<void> => {
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

router.post('/upscale', requirePermission('generation.execute'), requirePermission('images.view'), async (req: Request<{}, {}, { image?: string; scale?: number }>, res: Response): Promise<void> => {
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
    const response = await axios.post('https://image.novelai.net/ai/upscale', {
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
