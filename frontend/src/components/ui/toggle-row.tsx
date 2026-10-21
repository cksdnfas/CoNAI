import type { ComponentProps, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleRowVariants = cva('flex items-center gap-3 rounded-sm text-sm text-foreground', {
  variants: {
    variant: {
      settings: 'theme-settings-panel theme-input-surface',
      detail: 'theme-input-surface border px-3 py-2.5',
    },
    /** `field`: the height of the inputs beside it in a form grid (44px on phones, 36px from sm). */
    size: {
      default: '',
      field: 'min-h-11 py-1.5 sm:min-h-9',
    },
  },
  defaultVariants: {
    variant: 'settings',
  },
})

interface ToggleRowProps extends ComponentProps<'label'>, VariantProps<typeof toggleRowVariants> {
  children: ReactNode
}

/** Render a reusable checkbox-like row container with shared surface variants. */
function ToggleRow({ children, className, variant, size, ...props }: ToggleRowProps) {
  return (
    <label data-slot="toggle-row" className={cn(toggleRowVariants({ variant, size }), className)} {...props}>
      {children}
    </label>
  )
}

export { ToggleRow, toggleRowVariants }
