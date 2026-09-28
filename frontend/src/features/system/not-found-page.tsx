import { ArrowLeft, Compass, Home } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/button'
import { IconButton } from '@/components/ui/icon-button'
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
      actions={(
        <>
          <Button asChild>
            <Link to="/">
              <Home className="h-4 w-4" />
              {t('notFoundPage.goToHome')}
            </Link>
          </Button>
          {canGoBack ? (
            <IconButton variant="ghost" onClick={() => navigate(-1)} label={t({ ko: '뒤로 가기', en: 'Go back' })}>
              <ArrowLeft />
            </IconButton>
          ) : null}
        </>
      )}
    />
  )
}
