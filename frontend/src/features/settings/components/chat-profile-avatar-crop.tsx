import { useRef, useState } from 'react'
import { Check } from 'lucide-react'
import { IconButton } from '@/components/ui/icon-button'
import { Modal, ModalBody, ModalFooter } from '@/components/ui/modal'
import { Slider } from '@/components/ui/slider'
import { ChatProfileImage } from '@/features/codex-chat/chat-profile-image'
import { useI18n } from '@/i18n'
import type { ChatAvatarCrop } from '@/lib/api-codex-chat'

const clamp = (value: number) => Math.max(0, Math.min(100, value))

/** The square uses the same cover, position and scale as every avatar. */
export function ChatProfileAvatarCrop({ src, initial, onApply, onClose }: {
  src: string
  initial?: ChatAvatarCrop | null
  onApply: (crop: ChatAvatarCrop) => void
  onClose: () => void
}) {
  const { t } = useI18n()
  const [crop, setCrop] = useState<ChatAvatarCrop>(() => ({ x: clamp(initial?.x ?? 50), y: clamp(initial?.y ?? 50), scale: Math.max(1, Math.min(4, initial?.scale ?? 1)) }))
  const [aspect, setAspect] = useState<number | null>(null)
  const drag = useRef<{ pointerId: number; x: number; y: number; crop: ChatAvatarCrop } | null>(null)
  return <Modal open title={t({ ko: '아바타 자르기', en: 'Crop avatar' })} onClose={onClose} widthClassName="max-w-sm">
    <ModalBody className="space-y-4">
      <div role="application" tabIndex={0} aria-label={t({ ko: '자르기 위치: 드래그하거나 방향키로 옮겨', en: 'Crop position: drag or use arrow keys' })}
        className="relative mx-auto aspect-square w-[280px] max-w-full touch-none cursor-grab overflow-hidden rounded-md bg-surface-high outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 active:cursor-grabbing"
        onPointerDown={(event) => { if (!aspect) return; event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, crop } }}
        onPointerMove={(event) => {
          const start = drag.current
          if (!start || start.pointerId !== event.pointerId || !aspect) return
          const side = event.currentTarget.getBoundingClientRect().width
          const overflowX = side * (Math.max(1, aspect) * start.crop.scale - 1)
          const overflowY = side * (Math.max(1, 1 / aspect) * start.crop.scale - 1)
          setCrop({ ...start.crop, x: overflowX > 0 ? clamp(start.crop.x - (event.clientX - start.x) / overflowX * 100) : 50, y: overflowY > 0 ? clamp(start.crop.y - (event.clientY - start.y) / overflowY * 100) : 50 })
        }}
        onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }} onLostPointerCapture={() => { drag.current = null }}
        onKeyDown={(event) => {
          if (!event.key.startsWith('Arrow')) return
          event.preventDefault()
          setCrop((value) => ({ ...value, x: clamp(value.x + (event.key === 'ArrowLeft' ? -2 : event.key === 'ArrowRight' ? 2 : 0)), y: clamp(value.y + (event.key === 'ArrowUp' ? -2 : event.key === 'ArrowDown' ? 2 : 0)) }))
        }}>
        <ChatProfileImage src={src} crop={crop} onLoad={(event) => setAspect(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)} />
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 border-2 border-primary" />
      </div>
      <Slider min={1} max={4} step={0.01} value={[crop.scale]} onValueChange={([scale]) => setCrop((value) => ({ ...value, scale }))} aria-label={t({ ko: '확대', en: 'Zoom' })} />
    </ModalBody>
    <ModalFooter><IconButton size="icon-sm" disabled={!aspect} label={t({ ko: '적용', en: 'Apply' })} onClick={() => onApply(crop)}><Check /></IconButton></ModalFooter>
  </Modal>
}
