import { useParams } from 'react-router-dom'
import { GenerationLayoutControls } from '@/features/image-generation/layout/generation-layout-controls'
import { GenerationLayoutProvider } from '@/features/image-generation/layout/generation-layout-context'
import { useMinWidth } from '@/lib/use-min-width'
import { ImageDetailActions } from './components/detail/image-detail-actions'
import { ImageDetailView } from './image-detail-view'
import { useImageSourceBack } from './image-source-navigation'
import { useImageDetailSequence } from './use-image-detail-sequence'

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const handleBackToSource = useImageSourceBack('/')
  const sequence = useImageDetailSequence(compositeHash ?? '')
  const isWide = useMinWidth(1280)

  if (!compositeHash) {
    return null
  }

  return (
    <GenerationLayoutProvider>
      <ImageDetailView
        compositeHash={compositeHash}
        presentation="page"
        renderHeader={({ downloadName, downloadUrl, image, isRefreshing, refresh, similarity }) => (
          <ImageDetailActions
            downloadUrl={downloadUrl}
            downloadName={downloadName}
            image={image}
            isRefreshing={isRefreshing}
            onBack={handleBackToSource}
            onRefresh={refresh}
            onDeleted={handleBackToSource}
            sequence={sequence}
            similarity={similarity}
            trailing={<GenerationLayoutControls wide={isWide} />}
          />
        )}
      />
    </GenerationLayoutProvider>
  )
}
