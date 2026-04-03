import { buildApiUrl, fetchJson, triggerBlobDownload, triggerBrowserDownload } from '@/lib/api-client'
import type { ApiResponse, ImageListPayload, ImageRecord } from '@/types/image'
import type { ImageSaveFormat, SimilaritySortBy, SimilaritySortOrder } from '@/types/settings'
import type { PromptSimilarityQueryResult, SimilarityQueryResult } from '@/types/similarity'
import type { AutoTestKaloscopeResult, AutoTestTaggerResult } from './api-settings'

interface ComplexImageSearchRequest {
  complex_filter: {
    exclude_group?: Array<Record<string, unknown>>
    or_group?: Array<Record<string, unknown>>
    and_group?: Array<Record<string, unknown>>
  }
  page?: number
  limit?: number
  sortBy?: 'upload_date' | 'filename' | 'file_size' | 'width' | 'height'
  sortOrder?: 'ASC' | 'DESC'
}

export async function getImages(params?: { page?: number; limit?: number }) {
  const searchParams = new URLSearchParams()
  searchParams.set('page', String(params?.page ?? 1))
  searchParams.set('limit', String(params?.limit ?? 12))
  searchParams.set('sortBy', 'first_seen_date')
  searchParams.set('sortOrder', 'DESC')

  const response = await fetchJson<ApiResponse<ImageListPayload>>(`/api/images?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '이미지 목록을 불러오지 못했어.')
  }
  return response.data
}

export async function searchImagesComplex(input: ComplexImageSearchRequest) {
  const response = await fetchJson<ApiResponse<Omit<ImageListPayload, 'hasMore'>>>(`/api/images/search/complex`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  })

  if (!response.success) {
    throw new Error(response.error || '검색 결과를 불러오지 못했어.')
  }

  return {
    ...response.data,
    hasMore: response.data.page < response.data.totalPages,
  }
}

export async function getImage(compositeHash: string) {
  const response = await fetchJson<ApiResponse<ImageRecord>>(`/api/images/${compositeHash}`)
  if (!response.success) {
    throw new Error(response.error || '이미지를 불러오지 못했어.')
  }
  return response.data
}

/** Load a specific ordered set of images by composite hash for viewer navigation UI. */
export async function getImagesBatch(compositeHashes: string[]) {
  const response = await fetchJson<ApiResponse<Omit<ImageListPayload, 'hasMore'>>>(`/api/images/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      composite_hashes: compositeHashes,
    }),
  })

  if (!response.success) {
    throw new Error(response.error || '이미지 스트립을 불러오지 못했어.')
  }

  return response.data.images
}

