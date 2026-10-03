import { useMemo, useState } from 'react'
import { useSerializedDrafts } from './use-serialized-drafts'
import { useQuery } from '@tanstack/react-query'
import { NaiCharacterReferencesEditor } from '@/features/image-generation/components/nai-assets/nai-character-references-editor'
import { sortNaiSavedAssets, useNaiSavedAssetPreferences } from '@/features/image-generation/components/nai-assets/nai-saved-asset-preferences'
import { NaiVibesEditor } from '@/features/image-generation/components/nai-assets/nai-vibes-editor'
import { buildSelectedImageDraftFromUrl } from '@/features/image-generation/image-generation-drafts'
import type {
  NAICharacterReferenceDraft,
  NAIVibeDraft,
  SelectedImageDraft,
} from '@/features/image-generation/image-generation-shared'
import { useI18n } from '@/i18n'
import {
  getNaiVibeAsset,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
} from '@/lib/api-image-generation-nai'
import type { StoredNaiCharacterReferenceAsset, StoredNaiVibeAsset } from '@/lib/api-image-generation-types'

type NaiReusableAssetKind = 'vibes' | 'character_refs'

type NaiReusableAssetInputProps = {
  kind: NaiReusableAssetKind
  value: unknown
  onChange: (value: unknown) => void
}

/** Node-input rows keep the image as a bare data URL (the graph JSON shape), unlike the form's SelectedImageDraft. */
type NaiVibeDraft = {
  image?: string
  encoded: string
  strength: string
  informationExtracted: string
}

type NaiCharacterReferenceDraft = {
  image?: string
  type: 'character' | 'style' | 'character&style'
  strength: string
  fidelity: string
}

/** Detect whether one JSON input should render the reusable vibe picker/editor. */
export function isNaiVibePort(portKey: string, dataType: string) {
  return dataType === 'json' && portKey === 'vibes'
}

/** Detect whether one JSON input should render the reusable character-reference picker/editor. */
export function isNaiCharacterReferencePort(portKey: string, dataType: string) {
  return dataType === 'json' && portKey === 'character_refs'
}

/** Parse unknown runtime values into editable vibe rows. */
function parseNaiVibeDrafts(value: unknown): NaiVibeDraft[] {
  if (!value) {
    return []
  }

  let source: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      source = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (!Array.isArray(source)) {
    return []
  }

  return source.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { encoded: '', strength: '0.6', informationExtracted: '1' }
    }

    const rawEntry = entry as Record<string, unknown>
    return {
      image: typeof rawEntry.image === 'string' ? rawEntry.image : undefined,
      encoded: typeof rawEntry.encoded === 'string' ? rawEntry.encoded : '',
      strength: typeof rawEntry.strength === 'number' ? String(rawEntry.strength) : typeof rawEntry.strength === 'string' ? rawEntry.strength : '0.6',
      informationExtracted:
        typeof rawEntry.information_extracted === 'number'
          ? String(rawEntry.information_extracted)
          : typeof rawEntry.information_extracted === 'string'
            ? rawEntry.information_extracted
            : '1',
    }
  })
}

/** Parse unknown runtime values into editable character-reference rows. */
function parseNaiCharacterReferenceDrafts(value: unknown): NaiCharacterReferenceDraft[] {
  if (!value) {
    return []
  }

  let source: unknown = value
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) {
      return []
    }

    try {
      source = JSON.parse(trimmed)
    } catch {
      return []
    }
  }

  if (!Array.isArray(source)) {
    return []
  }

  return source.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      return { type: 'character&style', strength: '0.6', fidelity: '1' }
    }

    const rawEntry = entry as Record<string, unknown>
    return {
      image: typeof rawEntry.image === 'string' ? rawEntry.image : undefined,
      type:
        rawEntry.type === 'character' || rawEntry.type === 'style' || rawEntry.type === 'character&style'
          ? rawEntry.type
          : 'character&style',
      strength: typeof rawEntry.strength === 'number' ? String(rawEntry.strength) : typeof rawEntry.strength === 'string' ? rawEntry.strength : '0.6',
      fidelity: typeof rawEntry.fidelity === 'number' ? String(rawEntry.fidelity) : typeof rawEntry.fidelity === 'string' ? rawEntry.fidelity : '1',
    }
  })
}

