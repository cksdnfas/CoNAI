import { useMemo, useState, type Dispatch, type SetStateAction } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  deleteNaiCharacterReferenceAsset,
  deleteNaiVibeAsset,
  encodeNaiVibe,
  getNaiVibeAsset,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  saveNaiCharacterReferenceAsset,
  saveNaiVibeAsset,
  updateNaiCharacterReferenceAsset,
  updateNaiVibeAsset,
} from '@/lib/api'
import {
  buildSelectedImageDraftFromUrl,
  getErrorMessage,
  parseNumberInput,
  type NAIFormDraft,
  type SelectedImageDraft,
} from '../image-generation-shared'
import { deriveNaiAssetLabel } from './nai-generation-panel-helpers'

function isUnauthorizedAssetRequestError(error: unknown) {
  if (!(error instanceof Error)) {
    return false
  }

  const message = error.message.toLowerCase()
  return message.includes('unauthorized') || message.includes('invalid or expired token')
}

type AssetSaveTarget =
  | { mode: 'create'; kind: 'vibe'; index: number }
  | { mode: 'create'; kind: 'reference'; index: number }
  | { mode: 'edit'; kind: 'vibe'; assetId: string }
  | { mode: 'edit'; kind: 'reference'; assetId: string }

/** Manage saved NAI vibe/reference libraries and asset save flows for the generation panel. */
export function useNaiAssetLibrary({
  naiForm,
  setNaiForm,
  naiUserEnabled,
  refetchUserData,
  showSnackbar,
}: {
  naiForm: NAIFormDraft
  setNaiForm: Dispatch<SetStateAction<NAIFormDraft>>
  naiUserEnabled: boolean
  refetchUserData: () => Promise<unknown>
  showSnackbar: (input: { message: string; tone: 'info' | 'error' }) => void
}) {
  const [isSavingAsset, setIsSavingAsset] = useState(false)
  const [assetSaveTarget, setAssetSaveTarget] = useState<AssetSaveTarget | null>(null)
  const [assetSaveName, setAssetSaveName] = useState('')
  const [assetSaveDescription, setAssetSaveDescription] = useState('')
  const [encodingVibeIndex, setEncodingVibeIndex] = useState<number | null>(null)
  const [savedVibeSearch, setSavedVibeSearch] = useState('')
  const [savedCharacterReferenceSearch, setSavedCharacterReferenceSearch] = useState('')

  const savedVibesQuery = useQuery({
    queryKey: ['image-generation-nai-vibe-assets', naiForm.model],
    queryFn: () => listNaiVibeAssets(naiForm.model),
  })

  const savedCharacterReferencesQuery = useQuery({
    queryKey: ['image-generation-nai-character-reference-assets'],
    queryFn: listNaiCharacterReferenceAssets,
  })

  const filteredSavedVibes = useMemo(() => {
    const items = savedVibesQuery.data || []
    const keyword = savedVibeSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.description ?? ''} ${item.model}`.toLowerCase().includes(keyword))
  }, [savedVibeSearch, savedVibesQuery.data])

  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = savedCharacterReferenceSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.description ?? ''} ${item.type}`.toLowerCase().includes(keyword))
  }, [savedCharacterReferenceSearch, savedCharacterReferencesQuery.data])

  const assetSaveModalTitle = assetSaveTarget?.mode === 'edit'
    ? assetSaveTarget.kind === 'vibe'
      ? 'Vibe 수정'
      : 'Character Reference 수정'
    : assetSaveTarget?.kind === 'vibe'
      ? 'Vibe 저장'
      : 'Character Reference 저장'

  const assetSaveSubmitLabel = assetSaveTarget?.mode === 'edit' ? '수정' : '저장'

  /** Encode one vibe image into the payload required by the NAI API and stored vibe assets. */
  const handleEncodeVibe = async (
    index: number,
    options?: {
      silentSuccess?: boolean
      refetchUserData?: boolean
    },
  ) => {
    const vibe = naiForm.vibes[index]
    if (!vibe?.image || encodingVibeIndex !== null) {
      return null
    }

    try {
      setEncodingVibeIndex(index)
      const response = await encodeNaiVibe({
        image: vibe.image.dataUrl,
        model: naiForm.model,
        information_extracted: parseNumberInput(vibe.informationExtracted, 1),
      })
      setNaiForm((current) => ({
        ...current,
        vibes: current.vibes.map((entry, vibeIndex) => (
          vibeIndex === index
            ? {
              ...entry,
              encoded: response.encoded,
            }
            : entry
        )),
      }))
      if (options?.refetchUserData !== false) {
        await refetchUserData()
      }
      if (!options?.silentSuccess) {
        showSnackbar({ message: `Vibe ${index + 1} 인코딩 완료. 이 결과를 재사용하면 돼.`, tone: 'info' })
      }
      return response.encoded
    } catch (error) {
      if (isUnauthorizedAssetRequestError(error)) {
        await refetchUserData().catch(() => undefined)
        showSnackbar({ message: 'Vibe 저장 전에 NovelAI 로그인을 다시 해줘. 토큰이 없거나 만료됐어.', tone: 'error' })
      } else {
        showSnackbar({ message: getErrorMessage(error, 'Vibe 인코딩에 실패했어.'), tone: 'error' })
      }
      return null
    } finally {
      setEncodingVibeIndex(null)
    }
  }

  /** Ensure all current vibes are encoded before generation or saving. */
  const ensureEncodedVibes = async () => {
    const nextVibes = [...naiForm.vibes]
    let encodedCount = 0

    for (const [index, vibe] of nextVibes.entries()) {
      if (!vibe?.image || vibe.encoded.trim().length > 0) {
        continue
      }

      const encoded = await handleEncodeVibe(index, {
        silentSuccess: true,
        refetchUserData: false,
      })

      if (!encoded) {
        return null
      }

      nextVibes[index] = {
        ...vibe,
        encoded,
      }
      encodedCount += 1
    }

    if (encodedCount > 0) {
      await refetchUserData()
      showSnackbar({ message: `Vibe ${encodedCount}개 자동 인코딩 완료.`, tone: 'info' })
    }

    return nextVibes
  }

  /** Open the shared asset-save modal with one prefilled label/description pair. */
  const openAssetSaveModal = (target: AssetSaveTarget, initialName: string, initialDescription = '') => {
    setAssetSaveTarget(target)
    setAssetSaveName(initialName)
    setAssetSaveDescription(initialDescription)
  }

  /** Close and reset the shared asset-save modal. */
  const closeAssetSaveModal = () => {
    setAssetSaveTarget(null)
    setAssetSaveName('')
    setAssetSaveDescription('')
  }

  /** Open one create-save flow for the selected vibe draft. */
  const handleOpenVibeSaveModal = (index: number) => {
    const vibe = naiForm.vibes[index]
    if (!vibe?.image) {
      showSnackbar({ message: '저장하려면 먼저 Vibe 이미지를 넣어줘.', tone: 'error' })
      return
    }

    if (!naiUserEnabled) {
      showSnackbar({ message: 'Vibe 저장은 NovelAI 로그인 상태가 필요해.', tone: 'error' })
      return
    }

    openAssetSaveModal({ mode: 'create', kind: 'vibe', index }, deriveNaiAssetLabel(vibe.image.fileName, `Vibe ${index + 1}`))
  }

  /** Open one metadata-only edit flow for one stored vibe asset. */
  const handleOpenEditVibeFromStore = (assetId: string) => {
    const asset = savedVibesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    openAssetSaveModal({ mode: 'edit', kind: 'vibe', assetId }, asset.label, asset.description ?? '')
  }

  /** Load one stored vibe asset back into the current form draft. */
  const handleLoadVibeFromStore = async (assetId: string) => {
    const asset = savedVibesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    try {
      const detailedAsset = asset.encoded ? asset : await getNaiVibeAsset(assetId)
      const image: SelectedImageDraft | undefined = detailedAsset.image_data_url
        ? { fileName: detailedAsset.label, dataUrl: detailedAsset.image_data_url }
        : detailedAsset.image_url || detailedAsset.thumbnail_url
          ? await buildSelectedImageDraftFromUrl(detailedAsset.image_url || detailedAsset.thumbnail_url || '', detailedAsset.label)
          : undefined

      const encoded = detailedAsset.encoded
      if (!encoded) {
        throw new Error('저장된 Vibe payload가 없어.')
      }

      setNaiForm((current) => ({
        ...current,
        vibes: [...current.vibes, {
          image,
          encoded,
          strength: String(detailedAsset.strength),
          informationExtracted: String(detailedAsset.information_extracted),
        }],
      }))
      showSnackbar({ message: `${asset.label} 불러왔어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Vibe 이미지를 불러오지 못했어.'), tone: 'error' })
    }
  }

  /** Delete one stored vibe asset from the server library. */
  const handleDeleteVibeFromStore = async (assetId: string) => {
    try {
      await deleteNaiVibeAsset(assetId)
      await savedVibesQuery.refetch()
      showSnackbar({ message: '저장된 Vibe를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Vibe 삭제에 실패했어.'), tone: 'error' })
    }
  }

  /** Open one create-save flow for the selected character reference draft. */
  const handleOpenCharacterReferenceSaveModal = (index: number) => {
    const reference = naiForm.characterReferences[index]
    if (!reference?.image) {
      showSnackbar({ message: '저장하려면 Character Reference 이미지가 필요해.', tone: 'error' })
      return
    }

    openAssetSaveModal({ mode: 'create', kind: 'reference', index }, deriveNaiAssetLabel(reference.image.fileName, `Reference ${index + 1}`))
  }

  /** Open one metadata-only edit flow for one stored character reference asset. */
  const handleOpenEditCharacterReferenceFromStore = (assetId: string) => {
    const asset = savedCharacterReferencesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    openAssetSaveModal({ mode: 'edit', kind: 'reference', assetId }, asset.label, asset.description ?? '')
  }

  /** Load one stored character reference asset back into the current form draft. */
  const handleLoadCharacterReferenceFromStore = async (assetId: string) => {
    const asset = savedCharacterReferencesQuery.data?.find((entry) => entry.id === assetId)
    if (!asset) {
      return
    }

    try {
      const image = asset.image_data_url
        ? { fileName: asset.label, dataUrl: asset.image_data_url }
        : asset.image_url || asset.thumbnail_url
          ? await buildSelectedImageDraftFromUrl(asset.image_url || asset.thumbnail_url || '', asset.label)
          : undefined

      if (!image) {
        throw new Error('저장된 Character Reference 이미지가 없어.')
      }

      setNaiForm((current) => ({
        ...current,
        characterReferences: [...current.characterReferences, {
          image,
          type: asset.type,
          strength: String(asset.strength),
          fidelity: String(asset.fidelity),
        }],
      }))
      showSnackbar({ message: `${asset.label} 불러왔어.`, tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Character Reference 이미지를 불러오지 못했어.'), tone: 'error' })
    }
  }

  /** Delete one stored character reference asset from the server library. */
  const handleDeleteCharacterReferenceFromStore = async (assetId: string) => {
    try {
      await deleteNaiCharacterReferenceAsset(assetId)
      await savedCharacterReferencesQuery.refetch()
      showSnackbar({ message: '저장된 Character Reference를 삭제했어.', tone: 'info' })
    } catch (error) {
      showSnackbar({ message: getErrorMessage(error, '저장된 Character Reference 삭제에 실패했어.'), tone: 'error' })
    }
  }

  /** Save or update the currently targeted vibe/reference asset. */
  const handleConfirmAssetSave = async () => {
    if (!assetSaveTarget) {
      return
    }

    const trimmedName = assetSaveName.trim()
    if (!trimmedName) {
      showSnackbar({ message: '저장 이름을 입력해줘.', tone: 'error' })
      return
    }

    try {
      setIsSavingAsset(true)

      if (assetSaveTarget.kind === 'vibe') {
        if (assetSaveTarget.mode === 'edit') {
          await updateNaiVibeAsset(assetSaveTarget.assetId, {
            label: trimmedName,
            description: assetSaveDescription.trim() || undefined,
          })
          await savedVibesQuery.refetch()
          showSnackbar({ message: '저장된 Vibe를 수정했어.', tone: 'info' })
        } else {
          const vibe = naiForm.vibes[assetSaveTarget.index]
          if (!vibe?.image) {
            throw new Error('저장할 Vibe 이미지를 찾지 못했어.')
          }

          const encoded = vibe.encoded || await handleEncodeVibe(assetSaveTarget.index, {
            silentSuccess: true,
          })
          if (!encoded) {
            return
          }

          await saveNaiVibeAsset({
            label: trimmedName,
            description: assetSaveDescription.trim() || undefined,
            model: naiForm.model,
            image: vibe.image.dataUrl,
            encoded,
            strength: parseNumberInput(vibe.strength, 0.6),
            information_extracted: parseNumberInput(vibe.informationExtracted, 1),
          })
          await savedVibesQuery.refetch()
          showSnackbar({ message: `Vibe ${assetSaveTarget.index + 1} 저장 완료.`, tone: 'info' })
        }
      } else if (assetSaveTarget.mode === 'edit') {
        await updateNaiCharacterReferenceAsset(assetSaveTarget.assetId, {
          label: trimmedName,
          description: assetSaveDescription.trim() || undefined,
        })
        await savedCharacterReferencesQuery.refetch()
        showSnackbar({ message: '저장된 Character Reference를 수정했어.', tone: 'info' })
      } else {
        const reference = naiForm.characterReferences[assetSaveTarget.index]
        if (!reference?.image) {
          throw new Error('저장할 Character Reference 이미지를 찾지 못했어.')
        }

        await saveNaiCharacterReferenceAsset({
          label: trimmedName,
          description: assetSaveDescription.trim() || undefined,
          image: reference.image.dataUrl,
          type: reference.type,
          strength: parseNumberInput(reference.strength, 0.6),
          fidelity: parseNumberInput(reference.fidelity, 1),
        })
        await savedCharacterReferencesQuery.refetch()
        showSnackbar({ message: `Reference ${assetSaveTarget.index + 1} 저장 완료.`, tone: 'info' })
      }

      closeAssetSaveModal()
    } catch (error) {
      if (isUnauthorizedAssetRequestError(error)) {
        await refetchUserData().catch(() => undefined)
        showSnackbar({
          message: assetSaveTarget.kind === 'vibe'
            ? 'Vibe 저장 전에 NovelAI 로그인을 다시 해줘. 토큰이 없거나 만료됐어.'
            : '저장 권한을 다시 확인해줘. 로그인 세션이 끊겼을 수도 있어.',
          tone: 'error',
        })
      } else {
        showSnackbar({ message: getErrorMessage(error, '저장에 실패했어.'), tone: 'error' })
      }
    } finally {
      setIsSavingAsset(false)
    }
  }

  return {
    encodingVibeIndex,
    savedVibeSearch,
    setSavedVibeSearch,
    filteredSavedVibes,
    savedVibesLoading: savedVibesQuery.isLoading,
    savedCharacterReferenceSearch,
    setSavedCharacterReferenceSearch,
    filteredSavedCharacterReferences,
    savedCharacterReferencesLoading: savedCharacterReferencesQuery.isLoading,
    isSavingAsset,
    assetSaveTarget,
    assetSaveName,
    setAssetSaveName,
    assetSaveDescription,
    setAssetSaveDescription,
    assetSaveModalTitle,
    assetSaveSubmitLabel,
    closeAssetSaveModal,
    handleOpenVibeSaveModal,
    handleOpenEditVibeFromStore,
    handleLoadVibeFromStore,
    handleDeleteVibeFromStore,
    handleOpenCharacterReferenceSaveModal,
    handleOpenEditCharacterReferenceFromStore,
    handleLoadCharacterReferenceFromStore,
    handleDeleteCharacterReferenceFromStore,
    handleConfirmAssetSave,
    ensureEncodedVibes,
  }
}
