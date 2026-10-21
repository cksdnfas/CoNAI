import type { GroupMoveResult } from '@conai/shared'
import { useI18n } from '@/i18n'

/** Feature-owned scroll region keeps all recursive conflicts readable without pushing confirmation off-screen. */
export function GroupMergeConfirmationDetails({ conflicts }: { conflicts: GroupMoveResult['conflicts'] }) {
  const { t } = useI18n()
  return <div className="max-h-[45dvh] overflow-y-auto space-y-3" tabIndex={0}>
    <p>{t({
      ko: '같은 이름의 하위 그룹도 합치고 다른 하위 그룹은 옮겨. 대상 ID와 설정을 유지하고 원본 설명·색상·자동수집·이모티콘 설정은 사라져. 원본 미디어는 수동 소속으로 보존해. 선택한 하위 그룹은 선택한 조상과 함께 한 번만 옮겨.',
      en: 'Same-name children merge; other children move. Destination IDs/settings stay; source description, color, auto-collect and emoticon settings are lost. Source media become manual memberships. Selected descendants travel once with selected ancestors.',
    })}</p>
    <ol className="divide-y divide-line">{conflicts.map(c => <li key={c.source_id} className="py-2 break-words">
      {c.source_path} (#{c.source_id}) → {c.destination_path} (#{c.destination_id})
    </li>)}</ol>
  </div>
}
