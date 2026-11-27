import { EmptyState } from '@/components/ui/empty-state'
import { FieldInfo } from '@/components/ui/field'
import { useI18n } from '@/i18n'

/** Shown in place of a page's data when the account lacks the read right. */
export function FeaturePermissionNotice() {
  const { t } = useI18n()
  return (
    <EmptyState
      size="compact"
      title={(
        <span className="inline-flex items-center gap-1">
          {t({ ko: '읽기 권한이 필요해', en: 'Read permission required' })}
          <FieldInfo>{t({ ko: '관리자에게 읽기 권한을 요청해.', en: 'Ask an administrator for the read permission.' })}</FieldInfo>
        </span>
      )}
    />
  )
}
