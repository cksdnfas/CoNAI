import type { ComponentProps } from 'react'
import { Modal } from './modal'

/** Modal's accessible focus, keyboard and unsaved-change handling in a full-height right-side surface. */
export function Sheet(props: Omit<ComponentProps<typeof Modal>, 'placement' | 'size' | 'height'>) {
  return <Modal {...props} placement="right" size="md" />
}
