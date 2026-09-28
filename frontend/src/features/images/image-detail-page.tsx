import { useParams } from 'react-router-dom'
import { ImageDetailActions } from './components/detail/image-detail-actions'
import { ImageDetailView } from './image-detail-view'
import { useImageSourceBack } from './image-source-navigation'

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const handleBackToSource = useImageSourceBack('/')

  if (!compositeHash) {
    return null
  }

  return (
    <ImageDetailView
      compositeHash={compositeHash}
      presentation="page"
      renderHeader={({ downloadName, downloadUrl, image, isRefreshing, refresh }) => (
        <ImageDetailActions
          downloadUrl={downloadUrl}
          downloadName={downloadName}
          image={image}
          isRefreshing={isRefreshing}
          onBack={handleBackToSource}
          onRefresh={refresh}
        />
      )}
    />
  )
}
