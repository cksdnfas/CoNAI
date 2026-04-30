import { Link } from 'react-router-dom'
import { PageHeader } from '@/components/common/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useI18n } from '@/i18n'

export function NotFoundPage() {
  const { t } = useI18n()

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-3xl items-center justify-center px-6 py-10">
      <div className="w-full space-y-6">
        <PageHeader
          eyebrow="System"
          title={t('notFoundPage.pageNotFound')}
        />

        <Card className="w-full">
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">{t({ ko: '홈으로 돌아가.', en: 'Return to Home.' })}</div>
            <Button asChild>
              <Link to="/">{t('notFoundPage.goToHome')}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
