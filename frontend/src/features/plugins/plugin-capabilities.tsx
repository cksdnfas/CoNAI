import { useI18n } from '@/i18n'

/** Installation trusts the package; operations use the same account permissions as native app features. */
export function PluginRuntimeSummary({ server }: { server: boolean }) {
  const { t } = useI18n()
  return <p className="text-sm text-muted-foreground">{t(server
    ? { ko: '앱 기능으로 동작하며 현재 계정의 권한을 사용해. 서버 모듈은 이 서버에서 실행돼.', en: 'Runs as an app feature using the current account’s permissions. Its server module runs on this server.' }
    : { ko: '앱 기능으로 동작하며 현재 계정의 권한을 사용해.', en: 'Runs as an app feature using the current account’s permissions.' })}</p>
}
