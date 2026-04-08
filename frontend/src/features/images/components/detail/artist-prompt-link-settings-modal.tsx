import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { DEFAULT_ARTIST_LINK_URL_TEMPLATE } from '@/types/settings'

interface ArtistPromptLinkSettingsModalProps {
  open: boolean
  initialTemplate: string
  isSaving?: boolean
  onClose: () => void
  onSave: (template: string) => void
}

export function ArtistPromptLinkSettingsModal({ open, initialTemplate, isSaving = false, onClose, onSave }: ArtistPromptLinkSettingsModalProps) {
  const [draft, setDraft] = useState(initialTemplate || DEFAULT_ARTIST_LINK_URL_TEMPLATE)

  useEffect(() => {
    if (!open) {
      return
    }

    setDraft(initialTemplate || DEFAULT_ARTIST_LINK_URL_TEMPLATE)
  }, [initialTemplate, open])

  return (
    <SettingsModal
      open={open}
      onClose={onClose}
      title="Artist prompt 링크 설정"
      description="{key} 자리에 배지 텍스트가 들어가. 프로토콜이 없으면 https://로 열어줄게."
      widthClassName="max-w-2xl"
    >
      <div className="space-y-4">
        <label className="block space-y-2 text-sm">
          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">URL template</span>
          <Input
            variant="detail"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={DEFAULT_ARTIST_LINK_URL_TEMPLATE}
          />
        </label>

        <div className="rounded-sm border border-border bg-surface-low px-3 py-2 text-xs text-muted-foreground">
          예시: {DEFAULT_ARTIST_LINK_URL_TEMPLATE}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button type="button" variant="outline" onClick={() => setDraft(DEFAULT_ARTIST_LINK_URL_TEMPLATE)}>
            <RotateCcw className="h-4 w-4" />
            기본값으로 되돌리기
          </Button>

          <div className="flex items-center gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              취소
            </Button>
            <Button type="button" onClick={() => onSave(draft.trim() || DEFAULT_ARTIST_LINK_URL_TEMPLATE)} disabled={isSaving}>
              저장
            </Button>
          </div>
        </div>
      </div>
    </SettingsModal>
  )
}
