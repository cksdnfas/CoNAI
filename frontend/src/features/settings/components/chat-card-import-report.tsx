import { Button } from '@/components/ui/button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { useI18n } from '@/i18n'
import type { ChatCardImportReport } from '@/lib/api-codex-chat'

/** What a character card import kept, kept in another form, and left out; closing it opens the draft. */
export function ChatCardImportReportModal({ report, onClose }: { report: ChatCardImportReport | null; onClose: () => void }) {
  const { t } = useI18n()
  const groups = report ? [
    { label: t({ ko: '그대로 가져옴', en: 'Kept' }), items: report.kept },
    { label: t({ ko: '바꿔서 가져옴', en: 'Converted' }), items: report.converted },
    { label: t({ ko: '빠짐', en: 'Left out' }), items: report.dropped },
  ].filter((group) => group.items.length > 0) : []
  return (
    <Modal open={report !== null} onClose={onClose} title={t({ ko: '카드 가져오기 결과', en: 'Card import' })} widthClassName="max-w-lg">
      <ModalBody className="space-y-4">
        {groups.map((group) => (
          <section key={group.label} className="space-y-1.5">
            <h3 className="text-sm font-semibold">{group.label}</h3>
            <ul className="space-y-1 text-sm text-muted-foreground">
              {group.items.map((item) => <li key={item}>{item}</li>)}
            </ul>
          </section>
        ))}
      </ModalBody>
      <ModalFooter>
        <Button size="sm" onClick={onClose}>{t({ ko: '확인', en: 'OK' })}</Button>
      </ModalFooter>
    </Modal>
  )
}
