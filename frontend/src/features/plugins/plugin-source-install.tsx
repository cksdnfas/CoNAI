import { useRef, useState } from 'react'
import type { PluginInstallResult, PluginSourceInput, PluginSourceProvider, PluginSourceReview } from '@conai/shared'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { ListRow } from '@/components/ui/list-row'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Select } from '@/components/ui/select'
import { Text } from '@/components/ui/text'
import { CHAT_DOCK_INSET } from '@/features/settings/components/use-settings-editor-chat-page'
import { useI18n } from '@/i18n'
import { installPluginSource, reviewPluginSource } from '@/lib/api-plugins'
import { getErrorMessage } from '@/lib/error-message'
import { PluginPackageReviewSummary } from './plugin-package-review-summary'

/** The buttons and page assistant share this review/apply state and the exact reviewed package. */
export function usePluginSourceInstall(onInstalled: (result: PluginInstallResult) => Promise<void>) {
  const { t } = useI18n()
  const [input, setInput] = useState<PluginSourceInput | null>(null)
  const [pluginId, setPluginId] = useState<string | undefined>()
  const [review, setReview] = useState<PluginSourceReview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const working = useRef(false)

  const assertIdle = () => {
    if (working.current) throw new Error(t({ ko: '진행 중인 작업이 끝나면 다시 요청해줘.', en: 'Wait for the current operation to finish.' }))
  }
  const run = async (operation: () => Promise<void>) => {
    assertIdle()
    working.current = true; setBusy(true); setError('')
    try { await operation() }
    catch (reason) {
      setError(getErrorMessage(reason, t({ ko: 'Git 플러그인 작업에 실패했어.', en: 'Git plugin operation failed.' })))
      throw reason
    } finally { working.current = false; setBusy(false) }
  }
  const open = (source: PluginSourceInput = { url: '' }, linkedPluginId?: string) => {
    assertIdle()
    setInput({ url: source.url, provider: source.provider, ref: source.ref, path: source.path })
    setPluginId(linkedPluginId); setReview(null); setError('')
  }
  const change = (patch: Partial<PluginSourceInput>) => {
    assertIdle()
    setInput(previous => previous ? { ...previous, ...patch } : previous)
    setReview(null); setError('')
  }
  const prepare = (source = input) => run(async () => {
    setReview(null)
    if (!source?.url.trim()) throw new Error(t({ ko: '저장소 주소를 입력해줘.', en: 'Enter a repository URL.' }))
    const result = await reviewPluginSource({
      url: source.url.trim(),
      ...(source.provider ? { provider: source.provider } : {}),
      ...(source.ref?.trim() ? { ref: source.ref.trim() } : {}),
      ...(source.path?.trim() ? { path: source.path.trim() } : {}),
    })
    setReview(result)
  })
  const openAndReview = async (source: PluginSourceInput, linkedPluginId?: string) => {
    open(source, linkedPluginId)
    await prepare(source)
  }
  const install = () => run(async () => {
    // Expiry is the server's call (410): its clock decides, not this browser's.
    if (!review) throw new Error(t({ ko: '먼저 패키지를 검토해줘.', en: 'Review the package first.' }))
    const result = await installPluginSource(review)
    await onInstalled(result)
    setInput(null); setReview(null)
  })
  const close = () => {
    if (working.current) return
    setInput(null); setReview(null); setError('')
  }
  return { input, pluginId, review, busy, error, open, openAndReview, change, prepare, install, close }
}

