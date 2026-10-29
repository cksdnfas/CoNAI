import { useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { ExternalLink, RotateCcw } from 'lucide-react'
import { PAGE_SETTINGS_SCOPES, pageSettingsPatch, pageSettingRow, type PageSettingField, type PageSettingValue, type PageSettingsScopeId, type PageSettingsSnapshot } from '@conai/shared'
import { usePageSettings } from '@/components/common/page-settings-context'
import { Sheet } from '@/components/ui/sheet'
import { EditorFooter } from '@/components/ui/editor-footer'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
import { useConfirm } from '@/components/ui/confirm-dialog'
import { SettingRow } from '@/components/ui/setting-row'
import { SettingsSwitchRow } from '@/components/ui/settings-switch-row'
import { Select } from '@/components/ui/select'
import { NumberStepperInput } from '@/components/ui/number-stepper-input'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { useAuthStatusQuery } from '@/features/auth/use-auth-status-query'
import { useChatPageRegistration } from '@/features/codex-chat/chat-page-context'
import { pageAction, pageChoice, pageObject } from '@/features/codex-chat/page-action-helpers'
import { readPageSettings, savePageSettings } from '@/lib/api-page-settings'
import { useUnsavedSettingsGuard, type GuardedLeave } from './use-unsaved-settings-guard'
import { publishOwnPageSettingsSave } from './use-settings-revision'
import { parseSettingsTab } from './settings-tabs'
import { VideoOptimizationTab } from './components/video-optimization-tab'
import type { VideoOptimizationSettings } from '@conai/shared'
import { VIDEO_OPTIMIZATION_PRESETS } from './video-optimization-presets'

const affectedQueries: Record<PageSettingsScopeId, string[]> = {
  appearance: ['app-settings', 'global-appearance-settings', 'runtime-appearance-settings', 'runtime-appearance'],
  general: ['app-settings', 'image-viewer-settings'], similarity: ['app-settings', 'image-viewer-settings', 'similar-images'],
  metadata: ['app-settings'], 'image-save': ['app-settings', 'image-save-settings', 'runtime-image-save-settings'],
  thumbnail: ['app-settings'], 'video-optimization': ['app-settings', 'runtime-video-optimization-settings'],
  'generation-throttle': ['app-settings', 'runtime-generation-throttle-settings'],
  tagger: ['app-settings', 'tagger-status', 'tagger-models'], kaloscope: ['app-settings', 'kaloscope-status'],
  embedding: ['app-settings', 'embedding-status', 'image-viewer-settings'], posts: ['post-settings'], chat: ['codex-chat-admin-settings', 'codex-chat-status', 'codex-chat-thread', 'codex-chat-diagnostics'],
}

// A sheet belongs to one router location; the inline editor stays mounted only within its settings section.
const leavesSheet: GuardedLeave = (current, next) => current.key !== next.key
const leavesInlineSection: GuardedLeave = (current, next) => current.pathname !== next.pathname
  || parseSettingsTab(new URLSearchParams(current.search).get('section')) !== parseSettingsTab(new URLSearchParams(next.search).get('section'))

export default function PageSettingsDialog({ title }: { title: string }) {
  const { scopes, scope, open, close } = usePageSettings()
  return scope ? <SettingsEditor key={scope} scope={scope} scopes={scopes} title={title} onSelect={open} onClose={close} /> : null
}

export function PageSettingsSection({ scope }: { scope: PageSettingsScopeId }) {
  const { t } = useI18n()
  return <SettingsEditor scope={scope} scopes={[scope]} title={t(PAGE_SETTINGS_SCOPES[scope].label)} onSelect={() => {}} onClose={() => {}} inline />
}

function SettingsEditor({ scope, scopes, title, onSelect, onClose, inline = false }: { scope: PageSettingsScopeId; scopes: PageSettingsScopeId[]; title: string; onSelect: (scope: PageSettingsScopeId) => void; onClose: () => void; inline?: boolean }) {
  const { t } = useI18n()
  const confirm = useConfirm()
  const { showSnackbar } = useSnackbar()
  const client = useQueryClient()
  const admin = useAuthStatusQuery().data?.isAdmin === true
  const definition = PAGE_SETTINGS_SCOPES[scope]
  const query = useQuery({ queryKey: ['page-settings', scope], queryFn: ({ signal }) => readPageSettings(scope, signal), staleTime: 0, refetchOnWindowFocus: false })
  const [base, setBase] = useState<PageSettingsSnapshot | null>(null)
  const [patch, setPatch] = useState<Record<string, PageSettingValue>>({})
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const snapshot = base ?? query.data
  const values = { ...snapshot?.values, ...patch }
  const dirty = Object.keys(patch).length > 0
  const discardMessage = t({ ko: '저장하지 않은 설정 변경을 버릴까?', en: 'Discard unsaved settings changes?' })
  useUnsavedSettingsGuard(dirty || saving, discardMessage, inline ? leavesInlineSection : leavesSheet)
  const apply = (changes: Record<string, PageSettingValue>) => {
    if (savingRef.current || !snapshot) return
    if (scope === 'video-optimization' && changes.preset) {
      const preset = VIDEO_OPTIMIZATION_PRESETS.find((item) => item.value === changes.preset)
      if (preset) changes = { crf: preset.crf, audioBitrateKbps: preset.audioBitrateKbps, ...changes }
    }
    pageSettingsPatch(scope, changes)
    setBase(snapshot)
    setPatch((current) => {
      const next = { ...current, ...changes }
      for (const key of Object.keys(next)) if (next[key] === snapshot.values[key]) delete next[key]
      return next
    })
    setError(null)
  }
  const reload = async () => {
    if (savingRef.current || (dirty && !await confirm({ title: discardMessage }))) return
    try { const next = await readPageSettings(scope); client.setQueryData(['page-settings', scope], next); setBase(next); setPatch({}); setError(null) }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
  }
  const save = async () => {
    if (!snapshot || !dirty || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const next = await savePageSettings(scope, snapshot.revision, patch)
      publishOwnPageSettingsSave({ scope, before: snapshot.revision, after: next.revision })
      client.setQueryData(['page-settings', scope], next)
      setBase(next)
      setPatch({})
      await Promise.all(affectedQueries[scope].map((key) => client.invalidateQueries({ queryKey: [key] })))
      showSnackbar({ message: t({ ko: '설정을 저장했어.', en: 'Settings saved.' }) })
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); throw failure }
    finally { savingRef.current = false; setSaving(false) }
  }
  const select = async (next: PageSettingsScopeId) => {
    if (savingRef.current || next === scope || !scopes.includes(next)) return
    if (!dirty || await confirm({ title: discardMessage })) onSelect(next)
  }
  useChatPageRegistration(!inline && snapshot ? {
    kind: 'page_settings', title: `${title} · ${t(definition.label)}`, resourceId: scope, priority: 30, dirty,
    fields: definition.fields.map((field) => ({ id: field.id, label: t(pageSettingRow(scope, field).label), hint: t(pageSettingRow(scope, field).description) || undefined, type: field.options ? 'select' : field.type === 'string' ? 'text' : field.type, value: values[field.id], ...(field.options ? { options: field.options.map(String) } : {}), min: field.min, max: field.max, integer: field.integer })),
    data: { scope, revision: snapshot.revision, appliesTo: 'all users' },
    actions: [pageAction('page_settings.save', t({ ko: '설정 저장', en: 'Save settings' }), t({ ko: '현재 설정의 변경사항을 저장해. 모든 사용자에게 적용돼.', en: 'Save this settings draft for all users.' }), undefined, 'save'),
      pageAction('page_settings.select', t({ ko: '설정 항목 선택', en: 'Select settings section' }), '', pageObject({ scope: pageChoice(scopes) }, ['scope'])),
      pageAction('page_settings.close', t({ ko: '설정 닫기', en: 'Close settings' }), '')],
    apply: (changes) => apply(Object.fromEntries(Object.entries(changes).map(([key, value]) => [key, definition.fields.find((field) => field.id === key)?.type === 'number' ? Number(value) : value])) as Record<string, PageSettingValue>),
    applyAction: async (id, args, assertCurrent) => {
      assertCurrent()
      if (savingRef.current) throw new Error(t({ ko: '저장이 끝날 때까지 기다려줘.', en: 'Wait for the save to finish.' }))
      if (id === 'page_settings.save') await save()
      else if (id === 'page_settings.select') await select(args.scope as PageSettingsScopeId)
      else if (id === 'page_settings.close' && !dirty) onClose()
      else throw new Error(t({ ko: '먼저 변경사항을 저장하거나 버려줘.', en: 'Save or discard your changes first.' }))
    },
  } : null)
  const onSave = () => { void save().catch(() => {}) }
  const destination = pageSettingRow(scope, definition.fields[0])
  const body = <>
    {scope === 'embedding' || scope === 'tagger' || scope === 'kaloscope' ? <p className="my-3 text-sm text-muted-foreground">{t({ ko: '활성화하면 모델을 내려받거나 색인·분석 작업이 시작될 수 있어.', en: 'Enabling can download models or start indexing and analysis.' })}</p> : null}
    {snapshot ? scope === 'video-optimization'
      ? <VideoOptimizationTab videoOptimizationDraft={values as unknown as VideoOptimizationSettings} onPatchVideoOptimization={(changes) => apply(changes as Record<string, PageSettingValue>)} hasChanges={dirty} />
      : <div className="mt-4 divide-y divide-line">{definition.fields.map((field) => <SettingField key={field.id} scope={scope} field={field} value={values[field.id]} disabled={saving} onChange={(value) => apply({ [field.id]: value })} />)}</div>
      : query.isPending ? <p className="py-6">{t({ ko: '설정 불러오는 중…', en: 'Loading settings…' })}</p> : null}
    {error || query.error ? <p role="alert" className="mt-4 text-sm text-destructive">{error ?? query.error?.message}</p> : null}
  </>
  if (inline) return <div>{body}<div className="mt-4 flex justify-end gap-2"><Button variant="ghost" disabled={saving} onClick={() => void reload()}>{t({ ko: '최신 설정 불러오기', en: 'Reload settings' })}</Button><Button disabled={!dirty || saving || !snapshot} onClick={onSave}>{t({ ko: '저장', en: 'Save' })}</Button></div></div>
  return <Sheet open title={title} description={t({ ko: '공용 설정 · 저장하면 모든 사용자에게 적용돼.', en: 'Shared settings · changes apply to all users.' })} onClose={() => { if (!savingRef.current) onClose() }} dirty={dirty} onSave={dirty && !saving ? onSave : undefined} sidePanelInset="var(--chat-dock-width, 0px)">
    <div className="divide-y divide-line">
      {scopes.map((id) => <section key={id} className="py-2"><h2><Button variant="ghost" size="sm" onClick={() => void select(id)} aria-expanded={scope === id}>{t(PAGE_SETTINGS_SCOPES[id].label)}</Button></h2>
        {id === scope ? body : null}
      </section>)}
    </div>
    <EditorFooter onSave={onSave} canSave={dirty && Boolean(snapshot)} saving={saving}>
      <IconButton label={t({ ko: '최신 설정 불러오기', en: 'Reload settings' })} variant="ghost" disabled={saving} onClick={() => void reload()}><RotateCcw /></IconButton>
      {admin ? <Button asChild variant="ghost" size="sm"><Link to={`/settings?section=${destination.section}&group=${destination.group}`} onClick={(event) => { if (saving) event.preventDefault() }}>{t({ ko: '설정에서 모두 보기', en: 'View all in settings' })}<ExternalLink className="size-4" /></Link></Button> : null}
    </EditorFooter>
  </Sheet>
}

