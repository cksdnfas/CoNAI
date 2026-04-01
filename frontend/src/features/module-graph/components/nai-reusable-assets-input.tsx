import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Pin, PinOff, Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { ImageAttachmentPickerButton } from '@/features/image-generation/components/image-attachment-picker'
import type { SelectedImageDraft } from '@/features/image-generation/image-generation-shared'
import {
  listNaiCharacterReferenceAssets,
  listNaiVibeAssets,
  type StoredNaiCharacterReferenceAsset,
  type StoredNaiVibeAsset,
} from '@/lib/api'

type NaiReusableAssetKind = 'vibes' | 'character_refs'

type NaiReusableAssetInputProps = {
  kind: NaiReusableAssetKind
  value: unknown
  onChange: (value: unknown) => void
}

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

type SavedAssetSortOption = 'pinned' | 'recent' | 'latest' | 'oldest' | 'name'

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

/** Load recently used asset ids from localStorage so pickers can prioritize repeat selections. */
function loadRecentAssetIds(storageKey: string) {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  try {
    const rawValue = window.localStorage.getItem(storageKey)
    if (!rawValue) {
      return [] as string[]
    }

    const parsedValue = JSON.parse(rawValue)
    return Array.isArray(parsedValue) ? parsedValue.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return [] as string[]
  }
}

/** Persist one recently used asset id and keep the newest picks near the top. */
function saveRecentAssetIds(storageKey: string, assetId: string, currentIds: string[]) {
  const nextIds = [assetId, ...currentIds.filter((entry) => entry !== assetId)].slice(0, 20)

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, JSON.stringify(nextIds))
  }

  return nextIds
}

/** Load pinned asset ids from localStorage so favorites can survive refreshes. */
function loadPinnedAssetIds(storageKey: string) {
  return loadRecentAssetIds(storageKey)
}

/** Toggle one pinned asset id and persist the updated favorite list. */
function togglePinnedAssetIds(storageKey: string, assetId: string, currentIds: string[]) {
  const nextIds = currentIds.includes(assetId)
    ? currentIds.filter((entry) => entry !== assetId)
    : [assetId, ...currentIds]

  if (typeof window !== 'undefined') {
    window.localStorage.setItem(storageKey, JSON.stringify(nextIds))
  }

  return nextIds
}

/** Sort saved asset cards so users can switch between pinned, recent use, recency, and name ordering. */
function sortSavedAssets<T extends { id: string; label: string; created_date: string }>(items: T[], sort: SavedAssetSortOption, recentIds: string[], pinnedIds: string[]) {
  const nextItems = [...items]

  if (sort === 'pinned') {
    return nextItems.sort((left, right) => {
      const leftPinnedIndex = pinnedIds.indexOf(left.id)
      const rightPinnedIndex = pinnedIds.indexOf(right.id)
      const normalizedLeftPinned = leftPinnedIndex === -1 ? Number.MAX_SAFE_INTEGER : leftPinnedIndex
      const normalizedRightPinned = rightPinnedIndex === -1 ? Number.MAX_SAFE_INTEGER : rightPinnedIndex

      if (normalizedLeftPinned !== normalizedRightPinned) {
        return normalizedLeftPinned - normalizedRightPinned
      }

      const leftRecentIndex = recentIds.indexOf(left.id)
      const rightRecentIndex = recentIds.indexOf(right.id)
      const normalizedLeftRecent = leftRecentIndex === -1 ? Number.MAX_SAFE_INTEGER : leftRecentIndex
      const normalizedRightRecent = rightRecentIndex === -1 ? Number.MAX_SAFE_INTEGER : rightRecentIndex
      if (normalizedLeftRecent !== normalizedRightRecent) {
        return normalizedLeftRecent - normalizedRightRecent
      }

      return new Date(right.created_date).getTime() - new Date(left.created_date).getTime()
    })
  }

  if (sort === 'recent') {
    return nextItems.sort((left, right) => {
      const leftIndex = recentIds.indexOf(left.id)
      const rightIndex = recentIds.indexOf(right.id)
      const normalizedLeft = leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex
      const normalizedRight = rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex

      if (normalizedLeft !== normalizedRight) {
        return normalizedLeft - normalizedRight
      }

      return new Date(right.created_date).getTime() - new Date(left.created_date).getTime()
    })
  }

  if (sort === 'name') {
    return nextItems.sort((left, right) => left.label.localeCompare(right.label, 'ko-KR'))
  }

  return nextItems.sort((left, right) => {
    const leftTime = new Date(left.created_date).getTime()
    const rightTime = new Date(right.created_date).getTime()
    return sort === 'oldest' ? leftTime - rightTime : rightTime - leftTime
  })
}

