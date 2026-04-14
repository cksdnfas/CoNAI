import type { CSSProperties } from 'react'
import { ImageOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ImagePreviewPlaceholderProps {
  label?: string
  className?: string
  iconClassName?: string
  labelClassName?: string
  compact?: boolean
  style?: CSSProperties
}

/** Render one consistent fallback surface for missing, failed, or not-yet-ready image previews. */
export function ImagePreviewPlaceholder({
  label = '미리보기 없음',
  className,
  iconClassName,
  labelClassName,
  compact = false,
  style,
}: ImagePreviewPlaceholderProps) {
  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center gap-3 bg-[#0f0d0d] px-4 text-center text-[#c9a9a4]',
        compact && 'gap-1.5 px-2',
        className,
      )}
      style={style}
    >
      <ImageOff className={cn('shrink-0 opacity-90', compact ? 'h-6 w-6' : 'h-14 w-14', iconClassName)} strokeWidth={1.8} />
      <span className={cn('leading-none', compact ? 'text-[10px]' : 'text-base', labelClassName)}>{label}</span>
    </div>
  )
}
