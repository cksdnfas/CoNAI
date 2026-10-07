import { EmptyState } from '@/components/ui/empty-state'
import { useI18n } from '@/i18n'

export function FeaturePermissionNotice({ permission }: { permission: string }) {
  const { t } = useI18n()
  return <EmptyState title={t({ ko: '기능 권한이 필요해', en: 'Feature permission required' })} description={t({ ko: '관리자에게 {permission} 권한을 요청해.', en: 'Ask an administrator for {permission}.' }, { permission })} />
}
