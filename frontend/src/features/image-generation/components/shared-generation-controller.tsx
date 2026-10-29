import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type GenerationControllerFieldStackProps = {
  children: ReactNode
  className?: string
}

/** Render the shared field stack for workflow controller inputs with separated cards. */
export function GenerationControllerFieldStack({ children, className }: GenerationControllerFieldStackProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {children}
    </div>
  )
}
