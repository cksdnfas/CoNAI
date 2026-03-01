import { Image as ImageIcon } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

interface ImageViewCardMetaProps {
  title: string
  imageCountLabel: string
}

export function createImageViewCardMeta({ title, imageCountLabel }: ImageViewCardMetaProps) {
  return {
    title: (
      <div className="flex items-center gap-1.5">
        <ImageIcon className="h-4 w-4 text-primary" />
        <p className="truncate text-sm font-medium text-white">{title}</p>
      </div>
    ),
    badges: (
      <Badge variant="secondary" className="bg-white/20 text-white hover:bg-white/25">
        {imageCountLabel}
      </Badge>
    ),
  }
}
