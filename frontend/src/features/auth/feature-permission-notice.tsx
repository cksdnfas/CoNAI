import { EmptyState } from '@/components/ui/empty-state'
import { FieldInfo } from '@/components/ui/field'
import { useI18n } from '@/i18n'

export function FeaturePermissionNotice({ permission }: { permission: string }) {
  const { t } = useI18n()
  return (
    <EmptyState
      size="compact"
      title={(
        <span className="inline-flex items-center gap-1">
          {t({ ko: '기능 권한이 필요해', en: 'Feature permission required' })}
          <FieldInfo>{t({ ko: '관리자에게 {permission} 권한을 요청해.', en: 'Ask an administrator for {permission}.' }, { permission })}</FieldInfo>
        </span>
      )}
    />
  )
}
