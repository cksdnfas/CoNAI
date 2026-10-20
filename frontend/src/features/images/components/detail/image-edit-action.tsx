import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { Suspense, lazy, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Paintbrush } from 'lucide-react'
import { ImageSaveOptionsModal } from '@/components/media/image-save-options-modal'
import { IconButton } from '@/components/ui/icon-button'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { addImagesToGroup, GROUPS_HIERARCHY_ALL_QUERY_KEY } from '@/lib/api-groups'
import { getExistingImageEditorSourceUrl, uploadMultipleImages } from '@/lib/api-images'
import { getImageViewerSettings } from '@/lib/api-settings'
import { DEFAULT_IMAGE_SAVE_SETTINGS, loadImageSaveSourceInfo, type ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageEditorResult } from '@/features/image-editor/image-editor'
import type { ImageRecord } from '@/types/image'
import type { GroupWithHierarchy } from '@/types/group'
import type { ImageSaveSettings } from '@conai/shared'

const ImageEditor = lazy(() => import('@/features/image-editor/image-editor'))

interface ImageEditActionProps {
  image?: ImageRecord
  /** `ghost` in page toolbars, `overlay` on the viewer's photo stage. */
  variant?: 'ghost' | 'secondary' | 'overlay'
}

function sourceFileNameOf(image?: ImageRecord) {
  return image?.original_file_path?.replace(/\\/g, '/').split('/').at(-1) || image?.composite_hash || 'image'
}

/** `photo.png` → `photo-edit.png` (the server swaps the extension if it converts the format). */
function editedFileName(image?: ImageRecord) {
  const base = sourceFileNameOf(image).replace(/\.[^.]+$/, '')
  return `${base}-edit.png`
}

