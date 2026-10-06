import { useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { BookOpen, FileUp, ImagePlus, LayoutTemplate, Pencil, Plus, Wrench } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { RowGroup } from '@/components/ui/row-group'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import { useI18n } from '@/i18n'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_BLOCKS_QUERY_KEY,
  CHAT_GENERATION_PRESETS_QUERY_KEY,
  CHAT_LOREBOOKS_QUERY_KEY,
  CHAT_TOOL_PRESETS_QUERY_KEY,
  createChatBlock,
  createChatGenerationPreset,
  createChatToolPreset,
  importChatBlocks,
  importChatGenerationPresets,
  importChatLorebook,
  importChatToolPresets,
  listChatBlocks,
  listChatGenerationPresets,
  listChatLorebooks,
  listChatToolPresets,
  type ChatGenerationPreset,
  type ChatLorebook,
  type ChatSharedBlock,
  type ChatToolPreset,
} from '@/lib/api-codex-chat'
import { getErrorMessage } from '@/lib/error-message'
import { ChatBlockEditorModal } from './chat-block-editor-modal'
import { readChatBlockFile } from './chat-block-file'
import { ChatGenerationPresetEditorModal } from './chat-generation-preset-editor-modal'
import { readChatGenerationPresetFile } from './chat-generation-preset-file'
import { ChatLorebookEditorModal } from './chat-lorebook-editor-modal'
import { ChatToolPresetEditorModal } from './chat-tool-preset-editor-modal'
import { readChatToolPresetFile } from './chat-tool-preset-file'
import { SettingsEmptyRow, SettingsRowsSkeleton } from './settings-rows'

/** One resource row: icon, name (+ small extra), one meta, the profiles that use it, and only the edit button. */
function ResourceRow({ icon, name, extra, meta, profiles, onEdit }: {
  icon: ReactNode
  name: string
  extra?: ReactNode
  meta: string
  profiles: Array<{ id: number; name: string }>
  onEdit: () => void
}) {
  const { t } = useI18n()
  return (
    <div className="flex min-h-14 items-center gap-3 border-t border-line py-2.5 first:border-t-0">
      <span className="shrink-0 text-muted-foreground [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold">{name}</span>
          {extra}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {meta}
          {' · '}
          {profiles.length > 0 ? (
            <Tip content={profiles.map((profile) => profile.name).join(', ')}>
              <span>{t({ ko: '프로필 {count}', en: '{count} profiles' }, { count: profiles.length })}</span>
            </Tip>
          ) : t({ ko: '연결 없음', en: 'Not linked' })}
        </div>
      </div>
      <IconButton size="icon-sm" variant="ghost" onClick={onEdit} label={t({ ko: '편집', en: 'Edit' })}><Pencil /></IconButton>
    </div>
  )
}

