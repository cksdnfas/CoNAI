import { useI18n } from '@/i18n'

export function ImagePermissionNotice() {
  const { t } = useI18n()
  return <p className="p-4 text-sm text-muted-foreground">{t({ ko: '이미지를 보려면 이미지 조회 권한이 필요해.', en: 'Image viewing permission is required to see images.' })}</p>
}
