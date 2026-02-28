import React, { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ImageRecord } from '../../../../../types/image'
import type { SimilarImage } from '../../../../../services/similarityApi'
import { getMatchTypeLabel, getThumbnailUrl } from '../utils/similarityHelpers'
import ImageViewerModal from '../../../../../components/ImageViewerModal/ImageViewerModal'

interface SimilarityResultsDisplayProps {
  queryImage: ImageRecord
  testResults: SimilarImage[]
}

export const SimilarityResultsDisplay: React.FC<SimilarityResultsDisplayProps> = ({
  queryImage,
  testResults,
}) => {
  const { t } = useTranslation('settings')
  const [selectedImage, setSelectedImage] = useState<ImageRecord | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  return (
    <div className="space-y-3">
      <div>
        <h4 className="mb-1 text-sm font-semibold">{t('similarity.test.queryImage')}</h4>
        <Card className="mx-auto max-w-md">
          {getThumbnailUrl(queryImage) ? (
            <img
              src={getThumbnailUrl(queryImage) || ''}
              alt={queryImage.original_file_path ?? ''}
              className="max-h-[300px] w-full object-contain"
            />
          ) : (
            <div className="text-muted-foreground flex h-[300px] items-center justify-center text-sm">No thumbnail available</div>
          )}
          <CardContent className="space-y-1 pt-4 text-sm">
            <div><strong>{t('similarity.test.imageDetails.id')}</strong> {queryImage.composite_hash}</div>
            <div className="truncate"><strong>{t('similarity.test.imageDetails.filename')}</strong> {queryImage.original_file_path ?? ''}</div>
            <div><strong>{t('similarity.test.imageDetails.size')}</strong> {queryImage.width} x {queryImage.height}</div>
            {queryImage.ai_tool ? (
              <div><strong>{t('similarity.test.imageDetails.aiTool')}</strong> {queryImage.ai_tool}</div>
            ) : null}
          </CardContent>
        </Card>
      </div>

      {testResults.length > 0 ? (
        <div>
          <h4 className="mb-2 text-sm font-semibold">{t('similarity.test.results', { count: testResults.length })}</h4>
          <div className="grid gap-2 sm:grid-cols-3 md:grid-cols-4">
            {testResults.slice(0, 12).map((result, index) => (
              <Card
                key={`${result.image.composite_hash}-${result.image.file_id || index}`}
                className="cursor-pointer transition hover:-translate-y-0.5"
                onClick={() => {
                  setSelectedImage(result.image)
                  setSelectedIndex(index)
                }}
              >
                {getThumbnailUrl(result.image) ? (
                  <img
                    src={getThumbnailUrl(result.image) || ''}
                    alt={result.image.original_file_path ?? ''}
                    className="h-[150px] w-full object-cover"
                  />
                ) : (
                  <div className="text-muted-foreground flex h-[150px] items-center justify-center text-xs">No image</div>
                )}
                <CardContent className="space-y-1 pt-3">
                  <div className="flex flex-wrap gap-1">
                    <Badge>{t('similarity.test.similarity', { percent: result.similarity.toFixed(1) })}</Badge>
                    <Badge variant="outline">{getMatchTypeLabel(result.matchType, t)}</Badge>
                  </div>
                  {result.colorSimilarity ? (
                    <div className="text-muted-foreground text-xs">
                      {t('similarity.test.colorSimilarity', { percent: result.colorSimilarity.toFixed(1) })}
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ) : null}

      <ImageViewerModal
        open={selectedImage !== null}
        onClose={() => setSelectedImage(null)}
        image={selectedImage}
        images={testResults.map((item) => item.image)}
        currentIndex={selectedIndex}
        onImageChange={setSelectedIndex}
      />
    </div>
  )
}
