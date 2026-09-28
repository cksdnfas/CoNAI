import { useParams } from 'react-router-dom'
import { ImageDetailActions } from './components/detail/image-detail-actions'
import { ImageDetailView } from './image-detail-view'
import { useImageSourceBack } from './image-source-navigation'
import { useImageDetailSequence } from './use-image-detail-sequence'

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const handleBackToSource = useImageSourceBack('/')
  const sequence = useImageDetailSequence(compositeHash ?? '')

  if (!compositeHash) {
    return null
  }

  return (
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
        />
      )}
    />
  )
}