/** Render the reusable editor and saved-asset picker for NAI vibe and reference JSON inputs. */
export function NaiReusableAssetInput({ kind, value, onChange }: NaiReusableAssetInputProps) {
  const [savedVibeSearch, setSavedVibeSearch] = useState('')
  const [savedVibeSort, setSavedVibeSort] = useState<SavedAssetSortOption>('recent')
  const [recentVibeIds, setRecentVibeIds] = useState<string[]>(() => loadRecentAssetIds('conai.nai.vibes.recent'))
  const [pinnedVibeIds, setPinnedVibeIds] = useState<string[]>(() => loadPinnedAssetIds('conai.nai.vibes.pinned'))
  const [savedCharacterReferenceSearch, setSavedCharacterReferenceSearch] = useState('')
  const [savedCharacterReferenceSort, setSavedCharacterReferenceSort] = useState<SavedAssetSortOption>('recent')
  const [recentCharacterReferenceIds, setRecentCharacterReferenceIds] = useState<string[]>(() => loadRecentAssetIds('conai.nai.character_refs.recent'))
  const [pinnedCharacterReferenceIds, setPinnedCharacterReferenceIds] = useState<string[]>(() => loadPinnedAssetIds('conai.nai.character_refs.pinned'))
  const vibeDrafts = useMemo(() => (kind === 'vibes' ? parseNaiVibeDrafts(value) : []), [kind, value])
  const characterReferenceDrafts = useMemo(() => (kind === 'character_refs' ? parseNaiCharacterReferenceDrafts(value) : []), [kind, value])

  const savedVibesQuery = useQuery({
    queryKey: ['module-graph-nai-vibe-assets'],
    queryFn: () => listNaiVibeAssets(),
    enabled: kind === 'vibes',
  })

  const savedCharacterReferencesQuery = useQuery({
    queryKey: ['module-graph-nai-character-reference-assets'],
    queryFn: listNaiCharacterReferenceAssets,
    enabled: kind === 'character_refs',
  })

  const filteredSavedVibes = useMemo(() => {
    const items = savedVibesQuery.data || []
    const keyword = savedVibeSearch.trim().toLowerCase()
    const filteredItems = keyword
      ? items.filter((item) => `${item.label} ${item.model}`.toLowerCase().includes(keyword))
      : items

    return sortSavedAssets(filteredItems, savedVibeSort, recentVibeIds, pinnedVibeIds)
  }, [pinnedVibeIds, recentVibeIds, savedVibeSearch, savedVibeSort, savedVibesQuery.data])

  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = savedCharacterReferenceSearch.trim().toLowerCase()
    const filteredItems = keyword
      ? items.filter((item) => `${item.label} ${item.type}`.toLowerCase().includes(keyword))
      : items

    return sortSavedAssets(filteredItems, savedCharacterReferenceSort, recentCharacterReferenceIds, pinnedCharacterReferenceIds)
  }, [pinnedCharacterReferenceIds, recentCharacterReferenceIds, savedCharacterReferenceSearch, savedCharacterReferenceSort, savedCharacterReferencesQuery.data])

  const updateVibes = (nextDrafts: NaiVibeDraft[]) => {
    onChange(buildNaiVibeValue(nextDrafts))
  }

  const updateCharacterReferences = (nextDrafts: NaiCharacterReferenceDraft[]) => {
    onChange(buildNaiCharacterReferenceValue(nextDrafts))
  }

  const handleVibeImageChange = async (index: number, image?: SelectedImageDraft) => {
    updateVibes(vibeDrafts.map((draft, draftIndex) => (
      draftIndex === index
        ? { ...draft, image: image?.dataUrl }
        : draft
    )))
  }

  const handleCharacterReferenceImageChange = async (index: number, image?: SelectedImageDraft) => {
    updateCharacterReferences(characterReferenceDrafts.map((draft, draftIndex) => (
      draftIndex === index
        ? { ...draft, image: image?.dataUrl }
        : draft
    )))
  }

  const appendSavedVibe = (asset: StoredNaiVibeAsset) => {
    setRecentVibeIds((current) => saveRecentAssetIds('conai.nai.vibes.recent', asset.id, current))
    updateVibes([
      ...vibeDrafts,
      {
        image: asset.image_data_url,
        encoded: asset.encoded,
        strength: String(asset.strength),
        informationExtracted: String(asset.information_extracted),
      },
    ])
  }

  const appendSavedCharacterReference = (asset: StoredNaiCharacterReferenceAsset) => {
    setRecentCharacterReferenceIds((current) => saveRecentAssetIds('conai.nai.character_refs.recent', asset.id, current))
    updateCharacterReferences([
      ...characterReferenceDrafts,
      {
        image: asset.image_data_url,
        type: asset.type,
        strength: String(asset.strength),
        fidelity: String(asset.fidelity),
      },
    ])
  }

  const togglePinnedVibe = (assetId: string) => {
    setPinnedVibeIds((current) => togglePinnedAssetIds('conai.nai.vibes.pinned', assetId, current))
  }

  const togglePinnedCharacterReference = (assetId: string) => {
    setPinnedCharacterReferenceIds((current) => togglePinnedAssetIds('conai.nai.character_refs.pinned', assetId, current))
  }

  if (kind === 'vibes') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low px-3 py-2.5">
          <div>
            <div className="text-sm font-medium text-foreground">Vibe Transfer</div>
            <div className="text-xs text-muted-foreground">encoded vibe를 직접 넣거나 saved vibe를 바로 추가해.</div>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={() => updateVibes([...vibeDrafts, { encoded: '', strength: '0.6', informationExtracted: '1' }])}>
            <Plus className="h-4 w-4" />
            추가
          </Button>
        </div>

        {vibeDrafts.length === 0 ? (
          <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">아직 vibe 입력이 없어.</div>
        ) : (
          vibeDrafts.map((draft, index) => (
            <div key={`nai-vibe-input-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Vibe {index + 1}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateVibes(vibeDrafts.filter((_, draftIndex) => draftIndex !== index))}>
                  <Trash2 className="h-4 w-4" />
                  제거
                </Button>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Reference Image</span>
                <ImageAttachmentPickerButton label={draft.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Vibe ${index + 1} 이미지 선택`} onSelect={(image) => void handleVibeImageChange(index, image)} />
                {draft.image ? <img src={draft.image} alt={`Vibe ${index + 1}`} className="max-h-40 rounded-sm border border-border object-contain" /> : null}
              </label>

              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Encoded</span>
                <Textarea rows={4} value={draft.encoded} onChange={(event) => updateVibes(vibeDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, encoded: event.target.value } : entry))} placeholder="encoded vibe payload" />
              </label>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Strength</span>
                  <Input type="number" min={0.01} max={1} step={0.01} value={draft.strength} onChange={(event) => updateVibes(vibeDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, strength: event.target.value } : entry))} />
                </label>
                <label className="space-y-2">
                  <span className="text-sm font-medium text-foreground">Information Extracted</span>
                  <Input type="number" min={0.01} max={1} step={0.01} value={draft.informationExtracted} onChange={(event) => updateVibes(vibeDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, informationExtracted: event.target.value } : entry))} />
                </label>
              </div>
            </div>
          ))
        )}

        <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-foreground">Saved Vibes</div>
              <Badge variant="outline">{savedVibesQuery.data?.length ?? 0}</Badge>
            </div>
            <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px] sm:flex-row">
              <Input value={savedVibeSearch} onChange={(event) => setSavedVibeSearch(event.target.value)} placeholder="이름 / 모델 검색" />
              <Select value={savedVibeSort} onChange={(event) => setSavedVibeSort(event.target.value as SavedAssetSortOption)}>
                <option value="pinned">핀 우선</option>
                <option value="recent">최근 사용순</option>
                <option value="latest">최신순</option>
                <option value="oldest">오래된순</option>
                <option value="name">이름순</option>
              </Select>
            </div>
          </div>
          {savedVibesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">불러오는 중…</div>
          ) : filteredSavedVibes.length > 0 ? (
            <div className="grid gap-3 md:grid-cols-2">
              {filteredSavedVibes.map((asset) => (
                <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                  <div className="flex gap-3">
                    {asset.image_data_url ? (
                      <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                    ) : (
                      <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-sm border border-dashed border-border text-[11px] text-muted-foreground">
                        no preview
                      </div>
                    )}
                    <div className="min-w-0 space-y-2">
                      <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                      <div className="truncate text-xs text-muted-foreground">{asset.model}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {pinnedVibeIds.includes(asset.id) ? <Badge variant="secondary">핀</Badge> : null}
                        <Badge variant="outline">strength {asset.strength}</Badge>
                        <Badge variant="outline">IE {asset.information_extracted}</Badge>
                      </div>
                      <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                    </div>
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button type="button" size="sm" variant="ghost" onClick={() => togglePinnedVibe(asset.id)}>
                      {pinnedVibeIds.includes(asset.id) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                      {pinnedVibeIds.includes(asset.id) ? '핀 해제' : '핀'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => appendSavedVibe(asset)}>
                      <Save className="h-4 w-4" />
                      추가
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 vibe가 없어.</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-low px-3 py-2.5">
        <div>
          <div className="text-sm font-medium text-foreground">Character Reference</div>
          <div className="text-xs text-muted-foreground">reference 이미지를 직접 넣거나 saved reference를 추가해.</div>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={() => updateCharacterReferences([...characterReferenceDrafts, { type: 'character&style', strength: '0.6', fidelity: '1' }])}>
          <Plus className="h-4 w-4" />
          추가
        </Button>
      </div>

      {characterReferenceDrafts.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border bg-surface-low px-3 py-4 text-sm text-muted-foreground">아직 reference 입력이 없어.</div>
      ) : (
        characterReferenceDrafts.map((draft, index) => (
          <div key={`nai-character-reference-input-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
              <Button type="button" size="sm" variant="ghost" onClick={() => updateCharacterReferences(characterReferenceDrafts.filter((_, draftIndex) => draftIndex !== index))}>
                <Trash2 className="h-4 w-4" />
                제거
              </Button>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Reference Image</span>
              <ImageAttachmentPickerButton label={draft.image ? '참조 이미지 변경' : '참조 이미지 선택'} modalTitle={`Reference ${index + 1} 이미지 선택`} onSelect={(image) => void handleCharacterReferenceImageChange(index, image)} />
              {draft.image ? <img src={draft.image} alt={`Reference ${index + 1}`} className="max-h-40 rounded-sm border border-border object-contain" /> : null}
            </label>

            <div className="grid gap-3 md:grid-cols-3">
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Type</span>
                <Select value={draft.type} onChange={(event) => updateCharacterReferences(characterReferenceDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, type: event.target.value as NaiCharacterReferenceDraft['type'] } : entry))}>
                  <option value="character">character</option>
                  <option value="style">style</option>
                  <option value="character&style">character&style</option>
                </Select>
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Strength</span>
                <Input type="number" min={0} max={1} step={0.01} value={draft.strength} onChange={(event) => updateCharacterReferences(characterReferenceDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, strength: event.target.value } : entry))} />
              </label>
              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Fidelity</span>
                <Input type="number" min={0} max={1} step={0.01} value={draft.fidelity} onChange={(event) => updateCharacterReferences(characterReferenceDrafts.map((entry, draftIndex) => draftIndex === index ? { ...entry, fidelity: event.target.value } : entry))} />
              </label>
            </div>
          </div>
        ))
      )}

      <div className="space-y-2 rounded-sm border border-border bg-surface-low p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">Saved Character References</div>
            <Badge variant="outline">{savedCharacterReferencesQuery.data?.length ?? 0}</Badge>
          </div>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:min-w-[280px] sm:flex-row">
            <Input value={savedCharacterReferenceSearch} onChange={(event) => setSavedCharacterReferenceSearch(event.target.value)} placeholder="이름 / 타입 검색" />
            <Select value={savedCharacterReferenceSort} onChange={(event) => setSavedCharacterReferenceSort(event.target.value as SavedAssetSortOption)}>
              <option value="pinned">핀 우선</option>
              <option value="recent">최근 사용순</option>
              <option value="latest">최신순</option>
              <option value="oldest">오래된순</option>
              <option value="name">이름순</option>
            </Select>
          </div>
        </div>
        {savedCharacterReferencesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중…</div>
        ) : filteredSavedCharacterReferences.length > 0 ? (
          <div className="grid gap-3 md:grid-cols-2">
            {filteredSavedCharacterReferences.map((asset) => (
              <div key={asset.id} className="space-y-3 rounded-sm border border-border bg-surface-low p-3">
                <div className="flex gap-3">
                  <img src={asset.image_data_url} alt={asset.label} className="h-20 w-20 shrink-0 rounded-sm border border-border object-contain" />
                  <div className="min-w-0 space-y-2">
                    <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {pinnedCharacterReferenceIds.includes(asset.id) ? <Badge variant="secondary">핀</Badge> : null}
                      <Badge variant="outline">{asset.type}</Badge>
                      <Badge variant="outline">strength {asset.strength}</Badge>
                      <Badge variant="outline">fidelity {asset.fidelity}</Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground">{new Date(asset.created_date).toLocaleString('ko-KR')}</div>
                  </div>
                </div>
                <div className="flex justify-end gap-2">
                  <Button type="button" size="sm" variant="ghost" onClick={() => togglePinnedCharacterReference(asset.id)}>
                    {pinnedCharacterReferenceIds.includes(asset.id) ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
                    {pinnedCharacterReferenceIds.includes(asset.id) ? '핀 해제' : '핀'}
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => appendSavedCharacterReference(asset)}>
                    <Save className="h-4 w-4" />
                    추가
                  </Button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">검색 결과가 없거나 저장된 reference가 없어.</div>
        )}
      </div>
    </div>
  )
}