function SettingField({ scope, field, value, disabled, onChange }: { scope: PageSettingsScopeId; field: PageSettingField; value: PageSettingValue; disabled: boolean; onChange: (value: PageSettingValue) => void }) {
  const { t } = useI18n()
  const row = pageSettingRow(scope, field)
  const label = t(row.label)
  const info = t(row.description)
  const rowLabel = <span data-setting-id={row.id}>{label}</span>
  if (field.type === 'boolean') return <SettingsSwitchRow label={rowLabel} info={info} checked={value === true} disabled={disabled} onCheckedChange={onChange} />
  return <SettingRow label={rowLabel} info={info}>
    {field.options ? <Select variant="settings" aria-label={label} value={String(value)} disabled={disabled} onChange={(event) => onChange(field.type === 'number' ? Number(event.target.value) : event.target.value)}>{field.options.map((option) => <option key={option} value={option}>{OPTION_LABELS[String(option)] ? t(OPTION_LABELS[String(option)]) : option}</option>)}</Select>
      : <NumberStepperInput variant="settings" className="w-32" aria-label={label} value={value as number} disabled={disabled} min={field.min} max={field.max} precision={field.integer ? 0 : 2} step={field.integer ? 1 : 0.05} onValueCommit={(next) => { const parsed = Number(next); if (next.trim() && Number.isFinite(parsed)) onChange(parsed) }} />}
  </SettingRow>
}

