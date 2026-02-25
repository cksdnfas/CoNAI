import { useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Copy, Download, Hourglass } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import PromptDisplay, { type NaiCharacterPrompt } from '@/components/prompt-display'
import { imageApi } from '@/services/image-api'
import { settingsApi } from '@/services/settings-api'
import type { ImageRecord } from '@/types/image'
import { getBackendOrigin } from '@/utils/backend'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

const renderValue = (value: string | number | null | undefined) => (value ?? '-')

interface RawNaiParametersShape {
  v4_prompt?: {
    caption?: {
      char_captions?: unknown
    }
  }
}

export function ImageDetailPage() {
  const { t } = useTranslation(['imageDetail', 'common'])
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const backendOrigin = getBackendOrigin()

  const [image, setImage] = useState<ImageRecord | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [imageError, setImageError] = useState(false)
  const [isTaggerEnabled, setIsTaggerEnabled] = useState(false)
  const [copyNoticeOpen, setCopyNoticeOpen] = useState(false)

  useEffect(() => {
    const loadSettings = async () => {
      try {
        const settings = await settingsApi.getSettings()
        setIsTaggerEnabled(settings.tagger.enabled)
      } catch (loadError) {
        console.error('Failed to load settings:', loadError)
        setIsTaggerEnabled(false)
      }
    }

    void loadSettings()
  }, [])

  useEffect(() => {
    const loadImage = async () => {
      if (!compositeHash) {
        setError(t('imageDetail:page.noIdProvided'))
        setLoading(false)
        return
      }

      try {
        setLoading(true)
        setImageError(false)

        const response = await imageApi.getImage(compositeHash)
        if (response.success && response.data) {
          setImage(response.data)
          setError(null)
        } else {
          setError(response.error || t('imageDetail:page.notFound'))
        }
      } catch (loadError) {
        console.error('Failed to load image detail:', loadError)
        setError(t('imageDetail:page.errorLoading'))
      } finally {
        setLoading(false)
      }
    }

    void loadImage()
  }, [compositeHash, t])

  useEffect(() => {
    if (!copyNoticeOpen) return

    const timeoutId = window.setTimeout(() => {
      setCopyNoticeOpen(false)
    }, 2000)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [copyNoticeOpen])

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
      return
    }

    navigate('/')
  }

  const handleDownload = () => {
    if (!image || !image.composite_hash) return

    const link = document.createElement('a')
    link.href = `${backendOrigin}/api/images/${image.composite_hash}/download/original`
    link.download = image.original_file_path || `image_${image.composite_hash.slice(0, 8)}.png`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  const handleCopyHash = async () => {
    if (!image?.composite_hash) return

    try {
      await navigator.clipboard.writeText(image.composite_hash)
      setCopyNoticeOpen(true)
    } catch (copyError) {
      console.error('Failed to copy hash:', copyError)
    }
  }

  const handleAutoTagGenerated = async () => {
    if (!compositeHash) return

    try {
      const response = await imageApi.getImage(compositeHash)
      if (response.success && response.data) {
        setImage(response.data)
      }
    } catch (reloadError) {
      console.error('Failed to reload image after tagging:', reloadError)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes'
    const k = 1024
    const sizes = ['Bytes', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`
  }

  const formatDate = (dateString: string) => new Date(dateString).toLocaleString('ko-KR')

  const truncateFilename = (filename: string, maxLength = 50) => {
    if (filename.length <= maxLength) return filename

    const ext = filename.split('.').pop()
    if (!ext) return `${filename.slice(0, maxLength - 3)}...`

    const base = filename.slice(0, filename.lastIndexOf('.'))
    const truncatedName = `${base.slice(0, maxLength - ext.length - 4)}...`
    return `${truncatedName}.${ext}`
  }

  const imageUrl = image?.composite_hash ? `${backendOrigin}/api/images/${image.composite_hash}/thumbnail` : ''
  const fallbackUrl = image?.composite_hash ? `${backendOrigin}/api/images/${image.composite_hash}/download/original` : ''
  const mediaSource = imageError ? fallbackUrl : imageUrl

  const characterPrompts = useMemo<NaiCharacterPrompt[] | undefined>(() => {
    const rawNaiParams = image?.ai_metadata?.raw_nai_parameters as RawNaiParametersShape | null | undefined
    const rawCaptions = rawNaiParams?.v4_prompt?.caption?.char_captions
    if (!Array.isArray(rawCaptions)) return undefined

    const normalized = rawCaptions
      .map((entry): NaiCharacterPrompt | null => {
        if (!entry || typeof entry !== 'object') return null
        const candidate = entry as { char_caption?: unknown; centers?: unknown }
        if (typeof candidate.char_caption !== 'string' || candidate.char_caption.trim().length === 0) {
          return null
        }

        const centers = Array.isArray(candidate.centers)
          ? candidate.centers.flatMap((point) => {
              if (!point || typeof point !== 'object') return []
              const typedPoint = point as { x?: unknown; y?: unknown }
              if (typeof typedPoint.x === 'number' && typeof typedPoint.y === 'number') {
                return [{ x: typedPoint.x, y: typedPoint.y }]
              }
              return []
            })
          : []

        return {
          char_caption: candidate.char_caption,
          centers,
        }
      })
      .filter((entry): entry is NaiCharacterPrompt => entry !== null)

    return normalized.length > 0 ? normalized : undefined
  }, [image?.ai_metadata?.raw_nai_parameters])

  if (loading) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-md" />
          <Skeleton className="h-8 w-52" />
        </div>
        <div className="grid gap-4 lg:grid-cols-12">
          <Skeleton className="h-[620px] lg:col-span-7" />
          <Skeleton className="h-[620px] lg:col-span-5" />
        </div>
      </div>
    )
  }

  if (error || !image) {
    return (
      <div className="mx-auto max-w-[1400px] space-y-4">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon-sm" onClick={handleBack} aria-label="Go back">
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">{t('imageDetail:page.title')}</h1>
        </div>
        <Alert variant="destructive">
          <AlertTitle>{t('common:messages.error')}</AlertTitle>
          <AlertDescription>{error || t('imageDetail:page.notFound')}</AlertDescription>
        </Alert>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="icon-sm" onClick={handleBack} aria-label="Go back">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <h1 className="mr-auto text-xl font-semibold sm:text-2xl">{t('imageDetail:page.title')}</h1>
        <Button variant="outline" onClick={handleDownload}>
          <Download className="h-4 w-4" />
          {t('imageDetail:actions.download')}
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="space-y-4 lg:col-span-7">
          <Card>
            <CardContent className="p-3">
              {image.mime_type?.startsWith('video/') ? (
                <video
                  src={mediaSource}
                  controls
                  onError={() => setImageError(true)}
                  className="max-h-[80vh] w-full rounded-md"
                />
              ) : (
                <img
                  src={mediaSource}
                  alt={image.original_file_path ?? ''}
                  onError={() => setImageError(true)}
                  className="max-h-[80vh] w-full rounded-md object-contain"
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('imageDetail:sections.fileInfo')}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground" title={image.original_file_path ?? ''}>
                {t('imageDetail:fileInfo.originalFilename')}: {truncateFilename(image.original_file_path ?? '')}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>
                {image.mime_type?.startsWith('video/') ? t('imageDetail:sections.videoInfo') : t('imageDetail:sections.imageInfo')}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              <p>
                <strong>{t('imageDetail:fileInfo.size')}:</strong> {image.width} x {image.height}
              </p>
              <p>
                <strong>{t('imageDetail:fileInfo.fileSize')}:</strong> {formatFileSize(image.file_size ?? 0)}
              </p>
              <p>
                <strong>{t('imageDetail:fileInfo.mimeType')}:</strong> {image.mime_type}
              </p>
              {image.mime_type?.startsWith('video/') ? (
                <>
                  {image.duration ? (
                    <p>
                      <strong>{t('imageDetail:videoInfo.duration')}:</strong>{' '}
                      {t('imageDetail:videoInfo.durationValue', {
                        minutes: Math.floor(image.duration / 60),
                        seconds: Math.floor(image.duration % 60),
                      })}
                    </p>
                  ) : null}
                  {image.fps ? (
                    <p>
                      <strong>{t('imageDetail:videoInfo.fps')}:</strong> {t('imageDetail:videoInfo.fpsValue', { fps: image.fps.toFixed(2) })}
                    </p>
                  ) : null}
                  {image.video_codec ? (
                    <p>
                      <strong>{t('imageDetail:videoInfo.videoCodec')}:</strong> {image.video_codec}
                    </p>
                  ) : null}
                  {image.audio_codec ? (
                    <p>
                      <strong>{t('imageDetail:videoInfo.audioCodec')}:</strong> {image.audio_codec}
                    </p>
                  ) : null}
                  {image.bitrate ? (
                    <p>
                      <strong>{t('imageDetail:videoInfo.bitrate')}:</strong>{' '}
                      {t('imageDetail:videoInfo.bitrateValue', { bitrate: (image.bitrate / 1000).toFixed(2) })}
                    </p>
                  ) : null}
                </>
              ) : null}
              <p>
                <strong>{t('imageDetail:fileInfo.uploadDate')}:</strong> {formatDate(image.first_seen_date)}
              </p>
            </CardContent>
          </Card>

          {image.groups && image.groups.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('imageDetail:sections.groupInfo')}</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-2">
                {image.groups.map((group) => (
                  <Badge
                    key={group.id}
                    className="text-white"
                    style={{
                      backgroundColor: group.color || (group.collection_type === 'auto' ? '#1d4ed8' : '#7e22ce'),
                    }}
                  >
                    {t('imageDetail:groupInfo.groupLabel', {
                      name: group.name,
                      type: group.collection_type === 'auto' ? t('imageDetail:groupInfo.autoType') : t('imageDetail:groupInfo.manualType'),
                    })}
                  </Badge>
                ))}
              </CardContent>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Image Hash</CardTitle>
            </CardHeader>
            <CardContent>
              {image.composite_hash ? (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2">
                  <button
                    type="button"
                    onClick={() => void handleCopyHash()}
                    className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-xs text-muted-foreground hover:text-foreground"
                    title={image.composite_hash}
                  >
                    {image.composite_hash}
                  </button>
                  <Button size="icon-sm" variant="outline" onClick={() => void handleCopyHash()} aria-label="Copy hash">
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-md border bg-muted/30 p-2 text-muted-foreground">
                  <Hourglass className="h-4 w-4" />
                  <span className="text-sm">Hash generation pending...</span>
                </div>
              )}
            </CardContent>
          </Card>

          {image.ai_metadata ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('imageDetail:sections.aiInfo')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>
                  <strong>{t('imageDetail:aiInfo.tool')}:</strong> {renderValue(image.ai_metadata.ai_tool)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.model')}:</strong> {renderValue(image.ai_metadata.model_name)}
                </p>
                {image.ai_metadata.lora_models ? (
                  <p>
                    <strong>{t('imageDetail:aiInfo.lora')}:</strong> {JSON.stringify(image.ai_metadata.lora_models)}
                  </p>
                ) : null}
                <p>
                  <strong>{t('imageDetail:aiInfo.steps')}:</strong> {renderValue(image.ai_metadata.generation_params.steps)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.cfgScale')}:</strong> {renderValue(image.ai_metadata.generation_params.cfg_scale)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.sampler')}:</strong> {renderValue(image.ai_metadata.generation_params.sampler)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.scheduler')}:</strong> {renderValue(image.ai_metadata.generation_params.scheduler)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.seed')}:</strong> {renderValue(image.ai_metadata.generation_params.seed)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.denoiseStrength')}:</strong>{' '}
                  {renderValue(image.ai_metadata.generation_params.denoise_strength)}
                </p>
                {image.ai_metadata.generation_params.generation_time ? (
                  <p>
                    <strong>{t('imageDetail:aiInfo.generationTime')}:</strong>{' '}
                    {t('imageDetail:aiInfo.generationTimeValue', {
                      time: image.ai_metadata.generation_params.generation_time,
                    })}
                  </p>
                ) : null}
                <p>
                  <strong>{t('imageDetail:aiInfo.batchSize')}:</strong> {renderValue(image.ai_metadata.generation_params.batch_size)}
                </p>
                <p>
                  <strong>{t('imageDetail:aiInfo.batchIndex')}:</strong> {renderValue(image.ai_metadata.generation_params.batch_index)}
                </p>
              </CardContent>
            </Card>
          ) : null}

          {(image.ai_metadata?.prompts.prompt || image.ai_metadata?.prompts.negative_prompt || isTaggerEnabled) ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('imageDetail:sections.promptInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <PromptDisplay
                  prompt={image.ai_metadata?.prompts.prompt}
                  negativePrompt={image.ai_metadata?.prompts.negative_prompt}
                  maxHeight={800}
                  variant="none"
                  imageId={image.composite_hash ?? undefined}
                  autoTags={image.auto_tags}
                  isTaggerEnabled={isTaggerEnabled}
                  onAutoTagGenerated={handleAutoTagGenerated}
                  characterPrompts={characterPrompts}
                  rawNaiParameters={image.ai_metadata?.raw_nai_parameters}
                />
              </CardContent>
            </Card>
          ) : null}
        </div>
      </div>

      <details className="overflow-hidden rounded-lg border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-base font-semibold">{t('imageDetail:sections.fullMetadata')}</summary>
        <div className="border-t p-3">
          <pre className="max-h-[750px] overflow-auto rounded-md bg-muted/30 p-3 text-xs">{JSON.stringify(image, null, 2)}</pre>
        </div>
      </details>

      {copyNoticeOpen ? (
        <div className="fixed right-4 bottom-4 z-50 w-[min(420px,calc(100%-2rem))]">
          <Alert>
            <AlertTitle>{t('common:messages.success')}</AlertTitle>
            <AlertDescription>Hash copied successfully.</AlertDescription>
          </Alert>
        </div>
      ) : null}
    </div>
  )
}
