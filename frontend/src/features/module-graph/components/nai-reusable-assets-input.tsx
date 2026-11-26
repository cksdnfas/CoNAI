import { useMemo, useState } from 'react'
import { useSerializedDrafts } from './use-serialized-drafts'
import { useQuery } from '@tanstack/react-query'
import { NAI_CHARACTER_REFERENCE_TYPES, supportsNaiCharacterReferences } from '@conai/shared'
import { NaiCharacterReferencesEditor } from '@/features/image-generation/components/nai-assets/nai-character-references-editor'
import { sortNaiSavedAssets, useNaiSavedAssetPreferences } from '@/features/image-generation/components/nai-assets/nai-saved-asset-preferences'
import { NaiVibesEditor } from '@/features/image-generation/components/nai-assets/nai-vibes-editor'
import { buildSelectedImageDraftFromUrl } from '@/features/image-generation/image-generation-drafts'
import {
  getNaiVibesUnsupportedMessage,
  supportsNaiVibes,
  type NAICharacterReferenceDraft,
  type NAIVibeDraft,
  type SelectedImageDraft,
} from '@/features/image-generation/image-generation-shared'
import { Text } from '@/components/ui/text'
import { useI18n } from '@/i18n'
import {
  getNaiVibeAsset,
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  NAI_CHARACTER_REFERENCE_ASSETS_QUERY_KEY,
  naiVibeAssetsQueryKey,
} from '@/lib/api-image-generation-nai'
import type { StoredNaiCharacterReferenceAsset, StoredNaiVibeAsset } from '@/lib/api-image-generation-types'

type NaiReusableAssetKind = 'vibes' | 'character_refs'

type NaiReusableAssetInputProps = {
  kind: NaiReusableAssetKind
  value: unknown
  onChange: (value: unknown) => void
  /** Model of the same NAI node when known; a V5 model cannot add vibes and warns about existing rows. */
  model?: string
}

/** Node-input rows keep the image as a bare data URL (the graph JSON shape), unlike the form's SelectedImageDraft. */
type NaiVibeDraft = {
  image?: string
  encoded: string
  strength: string
  informationExtracted: string
}

type NaiCharacterReferenceDraft = Omit<NAICharacterReferenceDraft, 'image'> & {
  image?: string
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
      type: NAI_CHARACTER_REFERENCE_TYPES.find((type) => type === rawEntry.type) ?? 'character&style',
      preferSameOutfit: rawEntry.prefer_same_outfit === true,
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
      prefer_same_outfit: draft.preferSameOutfit,
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
export function NaiReusableAssetInput({ kind, value, onChange, model }: NaiReusableAssetInputProps) {
  return kind === 'vibes'
    ? <NaiVibeNodeInput value={value} onChange={onChange} model={model} />
    : <NaiCharacterReferenceNodeInput value={value} onChange={onChange} model={model} />
}

function NaiVibeNodeInput({ value, onChange, model }: Omit<NaiReusableAssetInputProps, 'kind'>) {
  const { t, locale } = useI18n()
  const supportsVibes = model === undefined || supportsNaiVibes(model)
  const [search, setSearch] = useState('')
  const preferences = useNaiSavedAssetPreferences('conai.nai.vibes')
  const [drafts, updateVibes] = useSerializedDrafts(value, parseNaiVibeDrafts, buildNaiVibeValue, onChange)
  const formDrafts = useMemo<NAIVibeDraft[]>(() => drafts.map((draft) => ({ ...draft, image: toImageDraft(draft.image) })), [drafts])

  const savedVibesQuery = useQuery({
    queryKey: naiVibeAssetsQueryKey(),
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
    <>
      {/* NovelAI rejects vibes on V5 models, so a run with these rows fails. */}
      {!supportsVibes && drafts.length > 0 ? <Text as="p" variant="caption" tone="warning">{getNaiVibesUnsupportedMessage(t)}</Text> : null}
      <NaiVibesEditor
        vibes={formDrafts}
        supportsVibes={supportsVibes}
        defaultOpen
        onAddImage={(image) => updateVibes([...drafts, { image: image.dataUrl, encoded: '', strength: '0.6', informationExtracted: '1' }])}
        onRemove={(index) => updateVibes(drafts.filter((_, draftIndex) => draftIndex !== index))}
        onImageChange={(index, image) => updateVibes(replaceAt(drafts, index, { image: image?.dataUrl }))}
        onFieldChange={(index, field, nextValue) => updateVibes(replaceAt(drafts, index, { [field]: nextValue }))}
        onEncodedChange={(index, encoded) => updateVibes(replaceAt(drafts, index, { encoded }))}
        library={{
          assets: filteredSavedVibes,
          searchValue: search,
          searchPlaceholder: t({ ko: '이름 / 모델 검색', en: 'Search name / model' }),
          emptyMessage: t({ ko: '검색 결과가 없거나 저장된 vibe가 없어', en: 'There are no search results or saved vibes' }),
          isLoading: savedVibesQuery.isLoading,
          onSearchChange: setSearch,
          onSelect: (asset) => void appendSavedVibe(asset),
          sort: { value: sort, onChange: preferences.setSort },
          pinnedIds: preferences.pinnedIdSet,
          onTogglePin: preferences.togglePin,
        }}
      />
    </>
  )
}

function NaiCharacterReferenceNodeInput({ value, onChange, model }: Omit<NaiReusableAssetInputProps, 'kind'>) {
  const { t, locale } = useI18n()
  const [search, setSearch] = useState('')
  const preferences = useNaiSavedAssetPreferences('conai.nai.character_refs')
  const [drafts, updateCharacterReferences] = useSerializedDrafts(value, parseNaiCharacterReferenceDrafts, buildNaiCharacterReferenceValue, onChange)
  const formDrafts = useMemo<NAICharacterReferenceDraft[]>(() => drafts.map((draft) => ({ ...draft, image: toImageDraft(draft.image) })), [drafts])

  const savedCharacterReferencesQuery = useQuery({
    queryKey: NAI_CHARACTER_REFERENCE_ASSETS_QUERY_KEY,
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
        preferSameOutfit: asset.prefer_same_outfit,
      },
    ])
    preferences.markRecent(asset.id)
  }

  return (
    <NaiCharacterReferencesEditor
      references={formDrafts}
      model={model}
      supportsCharacterReference={!model || supportsNaiCharacterReferences(model)}
      defaultOpen
      onAddImage={(image) => updateCharacterReferences([...drafts, { image: image.dataUrl, type: 'character&style', strength: '0.6', fidelity: '1' }])}
      onRemove={(index) => updateCharacterReferences(drafts.filter((_, draftIndex) => draftIndex !== index))}
      onImageChange={(index, image) => updateCharacterReferences(replaceAt(drafts, index, { image: image?.dataUrl }))}
      onFieldChange={(index, patch) => updateCharacterReferences(replaceAt(drafts, index, patch))}
      library={{
        assets: filteredSavedCharacterReferences,
        searchValue: search,
        searchPlaceholder: t({ ko: '이름 / 타입 검색', en: 'Search name / type' }),
        emptyMessage: t({ ko: '검색 결과가 없거나 저장된 reference가 없어', en: 'There are no search results or saved references' }),
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