export function PluginSourceInstall({ state }: { state: ReturnType<typeof usePluginSourceInstall> }) {
  const { t } = useI18n()
  const { input, review, busy, error } = state
  return <Modal open={input !== null} onClose={state.close} title={t(state.pluginId ? { ko: 'Git 업데이트 검토', en: 'Review Git update' } : { ko: 'Git에서 설치', en: 'Install from Git' })} size="wide" sidePanelInset={CHAT_DOCK_INSET}>
    {input ? <>
      <ModalBody>
        <Field label={t({ ko: '저장소 주소', en: 'Repository URL' })}>
          <Input placeholder="https://github.com/owner/repo" value={input.url} disabled={busy} onChange={event => state.change({ url: event.target.value })} />
        </Field>
        <Field label={t({ ko: '호스트', en: 'Host' })}>
          <Select value={input.provider ?? ''} disabled={busy} onChange={event => state.change({ provider: event.target.value ? event.target.value as PluginSourceProvider : undefined })}>
            <option value="">{t({ ko: '자동 (github.com · gitlab.com · codeberg.org)', en: 'Auto (github.com · gitlab.com · codeberg.org)' })}</option>
            <option value="github">GitHub</option>
            <option value="gitlab">GitLab</option>
            <option value="gitea">Gitea · Forgejo</option>
          </Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t({ ko: '브랜치·태그', en: 'Branch / tag' })}>
            <Input placeholder={t({ ko: '비우면 기본 브랜치', en: 'Default branch when empty' })} value={input.ref ?? ''} disabled={busy} onChange={event => state.change({ ref: event.target.value })} />
          </Field>
          <Field label={t({ ko: '플러그인 폴더', en: 'Plugin folder' })}>
            <Input placeholder={t({ ko: '비우면 저장소 루트', en: 'Repository root when empty' })} value={input.path ?? ''} disabled={busy} onChange={event => state.change({ path: event.target.value })} />
          </Field>
        </div>
        {error ? <Text role="alert" tone="destructive">{error}</Text> : null}
        {review ? <PluginPackageReviewSummary review={review} metadata={<>
          <p className="pb-2 font-mono text-xs text-muted-foreground">{t({ ko: '커밋', en: 'Commit' })} · <span title={review.source.commit}>{review.source.commit.slice(0, 7)}</span></p>
          {review.previousSource ? <p className="pb-2 text-sm text-warning">{t({ ko: '기존 Git 연결을 바꿔.', en: 'This replaces the previous Git link.' })} <span className="break-all">{review.previousSource.url}@{review.previousSource.ref}{review.previousSource.path ? ` · ${review.previousSource.path}` : ''}</span></p> : null}
        </>}>
          {review.skipped.length ? <details className="pt-2">
            <summary className="cursor-pointer text-sm text-muted-foreground">{t({ ko: '제외한 파일 ({count})', en: 'Skipped files ({count})' }, { count: review.skipped.length })}</summary>
            <div className="max-h-36 overflow-y-auto">
              {review.skipped.slice(0, 50).map(name => <ListRow key={name} size="sm"><span className="break-all font-mono text-xs">{name}</span></ListRow>)}
            </div>
          </details> : null}
        </PluginPackageReviewSummary> : null}
        {review && state.pluginId && review.pluginId !== state.pluginId ? <Text role="status" tone="warning">{t({ ko: '저장소의 플러그인 ID가 {next}(으)로 바뀌었어. 적용하면 {current}을 업데이트하지 않고 새 플러그인으로 설치해.', en: 'The repository plugin ID is now {next}. Applying installs a new plugin instead of updating {current}.' }, { next: review.pluginId, current: state.pluginId })}</Text> : null}
      </ModalBody>
      <ModalFooter>
        <Button variant="ghost" disabled={busy} onClick={state.close}>{t({ ko: '닫기', en: 'Close' })}</Button>
        <span className="flex-1" />
        <Button variant="secondary" disabled={busy || !input.url.trim()} onClick={() => void state.prepare().catch(() => undefined)}>{t({ ko: '검토', en: 'Review' })}</Button>
        <Button disabled={busy || !review} onClick={() => void state.install().catch(() => undefined)}>{t({ ko: '검토한 패키지 적용', en: 'Apply reviewed package' })}</Button>
      </ModalFooter>
    </> : null}
  </Modal>
}
