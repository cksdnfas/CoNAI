import { useEffect, useId, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LoaderCircle, Save, Star, Trash2, X } from 'lucide-react'
import { Checkbox } from '@/components/ui/checkbox'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { Tip } from '@/components/ui/tooltip'
import {
  CHAT_ADMIN_PROFILES_QUERY_KEY,
  CHAT_PROFILES_QUERY_KEY,
  MODEL_SLOTS_QUERY_KEY,
  MODEL_USAGE_QUERY_KEY,
  createModelSlot,
  deleteModelSlot,
  listChatAdminProfiles,
  listChatConnectionModels,
  updateModelSlot,
  type ModelRole,
  type ModelSlot,
  type ModelSlotInput,
  type ModelUsage,
} from '@/lib/api-codex-chat'
import type { ExternalApiProviderRecord } from '@/lib/api-external-api'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'
import { ConnectionModelSelect, SwitchLine } from './chat-profile-editor-fields'
import { SettingsResourceTableRow } from './settings-resource-shared'

// Container-prefixed like the other settings tables; the table stacks below 4xl.
export const MODEL_SLOTS_TABLE_GRID = '@4xl:grid-cols-[minmax(160px,1fr)_minmax(140px,0.9fr)_minmax(160px,1.1fr)_minmax(140px,0.9fr)_64px_48px]'

export type ModelSlotModalState = { mode: 'create' } | { mode: 'edit'; slot: ModelSlot } | null

type UsageProfile = { id: number; name: string; roles: ModelRole[] }

const EMPTY_MODELS: string[] = []

/** Refreshes everything a slot change can alter: the slot list, usage counts, and both profile lists. */
export function useRefreshModelSlots() {
  const queryClient = useQueryClient()
  return () => Promise.all([
    queryClient.invalidateQueries({ queryKey: MODEL_SLOTS_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: MODEL_USAGE_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY }),
    queryClient.invalidateQueries({ queryKey: CHAT_PROFILES_QUERY_KEY }),
  ])
}

function useRoleLabels() {
  const { t } = useI18n()
  const labels: Record<ModelRole, string> = {
    chat: t({ ko: '대화', en: 'Chat' }),
    summary: t({ ko: '요약', en: 'Summary' }),
    translation: t({ ko: '번역', en: 'Translation' }),
    suggest: t({ ko: '답장 추천', en: 'Suggestions' }),
  }
  return labels
}

/** "세라 (대화, 요약) · 미나 (번역)" */
function describeProfiles(profiles: UsageProfile[], roleLabels: Record<ModelRole, string>, withRoles: boolean) {
  return profiles
    .map((profile) => (withRoles && profile.roles.length > 0 ? `${profile.name} (${profile.roles.map((role) => roleLabels[role]).join(', ')})` : profile.name))
    .join(' · ')
}

/** Connection table's 사용처 cell: models and directly-assigned profiles on this connection. */
export function ConnectionUsageCell({ usage }: { usage?: ModelUsage['connections'][number] }) {
  const { t } = useI18n()
  const roleLabels = useRoleLabels()
  const slots = usage?.slots ?? []
  const profiles = usage?.directProfiles ?? []
  if (slots.length === 0 && profiles.length === 0) {
    return <div className="text-xs text-muted-foreground">{t({ ko: '없음', en: 'None' })}</div>
  }

  const label = [
    slots.length > 0 ? t({ ko: '모델 {count}', en: 'Models {count}' }, { count: slots.length }) : null,
    profiles.length > 0 ? t({ ko: '직접 {count}', en: 'Direct {count}' }, { count: profiles.length }) : null,
  ].filter(Boolean).join(' · ')
  const tip = [
    slots.length > 0 ? `${t({ ko: '모델', en: 'Models' })}: ${slots.map((slot) => slot.name).join(', ')}` : null,
    profiles.length > 0 ? `${t({ ko: '직접', en: 'Direct' })}: ${describeProfiles(profiles, roleLabels, true)}` : null,
  ].filter(Boolean).join('\n')

  return (
    <Tip content={<span className="whitespace-pre-line">{tip}</span>}>
      <div className="min-w-0 truncate text-xs text-foreground">{label}</div>
    </Tip>
  )
}

