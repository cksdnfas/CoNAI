import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PostKnowledgePermanentDeleteDependency, PostKnowledgePermanentDeletePreview, PostSummary } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, DataTd, DataTh, DataTr } from '@/components/ui/data-table'
import { ErrorState } from '@/components/ui/error-state'
import { LoadingState } from '@/components/ui/loading-state'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Section } from '@/components/ui/section'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { POSTS_QUERY_KEY, cancelPostBotRun, cancelPostEvaluation, listPostBotRuns, listPostEvaluations, permanentlyDeletePostKnowledge, previewPostKnowledgePermanentDelete } from '@/lib/api-posts'
import { getErrorMessage } from '@/lib/error-message'
import { usePostPermissions } from './use-post-permissions'

const countLabels: Record<keyof PostKnowledgePermanentDeletePreview['counts'], { ko: string; en: string }> = {
  comments: { ko: '댓글', en: 'Comments' }, versions: { ko: '지식 내용 판', en: 'Knowledge versions' }, revisions: { ko: '게시글 수정 이력', en: 'Post revisions' },
  assessmentEvents: { ko: '평가 원장', en: 'Feedback records' }, assessmentHeads: { ko: '현재 의견', en: 'Current feedback' }, moderations: { ko: '평가 변경 이력', en: 'Feedback changes' },
  reviewEvents: { ko: '검토 이력', en: 'Review records' }, sources: { ko: '출처', en: 'Sources' }, links: { ko: '문서 연결', en: 'Document links' }, aliases: { ko: '다른 이름', en: 'Aliases' },
  proposals: { ko: '문서 제안', en: 'Document proposals' }, uses: { ko: '참조 기록', en: 'Use records' }, evaluationRequests: { ko: '평가 요청', en: 'Evaluation requests' },
  botRuns: { ko: '댓글 봇 작업', en: 'Comment bot tasks' }, attachmentRefs: { ko: '첨부 참조', en: 'Attachment references' },
}
const dependencyLabels: Record<PostKnowledgePermanentDeleteDependency['kind'], { ko: string; en: string }> = {
  source: { ko: '출처 인용', en: 'Source citation' }, link: { ko: '문서 연결', en: 'Document link' }, replacement: { ko: '대체 문서', en: 'Replacement document' },
  proposal: { ko: '검토 대기 제안', en: 'Pending proposal' }, evaluation: { ko: '진행 중인 평가', en: 'Active evaluation' }, bot_run: { ko: '진행 중인 봇 작업', en: 'Active bot task' },
  shared_attachment: { ko: '다른 문서의 첨부 참조', en: 'Attachment references in other documents' },
}
const scopeLabels: Record<PostKnowledgePermanentDeleteDependency['scope'], { ko: string; en: string }> = {
  current: { ko: '현재 판', en: 'Current version' }, history: { ko: '이전 판', en: 'Earlier version' }, proposal: { ko: '제안', en: 'Proposal' }, runtime: { ko: '진행 중', en: 'In progress' },
}