/** Edit an image and save the result into the library as a new image, in the same groups as the original. */
export function ImageEditAction({ image, variant = 'secondary' }: ImageEditActionProps) {
  const { canCreateImageCopies } = useImagePermissions()
  const queryClient = useQueryClient()
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [imageSaveOptions, setImageSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)
  const [pendingResult, setPendingResult] = useState<Blob | null>(null)
  const [pendingInfo, setPendingInfo] = useState<ImageSaveSourceInfo | null>(null)
  const sourceImageUrl = getExistingImageEditorSourceUrl(image)
  const canEditImage = canCreateImageCopies && Boolean(sourceImageUrl && image?.file_type === 'image')

  const appSettingsQuery = useQuery({
    queryKey: ['image-viewer-settings'],
    queryFn: getImageViewerSettings,
    enabled: canEditImage && (isEditorOpen || pendingResult !== null),
  })
  const effectiveSettings = appSettingsQuery.data?.imageSave ?? DEFAULT_IMAGE_SAVE_SETTINGS

  const saveMutation = useMutation({
    mutationFn: async ({ blob, options }: { blob: Blob; options: ImageSaveSettings }) => {
      const file = new File([blob], editedFileName(image), { type: 'image/png' })
      const outcome = await uploadMultipleImages([file], {}, {
        enabled: options.applyToCanvasSave,
        format: options.defaultFormat,
        quality: options.quality,
        resizeEnabled: options.resizeEnabled,
        maxWidth: options.maxWidth,
        maxHeight: options.maxHeight,
      })
      const uploaded = outcome.uploaded[0]
      if (!uploaded?.composite_hash) {
        throw new Error(outcome.failed[0]?.error || t('images.components.detail.image.edit.action.failed.to.save.the.edited.image'))
      }
      // Same place as the original: every manual group it is in (auto groups collect by their own rules).
      const groups = (image?.groups ?? []).filter((group) => group.collection_type !== 'auto')
      await Promise.all(groups.map((group) => addImagesToGroup(group.id, [uploaded.composite_hash as string])))
      return { fileName: uploaded.original_name || uploaded.filename, groupCount: groups.length, groupIds: groups.map((group) => group.id) }
    },
    onSuccess: async ({ fileName, groupCount, groupIds }) => {
      setIsEditorOpen(false)
      setPendingResult(null)
      setPendingInfo(null)
      showSnackbar({
        message: groupCount > 0
          ? t({ ko: '편집본을 라이브러리에 저장했어: {fileName} · 그룹 {count}개', en: 'Saved the edit to the library: {fileName} · {count} groups' }, { fileName, count: groupCount })
          : t({ ko: '편집본을 라이브러리에 저장했어: {fileName}', en: 'Saved the edit to the library: {fileName}' }, { fileName }),
        tone: 'info',
      })
      const hierarchy = queryClient.getQueryData<GroupWithHierarchy[]>(GROUPS_HIERARCHY_ALL_QUERY_KEY) ?? []
      const parents = new Map(hierarchy.map((group) => [group.id, group.parent_id]))
      const affectedGroups = new Set(groupIds)
      // Group lists include descendants, so an assigned copy also affects its ancestors.
      for (const id of groupIds) {
        let parent = parents.get(id)
        while (parent && !affectedGroups.has(parent)) {
          affectedGroups.add(parent)
          parent = parents.get(parent)
        }
      }
      await Promise.all([
        // Saving creates a new image, not an update to the original. Restart affected lists
        // at their initial page rather than refetching every previously loaded cursor.
        queryClient.resetQueries({ queryKey: ['home-images'] }),
        queryClient.invalidateQueries({ queryKey: ['home-images-total'] }),
        queryClient.invalidateQueries({ queryKey: GROUPS_HIERARCHY_ALL_QUERY_KEY }),
        ...[...affectedGroups].flatMap((id) => [
          queryClient.resetQueries({ queryKey: ['group-images', 'custom', id] }),
          queryClient.invalidateQueries({ queryKey: ['group-detail', 'custom', id] }),
          queryClient.invalidateQueries({ queryKey: ['group-file-counts', 'custom', id] }),
          queryClient.invalidateQueries({ queryKey: ['group-cover-images', 'custom', id] }),
        ]),
      ])
    },
  })

  /** Editor save: upload now, or first ask for format options when the settings say so. */
  const handleEditorSave = async (result: ImageEditorResult) => {
    if (effectiveSettings.applyToCanvasSave && effectiveSettings.alwaysShowDialog) {
      setImageSaveOptions(effectiveSettings)
      setPendingInfo(await loadImageSaveSourceInfo({ source: result.source, sourceMimeType: 'image/png' }))
      setPendingResult(result.source)
      setIsEditorOpen(false)
      return
    }
    // Errors propagate so the editor stays open with the edit intact.
    await saveMutation.mutateAsync({ blob: result.source, options: effectiveSettings })
  }

  const handleConfirmSave = async () => {
    if (!pendingResult) return
    try {
      await saveMutation.mutateAsync({ blob: pendingResult, options: { ...imageSaveOptions, applyToCanvasSave: true } })
    } catch (error) {
      showSnackbar({ message: error instanceof Error ? error.message : t('images.components.detail.image.edit.action.failed.to.save.the.edited.image'), tone: 'error' })
    }
  }

  if (!canEditImage) {
    return null
  }

  return (
    <>
      <IconButton size="icon-sm" variant={variant} onClick={() => setIsEditorOpen(true)} disabled={saveMutation.isPending} label={t('images.components.detail.image.edit.action.images.edit')}>
        <Paintbrush className="h-4 w-4" />
      </IconButton>

      {isEditorOpen ? (
        <Suspense fallback={null}>
          <ImageEditor
            open={isEditorOpen}
            sourceUrl={sourceImageUrl}
            sourceFileName={sourceFileNameOf(image)}
            enableAiErase
            onClose={() => {
              if (!saveMutation.isPending) setIsEditorOpen(false)
            }}
            onSave={handleEditorSave}
          />
        </Suspense>
      ) : null}

      <ImageSaveOptionsModal
        open={pendingResult !== null}
        title={t('images.components.detail.image.edit.action.images.save')}
        options={imageSaveOptions}
        sourceInfo={pendingInfo}
        isSaving={saveMutation.isPending}
        onClose={() => {
          if (!saveMutation.isPending) {
            setPendingResult(null)
            setPendingInfo(null)
          }
        }}
        onOptionsChange={(patch) => setImageSaveOptions((current) => ({ ...current, ...patch }))}
        onConfirm={() => void handleConfirmSave()}
      />
    </>
  )
}