function SlotUsageCell({ slot, workflowNodes }: { slot: ModelSlot; workflowNodes: number }) {
  const { t } = useI18n()
  const roleLabels = useRoleLabels()
  if (slot.profiles.length === 0 && workflowNodes === 0) {
    return <div className="text-xs text-muted-foreground">{t({ ko: '없음', en: 'None' })}</div>
  }

  const label = [
    t({ ko: '프로필 {count}', en: 'Profiles {count}' }, { count: slot.profiles.length }),
    workflowNodes > 0 ? t({ ko: '워크플로 {count}', en: 'Workflows {count}' }, { count: workflowNodes }) : null,
  ].filter(Boolean).join(' · ')

  return (
    <Tip content={slot.profiles.length > 0 ? describeProfiles(slot.profiles, roleLabels, true) : null}>
      <div className="min-w-0 truncate text-xs text-foreground">{label}</div>
    </Tip>
  )
}

export function ModelSlotListItem({
  slot,
  providers,
  workflowNodes,
  selected = false,
  settingDefault = false,
  onSetDefault,
  onOpenOptions,
}: {
  slot: ModelSlot
  providers: ExternalApiProviderRecord[]
  workflowNodes: number
  selected?: boolean
  settingDefault?: boolean
  onSetDefault: (slot: ModelSlot) => void
  onOpenOptions: (slot: ModelSlot) => void
}) {
  const { t } = useI18n()
  const providerLabel = providers.find((provider) => provider.provider_name === slot.providerName)?.display_name || slot.providerName

  return (
    <SettingsResourceTableRow
      gridClassName={MODEL_SLOTS_TABLE_GRID}
      selected={selected}
      labelledFrom={3}
      onOpenOptions={() => onOpenOptions(slot)}
      cells={[
        <div className="flex min-w-0 items-center gap-1.5 font-medium text-foreground" title={slot.name}>
          {slot.isDefault ? <Star className="h-3.5 w-3.5 shrink-0 fill-primary text-primary" /> : null}
          <span className="truncate">{slot.name}</span>
        </div>,
        <div className="min-w-0 truncate text-sm text-foreground" title={providerLabel}>{providerLabel}</div>,
        <div className="min-w-0 truncate font-mono text-xs text-muted-foreground" title={slot.model}>{slot.model}</div>,
        <SlotUsageCell slot={slot} workflowNodes={workflowNodes} />,
        <IconButton
          size="icon-sm"
          variant="ghost"
          disabled={slot.isDefault || settingDefault}
          onClick={() => onSetDefault(slot)}
          label={slot.isDefault ? t({ ko: '기본 모델', en: 'Default model' }) : t({ ko: '기본으로', en: 'Make default' })}
        >
          <Star className={cn('h-4 w-4', slot.isDefault && 'fill-primary text-primary')} />
        </IconButton>,
      ]}
    />
  )
}

type SlotDraft = { name: string; providerName: string; model: string; isDefault: boolean; adopt: boolean }

function buildDraft(state: ModelSlotModalState, fallbackProvider: string): SlotDraft {
  if (state?.mode === 'edit') {
    const { slot } = state
    return { name: slot.name, providerName: slot.providerName, model: slot.model, isDefault: slot.isDefault, adopt: false }
  }
  return { name: '', providerName: fallbackProvider, model: '', isDefault: false, adopt: true }
}

