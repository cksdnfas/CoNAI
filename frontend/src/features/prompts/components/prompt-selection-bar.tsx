import { FolderInput, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface PromptSelectionBarProps {
  selectedCount: number
  isSubmitting?: boolean
  isDeleting?: boolean
  onAssignGroup: () => void
  onDeleteSelected?: () => void
  onClear: () => void
}

export function PromptSelectionBar({ selectedCount, isSubmitting = false, isDeleting = false, onAssignGroup, onDeleteSelected, onClear }: PromptSelectionBarProps) {
  if (selectedCount <= 0) {
    return null
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      <div className="theme-floating-panel pointer-events-auto flex items-center gap-3 rounded-full text-sm text-foreground">
        <div className="font-semibold">{selectedCount.toLocaleString('ko-KR')}개 선택됨</div>

        <Button size="sm" variant="secondary" onClick={onClear}>
          <X className="h-4 w-4" />
          선택 해제
        </Button>

        <Button size="sm" variant="secondary" onClick={onDeleteSelected} disabled={!onDeleteSelected || isDeleting}>
          <Trash2 className="h-4 w-4" />
          {isDeleting ? '삭제 중…' : '삭제'}
        </Button>

        <Button size="sm" onClick={onAssignGroup} disabled={isSubmitting}>
          <FolderInput className="h-4 w-4" />
          {isSubmitting ? '적용 중…' : '그룹 지정'}
        </Button>
      </div>
    </div>
  )
}
