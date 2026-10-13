import { Link } from 'react-router-dom'
import type { PostKnowledgeSource } from '@conai/shared'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { EmptyState } from '@/components/ui/empty-state'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useI18n } from '@/i18n'
import { postRoute } from './post-links'
import { PostQuote } from './post-quote'

export function knowledgeSource(kind: PostKnowledgeSource['kind'] = 'post'): PostKnowledgeSource {
  return { kind, postId: null, commentId: null, url: null, contentVersion: null, contentHash: null, revision: null, start: null, end: null, quote: '', observedAt: null }
}

export function KnowledgeSources({ sources }: { sources: PostKnowledgeSource[] }) {
  const { t } = useI18n()
  if (!sources.length) return <EmptyState size="compact" title={t({ ko: '연결한 출처가 없어', en: 'No sources linked' })} />
  return <div>{sources.map((source, index) => (
    <div key={index} className="space-y-1 border-b border-line py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {source.kind === 'url' ? <a href={source.url ?? undefined} target="_blank" rel="noreferrer noopener" className="break-all text-secondary-text hover:underline">{source.url}</a> : source.postId ? (
          <Link to={postRoute({ postId: source.postId, commentId: source.commentId })} className="text-secondary-text hover:underline">
            {source.kind === 'comment' ? t({ ko: '글 #{post}의 댓글 #{comment}', en: 'Comment #{comment} on post #{post}' }, { post: source.postId, comment: source.commentId ?? '' }) : t({ ko: '글 #{post}', en: 'Post #{post}' }, { post: source.postId })}
          </Link>
        ) : null}
        {source.contentVersion ? <span className="text-xs text-muted-foreground">{t({ ko: '내용 {version}판', en: 'Content version {version}' }, { version: source.contentVersion })}</span> : source.revision ? <span className="text-xs text-muted-foreground">r{source.revision}</span> : null}
        {source.start !== null && source.end !== null ? <span className="text-xs text-muted-foreground">{source.start}–{source.end}</span> : null}
      </div>
      {source.quote ? <PostQuote>{source.quote}</PostQuote> : null}
    </div>
  ))}</div>
}

/** Structured citations are saved with the document. The server validates IDs, access and quoted text. */
export function KnowledgeSourcesEditor({ sources, onChange }: { sources: PostKnowledgeSource[]; onChange: (sources: PostKnowledgeSource[]) => void }) {
  const { t } = useI18n()
  const patch = (index: number, value: Partial<PostKnowledgeSource>) => onChange(sources.map((source, position) => position === index ? { ...source, ...value } : source))
  return (
    <div>
      {sources.map((source, index) => (
        <div key={index} className="space-y-3 border-b border-line py-4 last:border-0">
          <div className="flex items-end gap-2">
            <Field label={t({ ko: '출처 종류', en: 'Source type' })} className="min-w-0 flex-1">
              <Select value={source.kind} onChange={(event) => patch(index, { kind: event.target.value as PostKnowledgeSource['kind'], contentVersion: null, contentHash: null, revision: null, start: null, end: null, quote: '' })}>
                <option value="post">{t({ ko: '게시글', en: 'Post' })}</option>
                <option value="comment">{t({ ko: '댓글', en: 'Comment' })}</option>
                <option value="url">{t({ ko: '외부 링크', en: 'External link' })}</option>
              </Select>
            </Field>
            <IconButton variant="ghost" size="icon-sm" label={t({ ko: '출처 빼기', en: 'Remove source' })} onClick={() => onChange(sources.filter((_item, position) => position !== index))}><X /></IconButton>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {source.kind === 'url' ? <Field label={t({ ko: '주소', en: 'URL' })} className="sm:col-span-2"><Input type="url" value={source.url ?? ''} onChange={(event) => patch(index, { url: event.target.value, postId: null, commentId: null })} placeholder="https://" /></Field> : (
              <>
                <Field label={t({ ko: '게시글 ID', en: 'Post ID' })}><Input inputMode="numeric" value={source.postId ?? ''} onChange={(event) => patch(index, { postId: Number(event.target.value) || null, url: null, contentVersion: null, contentHash: null, revision: null })} /></Field>
                {source.kind === 'comment' ? <Field label={t({ ko: '댓글 ID', en: 'Comment ID' })}><Input inputMode="numeric" value={source.commentId ?? ''} onChange={(event) => patch(index, { commentId: Number(event.target.value) || null, contentHash: null, revision: null })} /></Field> : null}
              </>
            )}
          </div>
          <Field label={t({ ko: '공개할 짧은 인용', en: 'Short public quotation' })}><Textarea rows={2} maxLength={2000} value={source.quote} onChange={(event) => patch(index, { quote: event.target.value })} /></Field>
        </div>
      ))}
      <Button variant="ghost" size="sm" onClick={() => onChange([...sources, knowledgeSource()])}><Plus />{t({ ko: '출처 추가', en: 'Add source' })}</Button>
    </div>
  )
}