export function ModelSlotEditorModal({
  state,
  providers,
  onClose,
}: {
  state: ModelSlotModalState
  providers: ExternalApiProviderRecord[]
  onClose: () => void
}) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const confirm = useConfirm()
  const refresh = useRefreshModelSlots()
  const adoptId = useId()
  const isOpen = state !== null
  const slot = state?.mode === 'edit' ? state.slot : null
  const firstProvider = providers[0]?.provider_name ?? ''
  const [draft, setDraft] = useState<SlotDraft>(() => buildDraft(state, firstProvider))
  const patch = (next: Partial<SlotDraft>) => setDraft((current) => ({ ...current, ...next }))

  useEffect(() => {
    if (!isOpen) return
    setDraft(buildDraft(state, firstProvider))
    // Reset only when the modal opens on a (different) slot; provider list refetches must not wipe the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, slot?.id])

  // A new slot starts on the first connection once the list has loaded.
  useEffect(() => {
    if (isOpen && !slot && !draft.providerName && firstProvider) patch({ providerName: firstProvider })
  }, [isOpen, slot, draft.providerName, firstProvider])

  const modelsQuery = useQuery({
    queryKey: ['codex-chat-connection-models', draft.providerName],
    queryFn: () => listChatConnectionModels(draft.providerName),
    enabled: isOpen && Boolean(draft.providerName),
    retry: false,
    staleTime: 60_000,
  })
  const models = modelsQuery.data?.models ?? EMPTY_MODELS
  const defaultModel = modelsQuery.data?.defaultModel ?? null

  // A model left empty takes the connection's default (or first listed) model.
  useEffect(() => {
    if (!isOpen || draft.model || !modelsQuery.data) return
    const first = modelsQuery.data.defaultModel || modelsQuery.data.models[0]
    if (first) patch({ model: first })
  }, [isOpen, draft.model, modelsQuery.data])

  const profilesQuery = useQuery({ queryKey: CHAT_ADMIN_PROFILES_QUERY_KEY, queryFn: listChatAdminProfiles, enabled: isOpen })

  // Same rule as the backend's adoption: a role's direct connection + model equals this one and it has no slot yet.
  const matchedNames = useMemo(() => {
    if (!draft.providerName || !draft.model) return []
    const names: string[] = []
    for (const profile of profilesQuery.data ?? []) {
      const pairs: Array<[string | null, string, number | null]> = [
        ...(profile.engine === 'llm' ? [[profile.providerName, profile.model, profile.modelSlotId] as [string | null, string, number | null]] : []),
        [profile.summaryProviderName, profile.summaryModel, profile.summarySlotId],
        [profile.translationProviderName, profile.translationModel, profile.translationSlotId],
        [profile.suggestProviderName, profile.suggestModel, profile.suggestSlotId],
      ]
      if (pairs.some(([provider, model, slotId]) => slotId === null && provider === draft.providerName && model === draft.model)) {
        names.push(profile.name)
      }
    }
    return names
  }, [draft.providerName, draft.model, profilesQuery.data])

  const saveMutation = useMutation({
    mutationFn: async () => {
      const input: ModelSlotInput = {
        name: draft.name.trim(),
        providerName: draft.providerName,
        model: draft.model.trim(),
        isDefault: draft.isDefault,
        adoptProfiles: draft.adopt && matchedNames.length > 0,
      }
      return slot ? await updateModelSlot(slot.id, input) : await createModelSlot(input)
    },
    onSuccess: async (result) => {
      const adopted = Object.values(result.adopted).reduce((sum, count) => sum + count, 0)
      showSnackbar({
        message: adopted > 0
          ? t({ ko: '저장했어. 프로필 {count}개를 묶었어.', en: 'Saved. Linked {count} profiles.' }, { count: adopted })
          : t({ ko: '저장했어.', en: 'Saved.' }),
        tone: 'info',
      })
      await refresh()
      onClose()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '저장하지 못했어.', en: 'Could not save.' }), tone: 'error' })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (slot) await deleteModelSlot(slot.id)
    },
    onSuccess: async () => {
      showSnackbar({ message: t({ ko: '지웠어.', en: 'Deleted.' }), tone: 'info' })
      await refresh()
      onClose()
    },
    onError: (error) => {
      showSnackbar({ message: error instanceof Error ? error.message : t({ ko: '지우지 못했어.', en: 'Could not delete.' }), tone: 'error' })
    },
  })

  const busy = saveMutation.isPending || deleteMutation.isPending
  const canSave = draft.name.trim().length > 0 && draft.providerName.length > 0 && draft.model.trim().length > 0
  const providerMissing = draft.providerName && !providers.some((provider) => provider.provider_name === draft.providerName)

  return (
    <Modal
      open={isOpen}
      onClose={onClose}
      title={slot ? t({ ko: '모델 수정', en: 'Edit model' }) : t({ ko: '모델 추가', en: 'Add model' })}
      widthClassName="max-w-xl"
    >
      <ModalBody>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label={t({ ko: '이름', en: 'Name' })}
            info={t({ ko: '프로필이 이 이름으로 모델을 골라. 모델을 바꾸면 쓰는 프로필 전부에 적용돼.', en: 'Profiles pick the model by this name. Changing the model applies to every profile using it.' })}
            className="md:col-span-2"
          >
            <Input variant="settings" value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
          </Field>

          <Field label={t({ ko: '연결', en: 'Connection' })}>
            <Select variant="settings" value={draft.providerName} onChange={(event) => patch({ providerName: event.target.value, model: '' })}>
              {providerMissing ? <option value={draft.providerName}>{draft.providerName}</option> : null}
              {providers.map((provider) => <option key={provider.provider_name} value={provider.provider_name}>{provider.display_name}</option>)}
            </Select>
          </Field>

          <Field label={t({ ko: '모델', en: 'Model' })}>
            <ConnectionModelSelect value={draft.model} models={models} defaultModel={defaultModel} onChange={(model) => patch({ model })} />
          </Field>

          <div className="md:col-span-2">
            <SwitchLine
              label={t({ ko: '기본 모델', en: 'Default model' })}
              checked={draft.isDefault}
              onCheckedChange={(isDefault) => patch({ isDefault: slot?.isDefault ? true : isDefault })}
            />
          </div>

          {matchedNames.length > 0 ? (
            <div className="space-y-2 border-t border-line pt-3 md:col-span-2">
              <div className="flex items-center gap-2 text-sm">
                <Checkbox id={adoptId} checked={draft.adopt} onCheckedChange={(checked) => patch({ adopt: checked === true })} />
                <label htmlFor={adoptId} className="cursor-pointer">
                  {t({ ko: '이 연결·모델을 직접 지정한 프로필 {count}개를 여기로 묶기', en: 'Link {count} profiles that set this connection and model directly' }, { count: matchedNames.length })}
                </label>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {matchedNames.map((name) => (
                  <span key={name} className="rounded-sm bg-fill px-1.5 py-0.5 text-xs text-muted-foreground">{name}</span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </ModalBody>

      <ModalFooter>
        {slot ? (
          <IconButton
            size="icon-sm"
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              const confirmed = await confirm({
                title: t({ ko: '모델 삭제', en: 'Delete model' }),
                description: t({ ko: '이 모델을 지울까? 쓰던 프로필은 직접 지정한 연결로 돌아가.', en: 'Delete this model? Profiles using it go back to their own connection.' }),
                confirmLabel: t({ ko: '삭제', en: 'Delete' }),
                tone: 'destructive',
              })
              if (confirmed) deleteMutation.mutate()
            }}
            label={t({ ko: '모델 삭제', en: 'Delete model' })}
          >
            {deleteMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
          </IconButton>
        ) : null}
        <IconButton size="icon-sm" variant="secondary" onClick={onClose} disabled={busy} label={t({ ko: '취소', en: 'Cancel' })}>
          <X className="h-4 w-4" />
        </IconButton>
        <IconButton size="icon-sm" onClick={() => saveMutation.mutate()} disabled={!canSave || busy} label={t({ ko: '저장', en: 'Save' })}>
          {saveMutation.isPending ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        </IconButton>
      </ModalFooter>
    </Modal>
  )
}