/** A human-only trash action: approval is bound to the server preview and its revision. */
export function PostKnowledgePermanentDeleteDialog({ post, onClose, onDeleted }: { post: PostSummary; onClose: () => void; onDeleted?: () => void }) {
  const { t } = useI18n()
  const { showSnackbar } = useSnackbar()
  const queryClient = useQueryClient()
  const permissions = usePostPermissions()
  const [confirmedToken, setConfirmedToken] = useState<string | null>(null)
  const preview = useQuery({
    queryKey: [POSTS_QUERY_KEY, 'permanent-delete-preview', permissions.viewerKey, post.id, post.revision],
    queryFn: () => previewPostKnowledgePermanentDelete(post.id, post.revision),
    retry: false, gcTime: 0,
  })
  const hasActiveEvaluations = preview.data?.dependencies.some((dependency) => dependency.blocking && dependency.kind === 'evaluation') === true
  const hasActiveBots = preview.data?.dependencies.some((dependency) => dependency.blocking && dependency.kind === 'bot_run') === true
  const evaluations = useQuery({ queryKey: [POSTS_QUERY_KEY, 'evaluations', permissions.viewerKey, post.id], queryFn: () => listPostEvaluations(post.id), enabled: hasActiveEvaluations })
  const botRuns = useQuery({ queryKey: [POSTS_QUERY_KEY, 'bot-runs', permissions.viewerKey, post.id], queryFn: () => listPostBotRuns(post.id), enabled: hasActiveBots })
  const cancelEvaluation = useMutation({
    mutationFn: (requestId: string) => cancelPostEvaluation(post.id, requestId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '평가를 취소하지 못했어.', en: 'Could not cancel evaluation.' })) }),
  })
  const cancelBot = useMutation({
    mutationFn: (runId: number) => cancelPostBotRun(runId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }),
    onError: (error) => showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '봇 작업을 취소하지 못했어.', en: 'Could not cancel the bot task.' })) }),
  })
  const remove = useMutation({
    mutationFn: (data: PostKnowledgePermanentDeletePreview) => permanentlyDeletePostKnowledge(post.id, { expectedRevision: data.expectedRevision, previewToken: data.previewToken, confirm: true }),
    onSuccess: async () => { onDeleted?.(); await queryClient.invalidateQueries({ queryKey: [POSTS_QUERY_KEY] }); onClose(); showSnackbar({ message: t({ ko: '지식 문서를 영구 삭제했어. 파일은 보존했어.', en: 'The knowledge document was permanently deleted. Files were retained.' }) }) },
    onError: (error) => { setConfirmedToken(null); showSnackbar({ tone: 'error', message: getErrorMessage(error, t({ ko: '영구 삭제하지 못했어.', en: 'Could not permanently delete the document.' })) }); void preview.refetch() },
  })
  const data = preview.data
  const expired = data ? Date.parse(data.expiresAt) <= Date.now() : false
  const confirmed = data !== undefined && confirmedToken === data.previewToken
  const canDelete = Boolean(data && !data.blocked && !expired && confirmed && !preview.isFetching && !remove.isPending)
  return <Modal open onClose={() => { if (!remove.isPending) onClose() }} title={t({ ko: '지식 문서 영구 삭제', en: 'Permanently delete knowledge' })} size="normal" height="medium">
    <ModalBody>
      <p className="text-sm font-semibold">{post.title}</p>
      {data ? <p className="text-xs text-muted-foreground">{t({ ko: '문서 #{id} · 내용 {version}판', en: 'Document #{id} · content version {version}' }, { id: data.postId, version: data.contentVersion })}</p> : null}
      <p className="text-sm text-muted-foreground">{t({ ko: '아래 내용과 이력은 복원할 수 없게 삭제돼. 파일 보관함의 실제 파일은 남아.', en: 'The content and records below will be deleted permanently. Physical files in the file store will remain.' })}</p>
      {preview.isPending ? <LoadingState /> : preview.isError ? <ErrorState error={preview.error} onRetry={() => void preview.refetch()} /> : data ? <>
        <Section heading={t({ ko: '삭제되는 자료', en: 'Records to delete' })}>
          <DataTable head={<><DataTh scope="col">{t({ ko: '자료', en: 'Record' })}</DataTh><DataTh scope="col" numeric>{t({ ko: '개수', en: 'Count' })}</DataTh></>}>{Object.entries(data.counts).map(([key, count]) => <DataTr key={key}><DataTh scope="row" className="font-normal">{t(countLabels[key as keyof typeof countLabels])}</DataTh><DataTd numeric>{count}</DataTd></DataTr>)}</DataTable>
        </Section>
        <Section heading={t({ ko: '연결된 자료와 영향', en: 'Dependencies and impact' })}>
          {data.dependencies.length ? data.dependencies.map((dependency, index) => <div key={index} className="flex flex-wrap items-center gap-2 border-b border-line py-3 text-sm last:border-0">
            <Badge variant={dependency.blocking ? 'warning' : 'ghost'}>{dependency.blocking ? t({ ko: '삭제 차단', en: 'Deletion blocked' }) : t({ ko: '파일 보존', en: 'Files retained' })}</Badge>
            <span>{t(dependencyLabels[dependency.kind])} · {t(scopeLabels[dependency.scope])} · {dependency.count}</span>
            {dependency.title ? <span className="text-muted-foreground">{dependency.title}</span> : null}
          </div>) : <p className="text-sm text-muted-foreground">{t({ ko: '다른 문서의 의존관계나 진행 중인 작업이 없어.', en: 'There are no dependencies from other documents or active tasks.' })}</p>}
          {data.blocked ? <p className="mt-3 text-sm text-muted-foreground">{t({ ko: '위 의존관계를 먼저 정리해야 영구 삭제할 수 있어.', en: 'Resolve the blocking dependencies before permanent deletion.' })}</p> : null}
          {hasActiveEvaluations ? <div className="mt-3">
            {evaluations.isPending ? <LoadingState /> : evaluations.isError ? <ErrorState size="compact" error={evaluations.error} onRetry={() => void evaluations.refetch()} /> : evaluations.data?.filter((item) => item.status === 'queued' || item.status === 'running').map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm last:border-0">
              <span className="flex-1">{t({ ko: '내용 {version}판 · {status}', en: 'Content version {version} · {status}' }, { version: item.contentVersion, status: item.status === 'queued' ? t({ ko: '평가 대기', en: 'Evaluation queued' }) : t({ ko: '평가 중', en: 'Evaluation running' }) })}</span>
              {item.canCancel ? <Button variant="ghost" size="sm" disabled={cancelEvaluation.isPending} onClick={() => cancelEvaluation.mutate(item.id)}>{t({ ko: '평가 취소', en: 'Cancel evaluation' })}</Button> : <span className="text-xs text-muted-foreground">{t({ ko: '취소 권한이 있는 계정에서 정리해줘.', en: 'An account with cancellation permission must resolve this.' })}</span>}
            </div>)}
          </div> : null}
          {hasActiveBots ? <div className="mt-3">
            {botRuns.isPending ? <LoadingState /> : botRuns.isError ? <ErrorState size="compact" error={botRuns.error} onRetry={() => void botRuns.refetch()} /> : botRuns.data?.filter((item) => item.status === 'queued' || item.status === 'running').map((item) => <div key={item.id} className="flex flex-wrap items-center gap-2 border-b border-line py-2 text-sm last:border-0">
              <span className="flex-1">{item.profileName} · {item.status === 'queued' ? t({ ko: '봇 작업 대기', en: 'Bot task queued' }) : t({ ko: '봇 작업 중', en: 'Bot task running' })}</span>
              {item.canCancel ? <Button variant="ghost" size="sm" disabled={cancelBot.isPending} onClick={() => cancelBot.mutate(item.id)}>{t({ ko: '봇 작업 취소', en: 'Cancel bot task' })}</Button> : <span className="text-xs text-muted-foreground">{t({ ko: '취소 권한이 있는 계정에서 정리해줘.', en: 'An account with cancellation permission must resolve this.' })}</span>}
            </div>)}
          </div> : null}
        </Section>
        {expired ? <p className="text-sm text-muted-foreground">{t({ ko: '미리보기가 만료됐어. 영향을 다시 확인해줘.', en: 'This preview expired. Review the impact again.' })} <Button variant="ghost" size="sm" onClick={() => void preview.refetch()}>{t({ ko: '다시 확인', en: 'Review again' })}</Button></p> : null}
        <label className="flex items-start gap-3 text-sm"><Checkbox aria-label={t({ ko: '삭제 영향과 복원 불가 확인', en: 'Confirm deletion impact and no restoration' })} checked={confirmed} disabled={data.blocked || expired || preview.isFetching || remove.isPending} onCheckedChange={(checked) => setConfirmedToken(checked === true ? data.previewToken : null)} /><span>{t({ ko: '삭제 영향과 파일 보존을 확인했어. 이 문서의 내용과 이력을 복원할 수 없다는 데 동의해.', en: 'I reviewed the deletion impact and file retention. I understand that this document and its records cannot be restored.' })}</span></label>
      </> : null}
    </ModalBody>
    <ModalFooter><Button variant="ghost" disabled={remove.isPending} onClick={onClose}>{t({ ko: '취소', en: 'Cancel' })}</Button><Button variant="destructive" disabled={!canDelete} onClick={() => { if (canDelete && data) remove.mutate(data) }}>{t({ ko: '영구 삭제', en: 'Delete permanently' })}</Button></ModalFooter>
  </Modal>
}
