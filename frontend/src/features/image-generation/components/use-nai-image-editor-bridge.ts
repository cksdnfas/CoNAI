import { useState, type Dispatch, type SetStateAction } from 'react'
import { DEFAULT_IMAGE_SAVE_SETTINGS, buildImageSaveOutput, buildImageSaveOutputFileName, loadImageSaveSourceInfo, type ImageSaveSourceInfo } from '@/lib/image-save-output'
import type { ImageSaveSettings } from '@/types/settings'
import { buildSelectedImageDraftFromDataUrl, type NAIFormDraft } from '../image-generation-shared'
import { buildNaiEditedImageFileName } from './nai-generation-panel-helpers'

/** Bridge the NAI form with the shared image editor and save-options modal flow. */
export function useNaiImageEditorBridge({
  naiForm,
  setNaiForm,
  imageSaveSettings,
  showSnackbar,
}: {
  naiForm: NAIFormDraft
  setNaiForm: Dispatch<SetStateAction<NAIFormDraft>>
  imageSaveSettings: ImageSaveSettings
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isImageEditorOpen, setIsImageEditorOpen] = useState(false)
  const [pendingImageEditorSave, setPendingImageEditorSave] = useState<{ sourceImageDataUrl: string; maskImageDataUrl?: string } | null>(null)
  const [pendingImageEditorSaveInfo, setPendingImageEditorSaveInfo] = useState<ImageSaveSourceInfo | null>(null)
  const [editorSaveOptions, setEditorSaveOptions] = useState<ImageSaveSettings>(DEFAULT_IMAGE_SAVE_SETTINGS)

  /** Open the image editor only when a source image already exists. */
  const handleOpenImageEditor = () => {
    if (!naiForm.sourceImage) {
      showSnackbar({ message: '먼저 소스 이미지를 선택해.', tone: 'error' })
      return
    }

    setIsImageEditorOpen(true)
  }

  /** Apply one saved image-editor output back into the current NAI form draft. */
  const applyImageEditorSaveOutput = async (
    payload: { sourceImageDataUrl: string; maskImageDataUrl?: string },
    nextImageSaveSettings: ImageSaveSettings,
  ) => {
    if (!nextImageSaveSettings.applyToEditorSave) {
      setNaiForm((current) => ({
        ...current,
        sourceImage: buildSelectedImageDraftFromDataUrl(payload.sourceImageDataUrl, buildNaiEditedImageFileName(current.sourceImage?.fileName, 'source-image')),
        maskImage: current.action === 'infill'
          ? payload.maskImageDataUrl
            ? buildSelectedImageDraftFromDataUrl(payload.maskImageDataUrl, buildNaiEditedImageFileName(current.maskImage?.fileName, 'mask-image'))
            : undefined
          : current.maskImage,
      }))
      return
    }

    const sourceOutput = await buildImageSaveOutput(
      {
        source: payload.sourceImageDataUrl,
        sourceMimeType: 'image/png',
      },
      nextImageSaveSettings,
    )

    const maskOutput = payload.maskImageDataUrl
      ? await buildImageSaveOutput(
        {
          source: payload.maskImageDataUrl,
          sourceMimeType: 'image/png',
        },
        nextImageSaveSettings,
      )
      : null

    setNaiForm((current) => ({
      ...current,
      sourceImage: buildSelectedImageDraftFromDataUrl(
        sourceOutput.dataUrl,
        buildImageSaveOutputFileName(buildNaiEditedImageFileName(current.sourceImage?.fileName, 'source-image'), sourceOutput.format),
      ),
      maskImage: current.action === 'infill'
        ? maskOutput
          ? buildSelectedImageDraftFromDataUrl(
            maskOutput.dataUrl,
            buildImageSaveOutputFileName(buildNaiEditedImageFileName(current.maskImage?.fileName, 'mask-image'), maskOutput.format),
          )
          : undefined
        : current.maskImage,
    }))
  }

  /** Receive one image-editor save payload and either apply it directly or open the save-options modal. */
  const handleSaveImageEditor = async (payload: { sourceImageDataUrl: string; maskImageDataUrl?: string }) => {
    if (imageSaveSettings.applyToEditorSave && imageSaveSettings.alwaysShowDialog) {
      setEditorSaveOptions(imageSaveSettings)
      setPendingImageEditorSaveInfo(await loadImageSaveSourceInfo({ source: payload.sourceImageDataUrl, sourceMimeType: 'image/png' }))
      setPendingImageEditorSave(payload)
      return
    }

    await applyImageEditorSaveOutput(payload, imageSaveSettings)
  }

  /** Confirm the deferred image-editor save using the current modal options. */
  const handleConfirmImageEditorSave = async () => {
    if (!pendingImageEditorSave) {
      return
    }

    await applyImageEditorSaveOutput(pendingImageEditorSave, editorSaveOptions)
    setPendingImageEditorSave(null)
    setPendingImageEditorSaveInfo(null)
  }

  /** Close the image-save-options modal and clear the deferred editor output. */
  const handleCloseImageEditorSaveOptions = () => {
    setPendingImageEditorSave(null)
    setPendingImageEditorSaveInfo(null)
  }

  return {
    isImageEditorOpen,
    setIsImageEditorOpen,
    pendingImageEditorSave,
    pendingImageEditorSaveInfo,
    editorSaveOptions,
    setEditorSaveOptions,
    handleOpenImageEditor,
    handleSaveImageEditor,
    handleConfirmImageEditorSave,
    handleCloseImageEditorSaveOptions,
  }
}
