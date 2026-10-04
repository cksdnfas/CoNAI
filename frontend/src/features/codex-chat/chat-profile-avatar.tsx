import { SquareTerminal } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ChatEngine } from '@/lib/api-codex-chat'

/** Soft fills for avatars without a picture, picked from the name so a profile keeps its colour. */
const INITIAL_FILLS = ['#f2a07b', '#8fb3d9', '#b9a3e3', '#9fd0a8', '#e6c46f', '#e99bb4', '#7fc8c8', '#c9b29b']

const SIZE_CLASS = {
  xs: 'size-5 text-2xs',
  sm: 'size-6 text-2xs',
  md: 'size-8 text-xs',
  lg: 'size-10 text-sm',
  xl: 'size-16 text-xl',
} as const

function pickFill(name: string) {
  let hash = 0
  for (const char of name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }
  return INITIAL_FILLS[hash % INITIAL_FILLS.length]
}

/** A chat profile's face: its picture, else the Codex mark for Codex profiles, else its first letter. */
export function ChatProfileAvatar({ name, avatar, engine, size = 'md', className }: {
  name: string
  avatar: string | null
  engine: ChatEngine
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  const base = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold', SIZE_CLASS[size], className)
  if (avatar) {
    return <img src={avatar} alt="" draggable={false} className={cn(base, 'object-cover')} />
  }
  if (engine === 'codex') {
    return (
      <span className={cn(base, 'bg-foreground text-background')} aria-hidden="true">
        <SquareTerminal className="size-[60%]" />
      </span>
    )
  }
  return (
    <span className={cn(base, 'text-black/80')} style={{ backgroundColor: pickFill(name) }} aria-hidden="true">
      {Array.from(name.trim())[0] ?? '?'}
    </span>
  )
}
