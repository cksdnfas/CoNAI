import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { cn } from '@/lib/utils'

/** Previous / next under a paged list, at its end. Nothing when the list fits one page. */
export function ListPager({ hasPrevious, hasNext, onPrevious, onNext, className }: { hasPrevious: boolean; hasNext: boolean; onPrevious: () => void; onNext: () => void; className?: string }) {
  const { t } = useI18n()
  if (!hasPrevious && !hasNext) return null
  return (
    <div className={cn('flex justify-end gap-2', className)}>
      <Button variant="ghost" size="sm" disabled={!hasPrevious} onClick={onPrevious}>{t({ ko: '이전', en: 'Previous' })}</Button>
      <Button variant="ghost" size="sm" disabled={!hasNext} onClick={onNext}>{t({ ko: '다음', en: 'Next' })}</Button>
    </div>
  )
}
