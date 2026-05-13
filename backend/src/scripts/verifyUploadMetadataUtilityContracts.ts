import assert from 'node:assert/strict'
import type { Response } from 'express'
import {
  buildExtractedImagePreview,
  parseMetadataPatch,
  parseMultipartNumber,
  parseUploadImageSaveOptions,
  resolveOutputFormat,
  setDownloadResponseHeaders,
} from '../routes/images/uploadRouteHelpers'

class CapturedResponse {
  headers = new Map<string, string>()

  setHeader(name: string, value: string) {
    this.headers.set(name.toLowerCase(), value)
    return this
  }
}

function createImageFile(overrides: Partial<Express.Multer.File> = {}): Express.Multer.File {
  return {
    fieldname: 'image',
    originalname: 'sample.png',
    encoding: '7bit',
    mimetype: 'image/png',
    size: 1234,
    destination: '',
    filename: 'sample-upload.png',
    path: 'sample-upload.png',
    buffer: Buffer.alloc(0),
    stream: null as never,
    ...overrides,
  }
}

function verifyMultipartNumberParsing() {
  assert.equal(parseMultipartNumber(82, 90), 82)
  assert.equal(parseMultipartNumber('82.5', 90), 82.5)
  assert.equal(parseMultipartNumber('', 90), 90)
  assert.equal(parseMultipartNumber('not-a-number', 90), 90)
  assert.equal(parseMultipartNumber(Number.POSITIVE_INFINITY, 90), 90)
}

function verifyUploadSaveOptionParsing() {
  assert.deepEqual(parseUploadImageSaveOptions({
    enabled: 'true',
    format: 'JPG',
    quality: '82.5',
    resizeEnabled: 'false',
    maxWidth: '1024.4',
    maxHeight: '2048.6',
  }), {
    enabled: true,
    format: 'jpeg',
    quality: 83,
    resizeEnabled: false,
    maxWidth: 1024,
    maxHeight: 2049,
  })

  assert.deepEqual(parseUploadImageSaveOptions({
    enabled: 'yes',
    format: 'bmp',
    quality: 'bad',
    resizeEnabled: 'no',
    maxWidth: '',
    maxHeight: Number.NaN,
  }), {
    enabled: false,
    format: undefined,
    quality: 85,
    resizeEnabled: false,
    maxWidth: 1536,
    maxHeight: 1536,
  })
}

function verifyOutputFormatResolution() {
  assert.equal(resolveOutputFormat('jpg', createImageFile()), 'jpeg')
  assert.equal(resolveOutputFormat('JPEG', createImageFile()), 'jpeg')
  assert.equal(resolveOutputFormat('webp', createImageFile()), 'webp')
  assert.equal(resolveOutputFormat(undefined, createImageFile({ originalname: 'photo.JPG', mimetype: 'image/jpeg' })), 'jpeg')
  assert.equal(resolveOutputFormat('unsupported', createImageFile({ originalname: 'archive.bin', mimetype: 'application/octet-stream' })), 'webp')
}

function verifyMetadataPatchParsing() {
  assert.equal(parseMetadataPatch(undefined), undefined)
  assert.equal(parseMetadataPatch(null), undefined)
  assert.equal(parseMetadataPatch(''), undefined)
  assert.deepEqual(parseMetadataPatch('{"prompt":"hello","steps":28}'), { prompt: 'hello', steps: 28 })
  assert.deepEqual(parseMetadataPatch({ negative_prompt: 'bad anatomy' }), { negative_prompt: 'bad anatomy' })

  assert.throws(() => parseMetadataPatch('not-json'), /metadataPatch must be a JSON object/)
  assert.throws(() => parseMetadataPatch('["not", "an", "object"]'), /metadataPatch must be a JSON object/)
  assert.throws(() => parseMetadataPatch(42), /metadataPatch must be a JSON object/)
}

function verifyExtractedPreviewShape() {
  const preview = buildExtractedImagePreview(
    createImageFile({ originalname: 'nai-output.webp', filename: 'temp-name.webp', mimetype: 'image/webp', size: 4096 }),
    {
      ai_info: {
        ai_tool: 'NovelAI',
        model: 'nai-diffusion-4',
        lora_models: ['detailer'],
        steps: 28,
        scale: 5.5,
        sampler: 'k_euler',
        scheduler: 'native',
        seed: 123456,
        positive_prompt: 'blue sky',
        negative_prompt: 'low quality',
        character_prompt_text: 'heroine',
        raw_nai_parameters: '{"strength":0.7}',
        width: 832,
        height: 1216,
      },
    } as any,
    { width: 0, height: 0, format: 'webp' } as never,
  )

  assert.deepEqual(preview, {
    id: 'extract:temp-name.webp',
    width: 832,
    height: 1216,
    file_size: 4096,
    mime_type: 'image/webp',
    ai_metadata: {
      ai_tool: 'NovelAI',
      model_name: 'nai-diffusion-4',
      lora_models: ['detailer'],
      generation_params: {
        steps: 28,
        cfg_scale: 5.5,
        sampler: 'k_euler',
        seed: 123456,
        scheduler: 'native',
      },
      prompts: {
        prompt: 'blue sky',
        negative_prompt: 'low quality',
        character_prompt_text: 'heroine',
      },
      raw_nai_parameters: { strength: 0.7 },
    },
  })

  const fallbackPreview = buildExtractedImagePreview(
    createImageFile({ originalname: 'fallback.png', filename: '', mimetype: 'image/png', size: 10 }),
    { ai_info: { raw_nai_parameters: 'not-json' } } as any,
    { width: 640, height: 480, format: 'png' } as never,
  )

  assert.equal(fallbackPreview.id, 'extract:fallback.png')
  assert.equal(fallbackPreview.width, 640)
  assert.equal(fallbackPreview.height, 480)
  assert.equal(fallbackPreview.ai_metadata.raw_nai_parameters, null)
}

function verifyDownloadHeaders() {
  const response = new CapturedResponse()
  setDownloadResponseHeaders(response as unknown as Response, 'bad:name?.jpeg', 'jpeg')

  assert.equal(response.headers.get('content-type'), 'image/jpeg')
  assert.equal(
    response.headers.get('content-disposition'),
    'attachment; filename="bad_name_.jpg"; filename*=UTF-8\'\'bad_name_.jpg',
  )

  const webpResponse = new CapturedResponse()
  setDownloadResponseHeaders(webpResponse as unknown as Response, 'converted image.png', 'webp')
  assert.equal(webpResponse.headers.get('content-type'), 'image/webp')
  assert.equal(
    webpResponse.headers.get('content-disposition'),
    'attachment; filename="converted image.webp"; filename*=UTF-8\'\'converted%20image.webp',
  )
}

verifyMultipartNumberParsing()
verifyUploadSaveOptionParsing()
verifyOutputFormatResolution()
verifyMetadataPatchParsing()
verifyExtractedPreviewShape()
verifyDownloadHeaders()

console.log('✅ Upload metadata utility contracts verified')