/** Convert editable vibe rows back into the backend JSON payload shape. */
function buildNaiVibeValue(drafts: NaiVibeDraft[]) {
  const nextValue = drafts
    .map((draft) => ({
      image: draft.image,
      encoded: draft.encoded.trim(),
      strength: Number(draft.strength),
      information_extracted: Number(draft.informationExtracted),
    }))
    .filter((draft) => draft.encoded.length > 0)

  return nextValue.length > 0 ? nextValue : undefined
}

/** Convert editable character-reference rows back into the backend JSON payload shape. */
function buildNaiCharacterReferenceValue(drafts: NaiCharacterReferenceDraft[]) {
  const nextValue = drafts
    .map((draft) => ({
      image: draft.image,
      type: draft.type,
      strength: Number(draft.strength),
      fidelity: Number(draft.fidelity),
    }))
    .filter((draft) => typeof draft.image === 'string' && draft.image.length > 0)

  return nextValue.length > 0 ? nextValue : undefined
}

/** Wrap a bare data URL so the shared editor can preview it (node values carry no file name). */
function toImageDraft(image?: string): SelectedImageDraft | undefined {
  return image ? { fileName: '', dataUrl: image } : undefined
}

function replaceAt<T>(items: T[], index: number, patch: Partial<T>) {
  return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...patch } : item))
}

/** Render the shared NAI asset editor + saved-asset picker for vibe and reference JSON inputs. */
export function NaiReusableAssetInput({ kind, value, onChange }: NaiReusableAssetInputProps) {
  return kind === 'vibes'
    ? <NaiVibeNodeInput value={value} onChange={onChange} />
    : <NaiCharacterReferenceNodeInput value={value} onChange={onChange} />
}

function NaiVibeNodeInput({ value, onChange }: Omit<NaiReusableAssetInputProps, 'kind'>) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const preferences = useNaiSavedAssetPreferences('conai.nai.vibes')
  const [drafts, updateVibes] = useSerializedDrafts(value, parseNaiVibeDrafts, buildNaiVibeValue, onChange)
  const formDrafts = useMemo<NAIVibeDraft[]>(() => drafts.map((draft) => ({ ...draft, image: toImageDraft(draft.image) })), [drafts])

  const savedVibesQuery = useQuery({
    queryKey: ['module-graph-nai-vibe-assets'],
    queryFn: () => listNaiVibeAssets(),
  })

  const { sort, recentIds, pinnedIds } = preferences
  const filteredSavedVibes = useMemo(() => {
    const items = savedVibesQuery.data || []
    const keyword = search.trim().toLowerCase()
    const filteredItems = keyword
      ? items.filter((item) => `${item.label} ${item.model}`.toLowerCase().includes(keyword))
      : items

    return sortNaiSavedAssets(filteredItems, sort, recentIds, pinnedIds, locale)
  }, [locale, pinnedIds, recentIds, sort, search, savedVibesQuery.data])


  const appendSavedVibe = async (asset: StoredNaiVibeAsset) => {
    const detailedAsset = asset.encoded ? asset : await getNaiVibeAsset(asset.id)
    let image = detailedAsset.image_data_url

    if (!image && (detailedAsset.image_url || detailedAsset.thumbnail_url)) {
      try {
        image = (await buildSelectedImageDraftFromUrl(detailedAsset.image_url || detailedAsset.thumbnail_url || '', detailedAsset.label)).dataUrl
      } catch (error) {
        console.error('Failed to load saved vibe image:', error)
      }
    }

    const encoded = detailedAsset.encoded
    if (!encoded) {
      console.error('Saved vibe payload is missing:', detailedAsset.id)
      return
    }

    preferences.markRecent(asset.id)
    updateVibes([
      ...drafts,
      {
        image,
        encoded,
        strength: String(detailedAsset.strength),
        informationExtracted: String(detailedAsset.information_extracted),
      },
    ])
  }

  return (
    <NaiVibesEditor
      vibes={formDrafts}
      defaultOpen
      emptyLabel={t({ ko: '아직 vibe 입력이 없어.', en: 'There are no vibe inputs yet.' })}
      onAddImage={(image) => updateVibes([...drafts, { image: image.dataUrl, encoded: '', strength: '0.6', informationExtracted: '1' }])}
      onRemove={(index) => updateVibes(drafts.filter((_, draftIndex) => draftIndex !== index))}
      onImageChange={(index, image) => updateVibes(replaceAt(drafts, index, { image: image?.dataUrl }))}
      onFieldChange={(index, field, nextValue) => updateVibes(replaceAt(drafts, index, { [field]: nextValue }))}
      onEncodedChange={(index, encoded) => updateVibes(replaceAt(drafts, index, { encoded }))}
      library={{
        assets: filteredSavedVibes,
        searchValue: search,
        searchPlaceholder: t({ ko: '이름 / 모델 검색', en: 'Search name / model' }),
        emptyMessage: t({ ko: '검색 결과가 없거나 저장된 vibe가 없어.', en: 'There are no search results or saved vibes.' }),
        isLoading: savedVibesQuery.isLoading,
        onSearchChange: setSearch,
        onSelect: (asset) => void appendSavedVibe(asset),
        sort: { value: sort, onChange: preferences.setSort },
        pinnedIds: preferences.pinnedIdSet,
        onTogglePin: preferences.togglePin,
      }}
    />
  )
}