export async function getImageDuplicates(compositeHash: string, threshold = 5) {
  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(`/api/images/${compositeHash}/duplicates?threshold=${threshold}`)
  if (!response.success) {
    throw new Error(response.error || '중복 이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getSimilarImages(
  compositeHash: string,
  params?: {
    threshold?: number
    limit?: number
    includeColorSimilarity?: boolean
    sortBy?: SimilaritySortBy
    sortOrder?: SimilaritySortOrder
  },
) {
  const searchParams = new URLSearchParams()
  searchParams.set('threshold', String(params?.threshold ?? 15))
  searchParams.set('limit', String(params?.limit ?? 24))
  searchParams.set('includeColorSimilarity', String(params?.includeColorSimilarity ?? false))
  searchParams.set('sortBy', params?.sortBy ?? 'similarity')
  searchParams.set('sortOrder', params?.sortOrder ?? 'DESC')

  const response = await fetchJson<ApiResponse<SimilarityQueryResult>>(`/api/images/${compositeHash}/similar?${searchParams.toString()}`)
  if (!response.success) {
    throw new Error(response.error || '유사 이미지를 불러오지 못했어.')
  }
  return response.data
}

export async function getPromptSimilarImages(compositeHash: string) {
  const response = await fetchJson<ApiResponse<PromptSimilarityQueryResult>>(`/api/images/prompt-similarity/by-image/${compositeHash}`)
  if (!response.success) {
    throw new Error(response.error || '텍스트 기반 유사 이미지를 불러오지 못했어.')
  }
  return response.data
}

export interface SaveEditedImageResult {
  success: boolean
  filePath: string
  tempId: string
  width: number
  height: number
  fileSize: number
  fileName: string
  savedUrl: string
}

/** Save one edited image into the managed save/canvas workspace as a reusable asset. */
export async function saveEditedImageToCanvas(
  imageId: number,
  imageData: string,
  options?: {
    quality?: number
    format?: Exclude<ImageSaveFormat, 'original'>
  },
): Promise<SaveEditedImageResult> {
  const response = await fetchJson<ApiResponse<Omit<SaveEditedImageResult, 'fileName' | 'savedUrl'>>>(`/api/image-editor/${imageId}/save-output`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      imageData,
      quality: options?.quality ?? 90,
      format: options?.format ?? 'webp',
    }),
  })

  if (!response.success) {
    throw new Error(response.error || '편집 이미지를 저장하지 못했어.')
  }

  const normalizedPath = response.data.filePath.replace(/\\/g, '/')
  const fileName = normalizedPath.split('/').at(-1) || `${response.data.tempId}.webp`

  return {
    ...response.data,
    fileName,
    savedUrl: buildApiUrl(`/save/canvas/${encodeURIComponent(fileName)}`),
  }
}

/** Build the best available source URL for opening one existing image in the editor. */
export function getExistingImageEditorSourceUrl(image?: ImageRecord | null) {
  if (!image) {
    return null
  }

  if (image.composite_hash) {
    return `/api/images/${image.composite_hash}/file`
  }

  return image.image_url || image.thumbnail_url || null
}

export async function downloadImageSelection(compositeHashes: string[]) {
  if (compositeHashes.length === 0) {
    return
  }

  if (compositeHashes.length === 1) {
    triggerBrowserDownload(buildApiUrl(`/api/images/${compositeHashes[0]}/download/original`))
    return
  }

  const response = await fetch(buildApiUrl('/api/images/download/batch'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/zip',
    },
    body: JSON.stringify({ compositeHashes }),
  })

  if (!response.ok) {
    throw new Error(`Batch download failed: ${response.status}`)
  }

  const blob = await response.blob()
  triggerBlobDownload(blob, `conai-images-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, '-')}.zip`)
}

export interface UploadBatchResultItem {
  id: number | string
  filename: string
  original_name: string
  thumbnail_url: string
  file_size: number
  mime_type: string
  width: number | null
  height: number | null
  upload_date: string
}

export interface UploadBatchFailure {
  filename: string
  error: string
}

export interface UploadBatchResult {
  uploaded: UploadBatchResultItem[]
  failed: UploadBatchFailure[]
  total: number
  successful: number
  failed_count: number
}

export interface UploadTransferProgress {
  loaded: number
  total: number | null
  percent: number | null
}

async function readApiPayload<T>(response: Response) {
  const payload = (await response.json()) as ApiResponse<T>

  if (!response.ok || !payload.success) {
    throw new Error(payload.error || `Request failed: ${response.status}`)
  }

  return payload.data
}

function uploadFormDataWithProgress<T>(path: string, formData: FormData, onProgress?: (progress: UploadTransferProgress) => void) {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', buildApiUrl(path))
    xhr.setRequestHeader('Accept', 'application/json')

    xhr.upload.onprogress = (event) => {
      if (!onProgress) {
        return
      }

      onProgress({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : null,
        percent: event.lengthComputable && event.total > 0 ? Math.min(100, Math.round((event.loaded / event.total) * 100)) : null,
      })
    }

    xhr.onerror = () => {
      reject(new Error('Network request failed'))
    }

    xhr.onload = () => {
      try {
        const payload = JSON.parse(xhr.responseText || '{}') as ApiResponse<T>

        if (xhr.status < 200 || xhr.status >= 300 || !payload.success) {
          reject(new Error(payload.error || `Request failed: ${xhr.status}`))
          return
        }

        resolve(payload.data)
      } catch {
        reject(new Error('Invalid server response'))
      }
    }

    xhr.send(formData)
  })
}

