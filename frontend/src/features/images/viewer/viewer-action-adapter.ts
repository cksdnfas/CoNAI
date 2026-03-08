import type { ImageRecord } from '@/types/image'

export interface ViewerActionContext {
  image: ImageRecord
  index: number
  images: ImageRecord[]
  closeViewer: () => void
  setViewerIndex: (index: number | null) => void
}

export type ViewerActionHandler = (context: ViewerActionContext) => void | Promise<void>
export type ViewerActionGuard = (context: ViewerActionContext) => boolean

export interface ViewerActionAdapter {
  download?: ViewerActionHandler
  delete?: ViewerActionHandler
  openDetail?: ViewerActionHandler
  openEditor?: ViewerActionHandler
  canOpenEditor?: ViewerActionGuard
  random?: ViewerActionHandler
}
