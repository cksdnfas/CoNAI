import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'

interface FieldProps extends ComponentProps<'label'> {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
}

/** Render a labelled form field with an overline label and optional trailing hint. */
function Field({ label, hint, children, className, ...props }: FieldProps) {
  return (
    <label data-slot="field" className={cn('theme-settings-field flex flex-col text-sm', className)} {...props}>
      <span className="flex items-center justify-between gap-3 text-2xs font-semibold tracking-overline text-muted-foreground uppercase">
        <span className="min-w-0 truncate">{label}</span>
        {hint ? <span className="shrink-0 text-2xs font-medium tracking-normal text-muted-foreground normal-case">{hint}</span> : null}
      </span>
      {children}
    </label>
  )
}

export { Field }