const OPTION_LABELS: Record<string, { ko: string; en: string }> = {
  original: { ko: '원본 유지', en: 'Keep original' }, manual: { ko: '수동', en: 'Manual' }, always: { ko: '항상', en: 'Always' },
  fast: { ko: '빠르게', en: 'Fast' }, full: { ko: '전체 탐색', en: 'Full scan' }, skip: { ko: '생략', en: 'Skip' },
  similarity: { ko: '유사도', en: 'Similarity' }, upload_date: { ko: '업로드 날짜', en: 'Upload date' }, file_size: { ko: '파일 크기', en: 'File size' },
  ASC: { ko: '오름차순', en: 'Ascending' }, DESC: { ko: '내림차순', en: 'Descending' },
  even: { ko: '균등 분산', en: 'Even' }, random: { ko: '무작위 분산', en: 'Random' },
  continue_limited: { ko: '제한하며 계속', en: 'Continue with limits' }, hold_until_empty: { ko: '대기열이 빌 때까지 대기', en: 'Wait until queue is empty' },
  feed: { ko: '피드', en: 'Feed' }, cards: { ko: '카드', en: 'Cards' }, sns: { ko: 'SNS', en: 'SNS' },
  published: { ko: '게시', en: 'Published' }, draft: { ko: '초안', en: 'Draft' }, auto: { ko: '자동', en: 'Auto' },
  system: { ko: '시스템', en: 'System' }, dark: { ko: '어둡게', en: 'Dark' }, light: { ko: '밝게', en: 'Light' },
  custom: { ko: '사용자 지정', en: 'Custom' }, conai: { ko: 'CoNAI', en: 'CoNAI' }, ocean: { ko: '바다', en: 'Ocean' }, forest: { ko: '숲', en: 'Forest' },
  studio: { ko: '스튜디오', en: 'Studio' }, midnight: { ko: '미드나이트', en: 'Midnight' }, paper: { ko: '페이퍼', en: 'Paper' },
  'ultra-compact': { ko: '매우 조밀하게', en: 'Ultra compact' }, compact: { ko: '조밀하게', en: 'Compact' }, comfortable: { ko: '편안하게', en: 'Comfortable' }, spacious: { ko: '여유롭게', en: 'Spacious' },
  sharp: { ko: '각지게', en: 'Sharp' }, balanced: { ko: '균형', en: 'Balanced' }, soft: { ko: '부드럽게', en: 'Soft' },
  subtle: { ko: '은은하게', en: 'Subtle' }, immersive: { ko: '강하게', en: 'Immersive' }, dramatic: { ko: '선명하게', en: 'Dramatic' },
}
