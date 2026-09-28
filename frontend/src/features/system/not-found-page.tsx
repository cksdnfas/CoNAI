import { ArrowLeft, Compass, Home } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { useI18n } from '@/i18n'
import { SystemMessagePanel } from './system-message-panel'

export function NotFoundPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  // 'default' means this is the first entry of the session, so there is nothing in-app to go back to.
  const canGoBack = location.key !== 'default'

  return (
    <SystemMessagePanel
      icon={Compass}
      overline="404"
      title={t('notFoundPage.pageNotFound')}
      description={<p>{t({ ko: '주소가 잘못됐거나 페이지가 옮겨졌을 수 있어.', en: 'The address may be wrong, or the page may have moved.' })}</p>}
      actions={(
        <>
          <Button asChild>
            <Link to="/">
              <Home className="h-4 w-4" />
              {t('notFoundPage.goToHome')}
            </Link>
          </Button>
          {canGoBack ? (
            <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
              <ArrowLeft className="h-4 w-4" />
              {t({ ko: '뒤로 가기', en: 'Go back' })}
            </Button>
          ) : null}
        </>
      )}
    />
  )
}
