import { useImagePermissions } from '@/features/auth/use-image-permissions'
import { SquareTerminal } from 'lucide-react'
import { buildApiUrl } from '@/lib/api-client'
import { cn } from '@/lib/utils'
import { chatProfileAssetUrl, type ChatAvatarCrop, type ChatEngine, type ChatProfileAssetFields } from '@/lib/api-codex-chat'
import { ChatProfileImage } from './chat-profile-image'

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
export function ChatProfileAvatar({ name, avatar, profile, imageUrl, avatarCrop, engine, size = 'md', className }: {
  name: string
  avatar?: string | null
  profile?: ChatProfileAssetFields & { id?: number }
  imageUrl?: string | null
  avatarCrop?: ChatAvatarCrop | null
  engine: ChatEngine
  size?: keyof typeof SIZE_CLASS
  className?: string
}) {
  const base = cn('inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold', SIZE_CLASS[size], className)
  const { canViewImages } = useImagePermissions()
  const src = imageUrl !== undefined ? imageUrl : profile?.id
    ? chatProfileAssetUrl(profile.id, 'avatar', profile.assetVersion) : avatar
  const thumbnailSrc = imageUrl === undefined && profile?.avatarHash && profile.avatarThumbnailUrl
    ? buildApiUrl(`${profile.avatarThumbnailUrl}?v=${encodeURIComponent(profile.assetVersion ?? '')}`) : null
  const fallback = engine === 'codex' ? <SquareTerminal className="size-[60%]" /> : Array.from(name.trim())[0] ?? '?'
  return <span className={cn(base, engine === 'codex' ? 'bg-foreground text-background' : 'text-black/80')} style={engine === 'codex' ? undefined : { backgroundColor: pickFill(name) }} aria-hidden="true">
    <ChatProfileImage src={canViewImages ? src : null} thumbnailSrc={thumbnailSrc} crop={avatarCrop !== undefined ? avatarCrop : profile?.avatarCrop} fallback={fallback} />
  </span>
}