/** Settings › Chat › 자원: tool presets, generation presets, display blocks and lorebooks shared by the chat profiles. */
export function ChatSettingsResources() {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const [lorebookEditor, setLorebookEditor] = useState<{ lorebook: ChatLorebook | null } | null>(null)
  const lorebookImportRef = useRef<HTMLInputElement>(null)
  /** Set while a file is picked to refresh that book; null picks a new book. */
  const lorebookTargetRef = useRef<number | null>(null)
  const [blockEditor, setBlockEditor] = useState<{ shared: ChatSharedBlock | null } | null>(null)
  const blockImportRef = useRef<HTMLInputElement>(null)
  const [presetEditor, setPresetEditor] = useState<{ preset: ChatToolPreset | null } | null>(null)
  const presetImportRef = useRef<HTMLInputElement>(null)
  const [generationEditor, setGenerationEditor] = useState<{ preset: ChatGenerationPreset | null } | null>(null)
  const generationImportRef = useRef<HTMLInputElement>(null)

  const lorebooksQuery = useQuery({ queryKey: CHAT_LOREBOOKS_QUERY_KEY, queryFn: listChatLorebooks })
  const blocksQuery = useQuery({ queryKey: CHAT_BLOCKS_QUERY_KEY, queryFn: listChatBlocks })
  const presetsQuery = useQuery({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY, queryFn: listChatToolPresets })
  const generationPresetsQuery = useQuery({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY, queryFn: listChatGenerationPresets })

  const onError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '저장하지 못했어.', en: 'Could not save.' })), tone: 'error' })
  const onDuplicateError = (error: unknown) => showSnackbar({ message: getErrorMessage(error, t({ ko: '복제하지 못했어.', en: 'Could not duplicate.' })), tone: 'error' })

  const lorebookImportMutation = useMutation({
    mutationFn: ({ file, lorebookId }: { file: File; lorebookId: number | null }) => importChatLorebook(file, lorebookId ?? undefined),
    onSuccess: async (lorebook, { lorebookId }) => {
      await queryClient.invalidateQueries({ queryKey: CHAT_LOREBOOKS_QUERY_KEY })
      // The editor open on the refreshed book reloads its entries from the new copy.
      if (lorebookId) setLorebookEditor((current) => (current?.lorebook?.id === lorebookId ? { lorebook } : current))
      showSnackbar({
        message: lorebookId
          ? t({ ko: '{name} 업데이트했어. 항목 {count}개.', en: 'Updated {name}: {count} entries.' }, { name: lorebook.name, count: lorebook.entries.length })
          : t({ ko: '{name} 가져왔어. 항목 {count}개.', en: 'Imported {name}: {count} entries.' }, { name: lorebook.name, count: lorebook.entries.length }),
        tone: 'info',
      })
    },
    onError,
  })
  const pickLorebookFile = (lorebookId: number | null) => {
    lorebookTargetRef.current = lorebookId
    lorebookImportRef.current?.click()
  }

  const refreshBlocks = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_BLOCKS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
  ])
  const blockImportMutation = useMutation({
    mutationFn: async (file: File) => importChatBlocks(await readChatBlockFile(file)),
    onSuccess: async (created) => {
      await refreshBlocks()
      showSnackbar({ message: t({ ko: '표시 블록 {count}개 가져왔어.', en: 'Imported {count} display blocks.' }, { count: created.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: error instanceof SyntaxError ? t({ ko: 'JSON 파일을 읽지 못했어.', en: 'Could not read the JSON file.' }) : getErrorMessage(error, t({ ko: '가져오지 못했어.', en: 'Could not import.' })), tone: 'error' }),
  })
  /** A copy next to the original, to change the key or the design without touching the profiles that use it. */
  const blockDuplicateMutation = useMutation({
    mutationFn: (shared: ChatSharedBlock) => createChatBlock({ name: t({ ko: '{name} 복사', en: '{name} copy' }, { name: shared.name }), block: shared.block }),
    onSuccess: async (created) => {
      await refreshBlocks()
      setBlockEditor({ shared: created })
    },
    onError: onDuplicateError,
  })

  const refreshPresets = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_TOOL_PRESETS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
  ])
  const presetImportMutation = useMutation({
    mutationFn: async (file: File) => importChatToolPresets(await readChatToolPresetFile(file)),
    onSuccess: async (created) => {
      await refreshPresets()
      showSnackbar({ message: t({ ko: '도구 프리셋 {count}개 가져왔어.', en: 'Imported {count} tool presets.' }, { count: created.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '도구 프리셋을 가져오지 못했어.', en: 'Could not import the tool presets.' })), tone: 'error' }),
  })
  const presetDuplicateMutation = useMutation({
    mutationFn: (preset: ChatToolPreset) => createChatToolPreset({ name: t({ ko: '{name} 복사', en: '{name} copy' }, { name: preset.name }), scopes: preset.scopes, toolAllowlist: preset.toolAllowlist }),
    onSuccess: async (created) => {
      await refreshPresets()
      setPresetEditor({ preset: created })
    },
    onError: onDuplicateError,
  })

  const refreshGenerationPresets = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: CHAT_GENERATION_PRESETS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
  ])
  const generationImportMutation = useMutation({
    mutationFn: async (file: File) => importChatGenerationPresets(await readChatGenerationPresetFile(file)),
    onSuccess: async (created) => {
      await refreshGenerationPresets()
      showSnackbar({ message: t({ ko: '생성 프리셋 {count}개 가져왔어.', en: 'Imported {count} generation presets.' }, { count: created.length }), tone: 'info' })
    },
    onError: (error) => showSnackbar({ message: getErrorMessage(error, t({ ko: '생성 프리셋을 가져오지 못했어.', en: 'Could not import the generation presets.' })), tone: 'error' }),
  })
  const generationDuplicateMutation = useMutation({
    mutationFn: (preset: ChatGenerationPreset) => createChatGenerationPreset({ name: t({ ko: '{name} 복사', en: '{name} copy' }, { name: preset.name }), instruction: preset.instruction, kind: preset.kind, nai: preset.nai, comfyui: preset.comfyui }),
    onSuccess: async (created) => {
      await refreshGenerationPresets()
      setGenerationEditor({ preset: created })
    },
    onError: onDuplicateError,
  })

  const lorebooks = lorebooksQuery.data ?? []
  const blocks = blocksQuery.data ?? []
  const presets = presetsQuery.data ?? []
  const generationPresets = generationPresetsQuery.data ?? []

  return (
    <div className="space-y-8">
      <RowGroup
        heading={t({ ko: '도구 프리셋', en: 'Tool presets' })}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={presetImportRef} type="file" accept=".json,application/json" className="hidden" aria-label={t({ ko: '도구 프리셋 파일', en: 'Tool preset file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) presetImportMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={presetImportMutation.isPending} onClick={() => presetImportRef.current?.click()} label={t({ ko: 'JSON에서 가져오기', en: 'Import from JSON' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setPresetEditor({ preset: null })} label={t({ ko: '도구 프리셋 추가', en: 'Add tool preset' })}><Plus /></IconButton>
          </div>
        )}
      >
        {presetsQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {presetsQuery.isSuccess && presets.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 도구 프리셋이 없어.', en: 'No tool presets yet.' })}</SettingsEmptyRow> : null}
        {presets.map((preset) => (
          <ResourceRow
            key={preset.id}
            icon={<Wrench />}
            name={preset.name}
            meta={preset.toolAllowlist === null ? t({ ko: '모든 도구', en: 'Every tool' }) : t({ ko: '도구 {count}', en: '{count} tools' }, { count: preset.toolAllowlist.length })}
            profiles={preset.profiles}
            onEdit={() => setPresetEditor({ preset })}
          />
        ))}
        {presetsQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(presetsQuery.error, t({ ko: '도구 프리셋을 불러오지 못했어.', en: 'Could not load tool presets.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '생성 프리셋', en: 'Generation presets' })}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={generationImportRef} type="file" accept=".json,application/json" className="hidden" aria-label={t({ ko: '생성 프리셋 파일', en: 'Generation preset file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) generationImportMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={generationImportMutation.isPending} onClick={() => generationImportRef.current?.click()} label={t({ ko: 'JSON에서 가져오기', en: 'Import from JSON' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setGenerationEditor({ preset: null })} label={t({ ko: '생성 프리셋 추가', en: 'Add generation preset' })}><Plus /></IconButton>
          </div>
        )}
      >
        {generationPresetsQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {generationPresetsQuery.isSuccess && generationPresets.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 생성 프리셋이 없어. NAI나 ComfyUI 생성 패널에서 현재 설정을 저장해.', en: 'No generation presets yet. Save the current setup from the NAI or ComfyUI panel.' })}</SettingsEmptyRow> : null}
        {generationPresets.map((preset) => (
          <ResourceRow
            key={preset.id}
            icon={<ImagePlus />}
            name={preset.name}
            extra={<span className="shrink-0 rounded-sm bg-fill px-1.5 text-2xs font-semibold text-muted-foreground">{preset.kind === 'nai' ? 'NAI' : 'Comfy'}</span>}
            meta={preset.kind === 'nai' ? (preset.nai?.model ?? '') : t({ ko: '워크플로 {id}', en: 'Workflow {id}' }, { id: preset.comfyui?.workflowId ?? 0 })}
            profiles={preset.profiles}
            onEdit={() => setGenerationEditor({ preset })}
          />
        ))}
        {generationPresetsQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(generationPresetsQuery.error, t({ ko: '생성 프리셋을 불러오지 못했어.', en: 'Could not load generation presets.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '표시 블록', en: 'Display blocks' })}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={blockImportRef} type="file" accept=".json,application/json" className="hidden" aria-label={t({ ko: '표시 블록 파일', en: 'Display block file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) blockImportMutation.mutate(file)
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={blockImportMutation.isPending} onClick={() => blockImportRef.current?.click()} label={t({ ko: 'JSON에서 가져오기', en: 'Import from JSON' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setBlockEditor({ shared: null })} label={t({ ko: '표시 블록 추가', en: 'Add display block' })}><Plus /></IconButton>
          </div>
        )}
      >
        {blocksQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {blocksQuery.isSuccess && blocks.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 표시 블록이 없어.', en: 'No display blocks yet.' })}</SettingsEmptyRow> : null}
        {blocks.map((shared) => (
          <ResourceRow
            key={shared.id}
            icon={<LayoutTemplate />}
            name={shared.name}
            extra={<span className="truncate font-mono text-xs text-muted-foreground">{shared.block.key}</span>}
            meta={t({ ko: '필드 {count}', en: '{count} fields' }, { count: shared.block.fields.length })}
            profiles={shared.profiles}
            onEdit={() => setBlockEditor({ shared })}
          />
        ))}
        {blocksQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(blocksQuery.error, t({ ko: '표시 블록을 불러오지 못했어.', en: 'Could not load display blocks.' }))}</p> : null}
      </RowGroup>

      <RowGroup
        heading={t({ ko: '로어북', en: 'Lorebooks' })}
        actions={(
          <div className="flex items-center gap-1">
            <input ref={lorebookImportRef} type="file" accept=".json,.lorebook,.png,application/json,image/png" className="hidden" aria-label={t({ ko: '로어북 파일', en: 'Lorebook file' })} onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) lorebookImportMutation.mutate({ file, lorebookId: lorebookTargetRef.current })
            }} />
            <IconButton size="icon-sm" variant="ghost" disabled={lorebookImportMutation.isPending} onClick={() => pickLorebookFile(null)} label={t({ ko: '로어북 가져오기', en: 'Import lorebook' })}><FileUp /></IconButton>
            <IconButton size="icon-sm" variant="ghost" onClick={() => setLorebookEditor({ lorebook: null })} label={t({ ko: '로어북 추가', en: 'Add lorebook' })}><Plus /></IconButton>
          </div>
        )}
      >
        {lorebooksQuery.isLoading ? <SettingsRowsSkeleton rows={1} /> : null}
        {lorebooksQuery.isSuccess && lorebooks.length === 0 ? <SettingsEmptyRow>{t({ ko: '아직 로어북이 없어.', en: 'No lorebooks yet.' })}</SettingsEmptyRow> : null}
        {lorebooks.map((lorebook) => (
          <ResourceRow
            key={lorebook.id}
            icon={<BookOpen />}
            name={lorebook.name}
            meta={t({ ko: '항목 {count}', en: '{count} entries' }, { count: lorebook.entries.length })}
            profiles={lorebook.profiles}
            onEdit={() => setLorebookEditor({ lorebook })}
          />
        ))}
        {lorebooksQuery.isError ? <p className="py-3 text-sm text-destructive">{getErrorMessage(lorebooksQuery.error, t({ ko: '로어북을 불러오지 못했어.', en: 'Could not load lorebooks.' }))}</p> : null}
      </RowGroup>

      <ChatLorebookEditorModal
        open={lorebookEditor !== null}
        lorebook={lorebookEditor?.lorebook ?? null}
        onClose={() => setLorebookEditor(null)}
        onUpdateFromFile={(lorebook) => pickLorebookFile(lorebook.id)}
        updating={lorebookImportMutation.isPending}
      />
      <ChatBlockEditorModal
        open={blockEditor !== null}
        shared={blockEditor?.shared ?? null}
        onClose={() => setBlockEditor(null)}
        onDuplicate={(shared) => blockDuplicateMutation.mutate(shared)}
        duplicating={blockDuplicateMutation.isPending}
      />
      <ChatToolPresetEditorModal
        open={presetEditor !== null}
        preset={presetEditor?.preset ?? null}
        onClose={() => setPresetEditor(null)}
        onDuplicate={(preset) => presetDuplicateMutation.mutate(preset)}
        duplicating={presetDuplicateMutation.isPending}
      />
      <ChatGenerationPresetEditorModal
        open={generationEditor !== null}
        preset={generationEditor?.preset ?? null}
        onClose={() => setGenerationEditor(null)}
        onDuplicate={(preset) => generationDuplicateMutation.mutate(preset)}
        duplicating={generationDuplicateMutation.isPending}
      />
    </div>
  )
}
