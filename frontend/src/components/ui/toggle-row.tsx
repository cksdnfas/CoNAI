import type { ComponentProps, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

const toggleRowVariants = cva('flex items-center gap-3 rounded-sm text-sm text-foreground', {
  variants: {
    variant: {
      settings: 'theme-settings-panel bg-surface-container',
      detail: 'border border-border bg-surface-container px-3 py-2.5',
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
function ToggleRow({ children, className, variant, ...props }: ToggleRowProps) {
  return (
    <label data-slot="toggle-row" className={cn(toggleRowVariants({ variant }), className)} {...props}>
      {children}
    </label>
  )
}

export { ToggleRow, toggleRowVariants }