export async function uploadMultipleImages(
  files: File[],
  onProgress?: (progress: UploadTransferProgress) => void,
  imageSaveOptions?: {
    enabled?: boolean
    format?: 'original' | 'png' | 'jpeg' | 'webp'
    quality?: number
    resizeEnabled?: boolean
    maxWidth?: number
    maxHeight?: number
  },
) {
  const formData = new FormData()
  files.forEach((file) => formData.append('images', file))

  if (imageSaveOptions) {
    formData.append('enabled', String(Boolean(imageSaveOptions.enabled)))
    if (imageSaveOptions.format) {
      formData.append('format', imageSaveOptions.format)
    }
    if (typeof imageSaveOptions.quality === 'number') {
      formData.append('quality', String(imageSaveOptions.quality))
    }
    formData.append('resizeEnabled', String(Boolean(imageSaveOptions.resizeEnabled)))
    if (typeof imageSaveOptions.maxWidth === 'number') {
      formData.append('maxWidth', String(imageSaveOptions.maxWidth))
    }
    if (typeof imageSaveOptions.maxHeight === 'number') {
      formData.append('maxHeight', String(imageSaveOptions.maxHeight))
    }
  }

  return uploadFormDataWithProgress<UploadBatchResult>('/api/images/upload-multiple', formData, onProgress)
}

export async function extractImageMetadataPreview(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch(buildApiUrl('/api/images/extract-metadata'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  })

  return readApiPayload<ImageRecord>(response)
}

export async function extractImageTaggerPreview(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch(buildApiUrl('/api/images/extract-tagger'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  })

  return readApiPayload<AutoTestTaggerResult>(response)
}

export async function extractImageKaloscopePreview(file: File) {
  const formData = new FormData()
  formData.append('image', file)

  const response = await fetch(buildApiUrl('/api/images/extract-kaloscope'), {
    method: 'POST',
    headers: {
      Accept: 'application/json',
    },
    body: formData,
  })

  return readApiPayload<AutoTestKaloscopeResult>(response)
}

export interface ConvertWebPDownloadResult {
  fileName: string
  metadataState: 'preserved' | 'empty' | 'unknown'
}

export interface RewriteMetadataDownloadResult {
  fileName: string
  rewriteState: 'patched' | 'preserved' | 'unknown'
  xmpState: 'applied' | 'empty' | 'unknown'
  exifState: 'applied' | 'empty' | 'unknown'
}

export type MetadataPatchPayload = Record<string, string | number | null>

/** Extract a suggested filename from Content-Disposition when available. */
function getDownloadFileName(contentDisposition: string | null, fallbackFileName: string) {
  if (!contentDisposition) {
    return fallbackFileName
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i)
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1])
  }

  const basicMatch = contentDisposition.match(/filename="?([^";]+)"?/i)
  if (basicMatch?.[1]) {
    return basicMatch[1]
  }

  return fallbackFileName
}

