import type { PostKnowledge } from '@conai/shared'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'

export function PostKnowledgeStatus({ knowledge, showVersion = false }: { knowledge?: PostKnowledge | null; showVersion?: boolean }) {
  const { t } = useI18n()
  if (!knowledge?.enabled) return null
  const verified = knowledge.reviewStatus === 'verified' && knowledge.verifiedContentVersion === knowledge.contentVersion
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <Badge variant="ghost">{t({ ko: '지식', en: 'Knowledge' })}</Badge>
      <Badge variant={knowledge.deletedAt ? 'destructive' : verified ? 'success' : knowledge.reviewStatus === 'needs_review' ? 'warning' : 'secondary'}>
        {knowledge.deletedAt ? t({ ko: '휴지통', en: 'Trash' }) : verified ? t({ ko: '검증됨', en: 'Verified' }) : knowledge.reviewStatus === 'needs_review' ? t({ ko: '재검토 필요', en: 'Needs review' }) : t({ ko: '미검토', en: 'Unreviewed' })}
      </Badge>
      {showVersion ? <span className="text-xs text-muted-foreground">{t({ ko: '내용 {version}판', en: 'Content version {version}' }, { version: knowledge.contentVersion })}</span> : null}
    </span>
  )
}
