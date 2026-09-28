import { ArrowLeft, Home } from 'lucide-react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'

export function NotFoundPage() {
  const { t } = useI18n()
  const navigate = useNavigate()
  const location = useLocation()
  // 'default' means this is the first entry of the session, so there is nothing in-app to go back to.
  const canGoBack = location.key !== 'default'

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow="404"
          title={t('notFoundPage.pageNotFound')}
        />

        <Card className="w-full">
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">
              {t({ ko: '주소가 잘못됐거나 페이지가 옮겨졌을 수 있어.', en: 'The address may be wrong, or the page may have moved.' })}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canGoBack ? (
                <Button type="button" variant="secondary" onClick={() => navigate(-1)}>
                  <ArrowLeft className="h-4 w-4" />
                  {t({ ko: '뒤로 가기', en: 'Go back' })}
                </Button>
              ) : null}
              <Button asChild>
                <Link to="/">
                  <Home className="h-4 w-4" />
                  {t('notFoundPage.goToHome')}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