/** Convert a single image file to WebP and trigger an immediate download. */
export async function downloadConvertedWebP(file: File, options?: { quality?: number }) {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('quality', String(options?.quality ?? 90))

  const response = await fetch(buildApiUrl('/api/images/convert-webp'), {
    method: 'POST',
    headers: {
      Accept: 'image/webp',
    },
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed: ${response.status}`)
  }

  const blob = await response.blob()
  const fallbackFileName = `${file.name.replace(/\.[^.]+$/, '') || 'converted-image'}.webp`
  const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName)
  const metadataState = (response.headers.get('X-CoNAI-WebP-Metadata') as ConvertWebPDownloadResult['metadataState'] | null) ?? 'unknown'

  triggerBlobDownload(blob, fileName)

  return {
    fileName,
    metadataState,
  } satisfies ConvertWebPDownloadResult
}

/** Rewrite image metadata and download the rewritten file immediately. */
export async function downloadRewrittenImage(
  file: File,
  options: {
    format: 'png' | 'jpeg' | 'webp'
    quality?: number
    metadataPatch?: MetadataPatchPayload
  },
) {
  const formData = new FormData()
  formData.append('image', file)
  formData.append('format', options.format)
  formData.append('quality', String(options.quality ?? 90))

  if (options.metadataPatch && Object.keys(options.metadataPatch).length > 0) {
    formData.append('metadataPatch', JSON.stringify(options.metadataPatch))
  }

  const response = await fetch(buildApiUrl('/api/images/rewrite-metadata'), {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed: ${response.status}`)
  }

  const blob = await response.blob()
  const extension = options.format === 'jpeg' ? 'jpg' : options.format
  const fallbackFileName = `${file.name.replace(/\.[^.]+$/, '') || 'rewritten-image'}.${extension}`
  const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName)
  const rewriteState = (response.headers.get('X-CoNAI-Metadata-Rewrite') as RewriteMetadataDownloadResult['rewriteState'] | null) ?? 'unknown'
  const xmpState = (response.headers.get('X-CoNAI-Metadata-XMP') as RewriteMetadataDownloadResult['xmpState'] | null) ?? 'unknown'
  const exifState = (response.headers.get('X-CoNAI-Metadata-EXIF') as RewriteMetadataDownloadResult['exifState'] | null) ?? 'unknown'

  triggerBlobDownload(blob, fileName)

  return {
    fileName,
    rewriteState,
    xmpState,
    exifState,
  } satisfies RewriteMetadataDownloadResult
}

/** Rewrite metadata for one existing library image and download the rewritten file immediately. */
export async function downloadExistingImageWithRewrittenMetadata(
  compositeHash: string,
  options: {
    format: 'png' | 'jpeg' | 'webp'
    quality?: number
    metadataPatch?: MetadataPatchPayload
  },
) {
  const response = await fetch(buildApiUrl(`/api/images/${compositeHash}/rewrite-metadata/download`), {
    method: 'POST',
    headers: {
      Accept: 'application/octet-stream',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      format: options.format,
      quality: options.quality ?? 90,
      metadataPatch: options.metadataPatch,
    }),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text || `Request failed: ${response.status}`)
  }

  const blob = await response.blob()
  const fallbackFileName = `${compositeHash}.${options.format === 'jpeg' ? 'jpg' : options.format}`
  const fileName = getDownloadFileName(response.headers.get('Content-Disposition'), fallbackFileName)
  const rewriteState = (response.headers.get('X-CoNAI-Metadata-Rewrite') as RewriteMetadataDownloadResult['rewriteState'] | null) ?? 'unknown'
  const xmpState = (response.headers.get('X-CoNAI-Metadata-XMP') as RewriteMetadataDownloadResult['xmpState'] | null) ?? 'unknown'
  const exifState = (response.headers.get('X-CoNAI-Metadata-EXIF') as RewriteMetadataDownloadResult['exifState'] | null) ?? 'unknown'

  triggerBlobDownload(blob, fileName)

  return {
    fileName,
    rewriteState,
    xmpState,
    exifState,
  } satisfies RewriteMetadataDownloadResult
}

/** Persist one metadata patch onto an existing library image and return the updated image record. */
export async function saveImageMetadata(compositeHash: string, metadataPatch: MetadataPatchPayload) {
  const response = await fetch(buildApiUrl(`/api/images/${compositeHash}/metadata`), {
    method: 'PATCH',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ metadataPatch }),
  })

  return readApiPayload<ImageRecord>(response)
}
