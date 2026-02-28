import { useCallback, useMemo, useState } from 'react'
import { CheckCircle2, FolderOpen, Hourglass, Image as ImageIcon, Sparkles, TriangleAlert, UploadCloud, Video } from 'lucide-react'
import { useDropzone } from 'react-dropzone'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { uploadApi } from '@/services/upload-api'
import type { UploadProgressEvent, UploadStage } from '@/types/image'

interface UploadZoneProps {
  onUploadComplete?: () => void
}

interface FileProgress {
  filename: string
  status: 'waiting' | 'processing' | 'complete' | 'error'
  currentStage?: UploadStage
  message?: string
  imageId?: string
  error?: string
}

export default function UploadZone({ onUploadComplete }: UploadZoneProps) {
  const { t } = useTranslation('upload')
  const [fileProgressList, setFileProgressList] = useState<FileProgress[]>([])
  const [uploading, setUploading] = useState(false)
  const [currentFileIndex, setCurrentFileIndex] = useState<number>(0)
  const [message, setMessage] = useState<{ type: 'success' | 'error' | 'info'; text: string } | null>(null)

  const stageLabels = useMemo<Record<UploadStage, string>>(
    () => ({
      upload: t('stages.upload'),
      metadata: t('stages.metadata'),
      thumbnail: t('stages.thumbnail'),
      'auto-collect': t('stages.autoCollect'),
      'auto-tag': t('stages.autoTag'),
    }),
    [t],
  )

  const onDrop = useCallback(
    async (acceptedFiles: File[]) => {
      if (acceptedFiles.length === 0) return

      setUploading(true)
      setMessage(null)

      const initialProgress: FileProgress[] = acceptedFiles.map((file) => ({
        filename: file.name,
        status: 'waiting',
      }))
      setFileProgressList(initialProgress)
      setCurrentFileIndex(0)

      try {
        if (acceptedFiles.length === 1) {
          const response = await uploadApi.uploadImage(acceptedFiles[0])
          if (response.success) {
            setFileProgressList([
              {
                filename: acceptedFiles[0].name,
                status: 'complete',
                message: t('messages.uploadComplete'),
                imageId: response.data?.composite_hash,
              },
            ])
            setMessage({ type: 'success', text: t('messages.uploadSuccess') })
          } else {
            setFileProgressList([
              {
                filename: acceptedFiles[0].name,
                status: 'error',
                error: response.error,
              },
            ])
            setMessage({ type: 'error', text: response.error || t('messages.uploadFailed') })
          }
        } else {
          let completed = 0
          let failed = 0

          await uploadApi.uploadImagesWithProgress(acceptedFiles, (event: UploadProgressEvent) => {
            const fileIndex = event.currentFile - 1
            setCurrentFileIndex(fileIndex)

            setFileProgressList((prev) => {
              const newList = [...prev]
              const item = newList[fileIndex]
              if (!item) return newList

              if (event.type === 'start') {
                item.status = 'processing'
                item.message = event.message
              } else if (event.type === 'stage') {
                item.status = 'processing'
                item.currentStage = event.stage
                item.message = event.message || (event.stage ? stageLabels[event.stage] : '')
              } else if (event.type === 'complete') {
                item.status = 'complete'
                item.message = event.message
                item.imageId = event.compositeHash
                completed++
              } else if (event.type === 'error') {
                item.status = 'error'
                item.error = event.error
                failed++
              }

              return newList
            })
          })

          if (failed === 0) {
            setMessage({ type: 'success', text: t('messages.multipleSuccess', { count: completed }) })
          } else if (completed === 0) {
            setMessage({ type: 'error', text: t('messages.allFailed') })
          } else {
            setMessage({
              type: 'info',
              text: t('messages.partialSuccess', { success: completed, failed }),
            })
          }
        }

        onUploadComplete?.()
      } catch (error) {
        setMessage({ type: 'error', text: t('messages.uploadError') })
        console.error('Upload error:', error)
      } finally {
        setUploading(false)
      }
    },
    [onUploadComplete, stageLabels, t],
  )

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.tiff'],
      'video/*': ['.mp4', '.webm', '.mov', '.avi', '.mkv'],
    },
    multiple: true,
  })

  const handleFileSelect = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = 'image/*,video/*'
    input.onchange = (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || [])
      if (files.length > 0) {
        void onDrop(files)
      }
    }
    input.click()
  }

  const handleFolderSelect = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.webkitdirectory = true
    input.multiple = true
    input.onchange = (event) => {
      const files = Array.from((event.target as HTMLInputElement).files || []).filter(
        (file) => file.type.startsWith('image/') || file.type.startsWith('video/'),
      )

      if (files.length > 0) {
        void onDrop(files)
      }
    }
    input.click()
  }

  const progressPercentage =
    fileProgressList.length > 0
      ? (fileProgressList.filter((file) => file.status === 'complete' || file.status === 'error').length / fileProgressList.length) *
        100
      : 0

  const getStatusIcon = (status: FileProgress['status']) => {
    switch (status) {
      case 'complete':
        return <CheckCircle2 className="h-4 w-4 text-emerald-500" />
      case 'error':
        return <TriangleAlert className="h-4 w-4 text-destructive" />
      case 'processing':
        return <Sparkles className="h-4 w-4 text-primary" />
      default:
        return <Hourglass className="h-4 w-4 text-muted-foreground" />
    }
  }

  const completedCount = fileProgressList.filter((file) => file.status === 'complete' || file.status === 'error').length
  const successCount = fileProgressList.filter((file) => file.status === 'complete').length
  const failedCount = fileProgressList.filter((file) => file.status === 'error').length

  return (
    <div className="w-full space-y-4">
      <div
        {...getRootProps()}
        className={cn(
          'cursor-pointer rounded-xl border-2 border-dashed bg-card p-8 text-center transition-colors',
          isDragActive ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/60 hover:bg-accent/40',
        )}
      >
        <input {...getInputProps()} />
        <UploadCloud className="mx-auto mb-3 h-12 w-12 text-primary" />
        <p className="text-base font-medium">{isDragActive ? t('dropzone.dragActive') : t('dropzone.dragInactive')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('dropzone.supportedFormats')}</p>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <Badge variant="outline" className="gap-1">
            <ImageIcon className="h-3 w-3" />
            {t('dropzone.imageSupport')}
          </Badge>
          <Badge variant="outline" className="gap-1">
            <Video className="h-3 w-3" />
            {t('dropzone.videoSupport')}
          </Badge>
          <Badge variant="outline">{t('dropzone.multipleSelection')}</Badge>
        </div>
      </div>

      <div className="relative py-1 text-center text-xs text-muted-foreground">
        <div className="absolute inset-x-0 top-1/2 -z-10 h-px bg-border" />
        <span className="bg-background px-2">{t('dropzone.divider')}</span>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <Button variant="outline" className="w-full" onClick={handleFileSelect} disabled={uploading}>
          <ImageIcon className="h-4 w-4" />
          {t('buttons.selectFiles')}
        </Button>
        <Button variant="outline" className="w-full" onClick={handleFolderSelect} disabled={uploading}>
          <FolderOpen className="h-4 w-4" />
          {t('buttons.selectFolder')}
        </Button>
      </div>

      {uploading && fileProgressList.length > 0 ? (
        <div className="space-y-2 rounded-lg border bg-card p-3">
          <p className="text-sm text-muted-foreground">
            {t('progress.title')}: {t('progress.fileCount', { completed: completedCount, total: fileProgressList.length })}
          </p>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary transition-[width]" style={{ width: `${progressPercentage}%` }} />
          </div>

          <ScrollArea className="h-72 rounded-md border">
            <div className="space-y-1 p-2">
              {fileProgressList.map((file, index) => (
                <div
                  key={`${file.filename}-${index}`}
                  className={cn(
                    'rounded-md border p-2',
                    index === currentFileIndex && file.status === 'processing' ? 'border-primary/50 bg-primary/5' : 'border-transparent',
                  )}
                >
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5">{getStatusIcon(file.status)}</span>
                    <div className="min-w-0 space-y-1">
                      <p className="truncate text-sm font-medium">{file.filename}</p>
                      <div className="flex flex-wrap gap-1 text-xs text-muted-foreground">
                        {file.status === 'processing' && file.currentStage ? <Badge variant="outline">{stageLabels[file.currentStage]}</Badge> : null}
                        {file.message ? <span>{file.message}</span> : null}
                        {file.error ? <span className="text-destructive">{file.error}</span> : null}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
      ) : null}

      {message ? (
        <Alert variant={message.type === 'error' ? 'destructive' : 'default'} className="mt-2">
          <AlertDescription>{message.text}</AlertDescription>
        </Alert>
      ) : null}

      {fileProgressList.length > 0 && !uploading ? (
        <p className="text-sm text-muted-foreground">
          {t('progress.summary', {
            total: fileProgressList.length,
            success: successCount,
            failed: failedCount,
          })}
        </p>
      ) : null}
    </div>
  )
}
