import type { PostKnowledge } from '@conai/shared'
import { AlertTriangle, BookOpen, Check, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { useI18n } from '@/i18n'

/** One badge for a knowledge document: 지식, 지식 · 검증됨, 지식 · 재검토 필요, or 휴지통. */
export function PostKnowledgeStatus({ knowledge }: { knowledge?: PostKnowledge | null }) {
  const { t } = useI18n()
  if (!knowledge?.enabled) return null
  const verified = knowledge.reviewStatus === 'verified' && knowledge.verifiedContentVersion === knowledge.contentVersion
  if (knowledge.deletedAt) return <Badge variant="destructive" className="shrink-0 gap-1"><Trash2 className="size-3" />{t({ ko: '휴지통', en: 'Trash' })}</Badge>
  if (verified) return <Badge variant="success" className="shrink-0 gap-1"><Check className="size-3" />{t({ ko: '지식 · 검증됨', en: 'Knowledge · Verified' })}</Badge>
  if (knowledge.reviewStatus === 'needs_review') return <Badge variant="warning" className="shrink-0 gap-1"><AlertTriangle className="size-3" />{t({ ko: '지식 · 재검토 필요', en: 'Knowledge · Needs review' })}</Badge>
  return <Badge variant="ghost" className="shrink-0 gap-1"><BookOpen className="size-3" />{t({ ko: '지식', en: 'Knowledge' })}</Badge>
}
