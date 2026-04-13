import axios from 'axios'
// @ts-ignore - no types available
import AdmZip from 'adm-zip'
import { preprocessMetadata, type NAIMetadataInputParams, type NAIMetadataParams } from '../utils/nai/metadata'
import { buildNaiRequestBody } from '../utils/nai/requestBuilder'

export interface ExecuteNaiGenerationResult {
  metadata: NAIMetadataParams
  requestBody: Awaited<ReturnType<typeof buildNaiRequestBody>>
  imageBuffers: Buffer[]
}

export interface ExecuteNaiGenerationOptions {
  onUpstreamAccepted?: () => void | Promise<void>
}

/** Execute one NovelAI image-generation request and decode all returned images. */
export async function executeNaiGeneration(
  input: NAIMetadataInputParams,
  token: string,
  options?: ExecuteNaiGenerationOptions,
): Promise<ExecuteNaiGenerationResult> {
  const metadata = preprocessMetadata(input)
  const requestBody = await buildNaiRequestBody(metadata)

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

  await options?.onUpstreamAccepted?.()

  const zip = new AdmZip(Buffer.from(response.data))
  const imageBuffers = zip.getEntries().map((entry: any) => entry.getData())

  return {
    metadata,
    requestBody,
    imageBuffers,
  }
}
