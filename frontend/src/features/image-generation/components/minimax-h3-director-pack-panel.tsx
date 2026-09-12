import { useRef, useState } from 'react'
import { Download, FolderOpen, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { useI18n } from '@/i18n'
import { triggerBlobDownload } from '@/lib/api-client'
import { buildWorkflowInputAssetUrl, deleteWorkflowInputAsset, uploadWorkflowInputAsset, type WorkflowInputAssetRef } from '@/lib/api-workflow-input-assets'
import { getMiniMaxH3DirectorAssets, inferMiniMaxH3DirectorMediaType, parseMiniMaxH3DirectorTimeline } from './minimax-h3-director-dasiwa-utils'
import { applyMiniMaxDirectorPack, buildMiniMaxDirectorPack, parseMiniMaxDirectorPack, type MiniMaxDirectorPack, type MiniMaxDirectorPackScope } from './minimax-h3-director-pack'

/** Match native ComfyUI references to user-selected files without interpreting paths as URLs. */
function mediaFileName(value: string) {
  return value.replace(/\s*\[(input|output|temp)\]$/, '').replaceAll('\\', '/').split('/').pop() ?? value
}

/** Save/load native reference packs, resolving missing files before the editor changes. */
export function MiniMaxH3DirectorPackPanel({ value, onChange, allowFiles, allowPrompt, allowMode, disabled }: {
  value: Record<string, unknown>
  onChange: (value: Record<string, unknown>) => void
  allowFiles: boolean
  allowPrompt: boolean
  allowMode: boolean
  disabled: boolean
}) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<MiniMaxDirectorPackScope>(allowFiles && allowPrompt ? 'all' : allowFiles ? 'files' : 'prompt')
  const [append, setAppend] = useState(false)
  const [pack, setPack] = useState<MiniMaxDirectorPack | null>(null)
  const [media, setMedia] = useState<File[]>([])
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const packInput = useRef<HTMLInputElement>(null)
  const mediaInput = useRef<HTMLInputElement>(null)
  const effectiveScope = allowFiles && allowPrompt ? scope : allowFiles ? 'files' : 'prompt'

  const loadFile = async (file: File) => {
    setPack(null)
    setMedia([])
    try {
      if (file.size > 8 * 1024 * 1024) throw new Error(t({ ko: '참조 팩 JSON은 8MB 이하여야 합니다.', en: 'Reference-pack JSON must be at most 8 MB.' }))
      setPack(parseMiniMaxDirectorPack(await file.text()))
      setMessage('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Invalid reference pack') }
  }

  const save = () => {
    try {
      const result = buildMiniMaxDirectorPack(value, effectiveScope)
      triggerBlobDownload(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }), `minimax-h3-${effectiveScope}-pack.json`)
      setMessage(t({ ko: '참조 팩을 저장했습니다.', en: 'Reference pack saved.' }))
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save reference pack') }
  }

  const apply = async () => {
    if (!pack || busy) return
    setBusy(true)
    const uploaded: WorkflowInputAssetRef[] = []
    try {
      if (!allowMode && pack.model_mode !== value.mode) throw new Error(t({ ko: '현재 모드와 같은 참조 팩을 선택하세요.', en: 'Select a reference pack matching the current mode.' }))
      // Capacity and prompt validation happen before uploading or replacing any media.
      applyMiniMaxDirectorPack(value, pack, effectiveScope, append, new Map())
      const resolved = new Map<number, WorkflowInputAssetRef>()
      if (effectiveScope !== 'prompt' && pack.items) {
        const currentAssets = getMiniMaxH3DirectorAssets(value)
        const timeline = parseMiniMaxH3DirectorTimeline(value.timeline_data).timeline
        const missing: string[] = []
        const filesToUpload: Array<{ index: number; file: File }> = []
        for (const [index, item] of pack.items.entries()) {
          const candidates = media.filter((file) => file.name === mediaFileName(item.value))
          if (candidates.length > 1) throw new Error(t({ ko: '같은 이름의 파일을 하나만 선택하세요: {name}', en: 'Select only one file with this name: {name}' }, { name: mediaFileName(item.value) }))
          if (candidates[0]) {
            if (inferMiniMaxH3DirectorMediaType(candidates[0]) !== item.type) throw new Error(t({ ko: '파일 종류가 참조와 다릅니다: {name}', en: 'File type does not match the reference: {name}' }, { name: candidates[0].name }))
            filesToUpload.push({ index, file: candidates[0] })
            continue
          }
          const existing = timeline.items.find((current) => current.value === item.value && current.type === item.type && currentAssets[current.id])
          const asset = item.conai_asset ?? (existing ? currentAssets[existing.id] : undefined)
          if (asset && (await fetch(buildWorkflowInputAssetUrl(asset), { method: 'HEAD', credentials: 'include' })).ok) resolved.set(index, asset)
          else missing.push(mediaFileName(item.value))
        }
        if (missing.length) throw new Error(t({ ko: '미디어 파일을 연결하세요: {files}', en: 'Attach the missing media files: {files}' }, { files: missing.join(', ') }))
        for (const { index, file } of filesToUpload) {
          const asset = await uploadWorkflowInputAsset(file)
          uploaded.push(asset)
          resolved.set(index, asset)
        }
      }
      const result = applyMiniMaxDirectorPack(value, pack, effectiveScope, append, resolved)
      onChange(result)
      setPack(null)
      setMedia([])
      setMessage(t({ ko: '참조 팩을 적용했습니다.', en: 'Reference pack applied.' }))
    } catch (error) {
      const cleanup = await Promise.allSettled(uploaded.map((asset) => deleteWorkflowInputAsset(asset.id)))
      const cleanupFailed = cleanup.some((result) => result.status === 'rejected')
      setMessage(`${error instanceof Error ? error.message : 'Could not load reference pack'}${cleanupFailed ? t({ ko: ' · 임시 업로드 정리에 실패했습니다.', en: ' · Could not clean up temporary uploads.' }) : ''}`)
    } finally { setBusy(false) }
  }

  if (!allowFiles && !allowPrompt) return null
  return <>
    <Button type="button" size="icon-sm" variant="outline" disabled={disabled} onClick={() => setOpen(true)} aria-label={t({ ko: '참조 팩', en: 'Reference pack' })} title={t({ ko: '참조 팩', en: 'Reference pack' })}><FolderOpen className="h-4 w-4" /></Button>
    <SettingsModal open={open} title={t({ ko: '참조 팩', en: 'Reference pack' })} onClose={() => { if (!busy) setOpen(false) }} widthClassName="max-w-xl">
      <div className="space-y-4 p-4">
        <p className="text-xs text-muted-foreground">{t({ ko: 'DaSiWa JSON 형식입니다. 미디어 파일은 포함하지 않으며, 없는 파일은 적용 전에 연결해야 합니다.', en: 'DaSiWa JSON format. Media files are not embedded; attach any missing files before applying.' })}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Select aria-label={t({ ko: '데이터 범위', en: 'Data scope' })} value={effectiveScope} disabled={busy} onChange={(event) => setScope(event.target.value as MiniMaxDirectorPackScope)}>
            {allowFiles && allowPrompt ? <option value="all">{t({ ko: '전체', en: 'All' })}</option> : null}
            {allowFiles ? <option value="files">{t({ ko: '참조 파일', en: 'Reference files' })}</option> : null}
            {allowPrompt ? <option value="prompt">{t({ ko: '프롬프트', en: 'Prompt' })}</option> : null}
          </Select>
          <Button type="button" size="icon-sm" variant="outline" disabled={busy} onClick={save} aria-label={t({ ko: '팩 저장', en: 'Save pack' })} title={t({ ko: '팩 저장', en: 'Save pack' })}><Download className="h-4 w-4" /></Button>
          <Button type="button" size="icon-sm" variant="outline" disabled={busy} onClick={() => packInput.current?.click()} aria-label={t({ ko: '팩 불러오기', en: 'Load pack' })} title={t({ ko: '팩 불러오기', en: 'Load pack' })}><Upload className="h-4 w-4" /></Button>
          <input ref={packInput} type="file" accept="application/json,.json" hidden onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void loadFile(file) }} />
        </div>
        {pack ? <div className="space-y-3">
          <div className="text-sm font-medium">{pack.model_mode}</div>
          {effectiveScope !== 'prompt' && pack.items ? <>
            <ul className="max-h-48 overflow-y-auto text-xs text-muted-foreground">{pack.items.map((item, index) => <li key={index} className="break-all">{mediaFileName(item.value)}</li>)}</ul>
            <Button type="button" variant="outline" disabled={busy} onClick={() => mediaInput.current?.click()}>{t({ ko: '미디어 파일 연결', en: 'Attach media files' })}{media.length > 0 ? ` (${media.length})` : ''}</Button>
            <input ref={mediaInput} type="file" accept="image/*,video/*,audio/*" multiple hidden onChange={(event) => { setMedia(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          </> : null}
          <div className="flex items-center gap-2">
            <Select aria-label={t({ ko: '불러오기 방식', en: 'Import mode' })} disabled={busy} value={append ? 'append' : 'overwrite'} onChange={(event) => setAppend(event.target.value === 'append')}><option value="overwrite">{t({ ko: '덮어쓰기', en: 'Overwrite' })}</option><option value="append">{t({ ko: '추가', en: 'Append' })}</option></Select>
            <Button type="button" disabled={busy} onClick={() => void apply()}>{busy ? t({ ko: '적용 중…', en: 'Applying…' }) : t({ ko: '적용', en: 'Apply' })}</Button>
          </div>
        </div> : null}
        {message ? <div role="status" className="text-sm break-words">{message}</div> : null}
      </div>
    </SettingsModal>
  </>
}
