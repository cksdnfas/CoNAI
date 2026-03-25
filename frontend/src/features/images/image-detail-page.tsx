import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { ImageDetailActions } from './components/detail/image-detail-actions'
import { ImageDetailView } from './image-detail-view'

interface DetailLocationState {
  fromFeed?: boolean
  sourcePath?: string
}

export function ImageDetailPage() {
  const { compositeHash } = useParams<{ compositeHash: string }>()
  const navigate = useNavigate()
  const location = useLocation()
  const locationState = location.state as DetailLocationState | null

  if (!compositeHash) {
    return null
  }

  const handleBackToFeed = () => {
    if (locationState?.fromFeed && locationState.sourcePath === '/' && window.history.state?.idx > 0) {
      navigate(-1)
      return
    }

    navigate('/')
  }

  return (
    <ImageDetailView
      compositeHash={compositeHash}
      presentation="page"
      renderHeader={({ downloadName, downloadUrl, isRefreshing, refresh }) => (
        <ImageDetailActions
          downloadUrl={downloadUrl}
          downloadName={downloadName}
          isRefreshing={isRefreshing}
          onBack={handleBackToFeed}
          onRefresh={refresh}
        />
      )}
    />
  )
}
