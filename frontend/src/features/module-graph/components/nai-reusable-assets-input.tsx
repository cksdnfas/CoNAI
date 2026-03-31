import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Plus, Save, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
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

/** Detect whether one JSON input should render the reusable vibe picker/editor. */
export function isNaiVibePort(portKey: string, dataType: string) {
  return dataType === 'json' && portKey === 'vibes'
}

/** Detect whether one JSON input should render the reusable character-reference picker/editor. */
export function isNaiCharacterReferencePort(portKey: string, dataType: string) {
  return dataType === 'json' && portKey === 'character_refs'
}

/** Read a local file into a data URL so module inputs can keep using plain JSON payloads. */
function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '')
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file as data URL'))
    reader.readAsDataURL(file)
  })
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

/** Render the reusable editor and saved-asset picker for NAI vibe and reference JSON inputs. */
export function NaiReusableAssetInput({ kind, value, onChange }: NaiReusableAssetInputProps) {
  const [savedVibeSearch, setSavedVibeSearch] = useState('')
  const [savedCharacterReferenceSearch, setSavedCharacterReferenceSearch] = useState('')
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
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.model}`.toLowerCase().includes(keyword))
  }, [savedVibeSearch, savedVibesQuery.data])

  const filteredSavedCharacterReferences = useMemo(() => {
    const items = savedCharacterReferencesQuery.data || []
    const keyword = savedCharacterReferenceSearch.trim().toLowerCase()
    if (!keyword) {
      return items
    }

    return items.filter((item) => `${item.label} ${item.type}`.toLowerCase().includes(keyword))
  }, [savedCharacterReferenceSearch, savedCharacterReferencesQuery.data])

  const updateVibes = (nextDrafts: NaiVibeDraft[]) => {
    onChange(buildNaiVibeValue(nextDrafts))
  }

  const updateCharacterReferences = (nextDrafts: NaiCharacterReferenceDraft[]) => {
    onChange(buildNaiCharacterReferenceValue(nextDrafts))
  }

  const handleVibeImageChange = async (index: number, file?: File) => {
    if (!file) {
      updateVibes(vibeDrafts.map((draft, draftIndex) => (
        draftIndex === index
          ? { ...draft, image: undefined }
          : draft
      )))
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    updateVibes(vibeDrafts.map((draft, draftIndex) => (
      draftIndex === index
        ? { ...draft, image: dataUrl }
        : draft
    )))
  }

  const handleCharacterReferenceImageChange = async (index: number, file?: File) => {
    if (!file) {
      updateCharacterReferences(characterReferenceDrafts.map((draft, draftIndex) => (
        draftIndex === index
          ? { ...draft, image: undefined }
          : draft
      )))
      return
    }

    const dataUrl = await readFileAsDataUrl(file)
    updateCharacterReferences(characterReferenceDrafts.map((draft, draftIndex) => (
      draftIndex === index
        ? { ...draft, image: dataUrl }
        : draft
    )))
  }

  const appendSavedVibe = (asset: StoredNaiVibeAsset) => {
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

  if (kind === 'vibes') {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-container px-3 py-2.5">
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
          <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">아직 vibe 입력이 없어.</div>
        ) : (
          vibeDrafts.map((draft, index) => (
            <div key={`nai-vibe-input-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm font-medium text-foreground">Vibe {index + 1}</div>
                <Button type="button" size="sm" variant="ghost" onClick={() => updateVibes(vibeDrafts.filter((_, draftIndex) => draftIndex !== index))}>
                  <Trash2 className="h-4 w-4" />
                  제거
                </Button>
              </div>

              <label className="space-y-2">
                <span className="text-sm font-medium text-foreground">Reference Image</span>
                <Input type="file" accept="image/*" onChange={(event) => void handleVibeImageChange(index, event.target.files?.[0])} />
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

        <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="text-sm font-medium text-foreground">Saved Vibes</div>
              <Badge variant="outline">{savedVibesQuery.data?.length ?? 0}</Badge>
            </div>
            <div className="w-full sm:w-64">
              <Input value={savedVibeSearch} onChange={(event) => setSavedVibeSearch(event.target.value)} placeholder="이름 / 모델 검색" />
            </div>
          </div>
          {savedVibesQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">불러오는 중…</div>
          ) : filteredSavedVibes.length > 0 ? (
            <div className="grid gap-2">
              {filteredSavedVibes.map((asset) => (
                <div key={asset.id} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-low px-3 py-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                    <div className="truncate text-xs text-muted-foreground">{asset.model} · strength {asset.strength}</div>
                  </div>
                  <Button type="button" size="sm" variant="outline" onClick={() => appendSavedVibe(asset)}>
                    <Save className="h-4 w-4" />
                    추가
                  </Button>
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
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-border bg-surface-container px-3 py-2.5">
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
        <div className="rounded-sm border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">아직 reference 입력이 없어.</div>
      ) : (
        characterReferenceDrafts.map((draft, index) => (
          <div key={`nai-character-reference-input-${index}`} className="space-y-3 rounded-sm border border-border bg-surface-container p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground">Reference {index + 1}</div>
              <Button type="button" size="sm" variant="ghost" onClick={() => updateCharacterReferences(characterReferenceDrafts.filter((_, draftIndex) => draftIndex !== index))}>
                <Trash2 className="h-4 w-4" />
                제거
              </Button>
            </div>

            <label className="space-y-2">
              <span className="text-sm font-medium text-foreground">Reference Image</span>
              <Input type="file" accept="image/*" onChange={(event) => void handleCharacterReferenceImageChange(index, event.target.files?.[0])} />
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

      <div className="space-y-2 rounded-sm border border-border bg-surface-container p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="text-sm font-medium text-foreground">Saved Character References</div>
            <Badge variant="outline">{savedCharacterReferencesQuery.data?.length ?? 0}</Badge>
          </div>
          <div className="w-full sm:w-64">
            <Input value={savedCharacterReferenceSearch} onChange={(event) => setSavedCharacterReferenceSearch(event.target.value)} placeholder="이름 / 타입 검색" />
          </div>
        </div>
        {savedCharacterReferencesQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">불러오는 중…</div>
        ) : filteredSavedCharacterReferences.length > 0 ? (
          <div className="grid gap-2">
            {filteredSavedCharacterReferences.map((asset) => (
              <div key={asset.id} className="flex items-center justify-between gap-3 rounded-sm border border-border bg-surface-low px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-foreground">{asset.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{asset.type} · strength {asset.strength} · fidelity {asset.fidelity}</div>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={() => appendSavedCharacterReference(asset)}>
                  <Save className="h-4 w-4" />
                  추가
                </Button>
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