function NaiCharacterReferenceNodeInput({ value, onChange }: Omit<NaiReusableAssetInputProps, 'kind'>) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const preferences = useNaiSavedAssetPreferences('conai.nai.character_refs')
  const [drafts, updateCharacterReferences] = useSerializedDrafts(value, parseNaiCharacterReferenceDrafts, buildNaiCharacterReferenceValue, onChange)
  const formDrafts = useMemo<NAICharacterReferenceDraft[]>(() => drafts.map((draft) => ({ ...draft, image: toImageDraft(draft.image) })), [drafts])

  const savedCharacterReferencesQuery = useQuery({
    queryKey: ['module-graph-nai-character-reference-assets'],
    queryFn: listNaiCharacterReferenceAssets,
  })

  const { sort, recentIds, pinnedIds } = preferences
  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = search.trim().toLowerCase()
    const filteredItems = keyword
      ? items.filter((item) => `${item.label} ${item.type}`.toLowerCase().includes(keyword))
      : items

    return sortNaiSavedAssets(filteredItems, sort, recentIds, pinnedIds, locale)
  }, [locale, pinnedIds, recentIds, sort, search, savedCharacterReferencesQuery.data])

  const appendSavedCharacterReference = async (asset: StoredNaiCharacterReferenceAsset) => {
    let image = asset.image_data_url

    if (!image && (asset.image_url || asset.thumbnail_url)) {
      try {
        image = (await buildSelectedImageDraftFromUrl(asset.image_url || asset.thumbnail_url || '', asset.label)).dataUrl
      } catch (error) {
        console.error('Failed to load saved character reference image:', error)
      }
    }

    updateCharacterReferences([
      ...drafts,
      {
        image,
        type: asset.type,
        strength: String(asset.strength),
        fidelity: String(asset.fidelity),
      },
    ])
    preferences.markRecent(asset.id)
  }

  return (
    <NaiCharacterReferencesEditor
      references={formDrafts}
      defaultOpen
      emptyLabel={t({ ko: '아직 reference 입력이 없어.', en: 'There are no reference inputs yet.' })}
      onAddImage={(image) => updateCharacterReferences([...drafts, { image: image.dataUrl, type: 'character&style', strength: '0.6', fidelity: '1' }])}
      onRemove={(index) => updateCharacterReferences(drafts.filter((_, draftIndex) => draftIndex !== index))}
      onImageChange={(index, image) => updateCharacterReferences(replaceAt(drafts, index, { image: image?.dataUrl }))}
      onFieldChange={(index, field, nextValue) => updateCharacterReferences(replaceAt(drafts, index, (
        field === 'type'
          ? { type: nextValue as NaiCharacterReferenceDraft['type'] }
          : { [field]: nextValue }
      )))}
      library={{
        assets: filteredSavedCharacterReferences,
        searchValue: search,
        searchPlaceholder: t({ ko: '이름 / 타입 검색', en: 'Search name / type' }),
        emptyMessage: t({ ko: '검색 결과가 없거나 저장된 reference가 없어.', en: 'There are no search results or saved references.' }),
        isLoading: savedCharacterReferencesQuery.isLoading,
        onSearchChange: setSearch,
        onSelect: (asset) => void appendSavedCharacterReference(asset),
        sort: { value: sort, onChange: preferences.setSort },
        pinnedIds: preferences.pinnedIdSet,
        onTogglePin: preferences.togglePin,
      }}
    />
  )
}
