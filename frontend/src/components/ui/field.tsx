import { useId, type ComponentProps, type ReactNode } from 'react'
import { Info } from 'lucide-react'
import { Tip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'

interface FieldProps extends ComponentProps<'label'> {
  label: ReactNode
  /** Explanation shown in a tooltip behind a small info icon after the label (tap or focus on touch). */
  info?: ReactNode
  children: ReactNode
}

const FIELD_LABEL_CLASS = 'flex items-center gap-1 text-2xs font-semibold tracking-overline text-muted-foreground uppercase'

/** Render a labelled form field with an overline label and an optional info tooltip. */
function Field({ label, info, children, className, ...props }: FieldProps) {
  return (
    <label data-slot="field" className={cn('theme-settings-field flex flex-col text-sm', className)} {...props}>
      <span className={FIELD_LABEL_CLASS}>
        <span className="min-w-0 truncate">{label}</span>
        {info ? <FieldInfo>{info}</FieldInfo> : null}
      </span>
      {children}
    </label>
  )
}

interface FieldGroupProps extends Omit<ComponentProps<'div'>, 'role'> {
  label: ReactNode
  info?: ReactNode
  children: ReactNode
}

/**
 * `Field` for content that holds several controls (segments, a picker, buttons): the same overline label, but a
 * `role="group"` div named by it instead of a `<label>`, so a click on empty space never presses the first button.
 */
function FieldGroup({ label, info, children, className, ...props }: FieldGroupProps) {
  const labelId = useId()
  return (
    <div data-slot="field" role="group" aria-labelledby={labelId} className={cn('theme-settings-field flex min-w-0 flex-col text-sm', className)} {...props}>
      <span className={FIELD_LABEL_CLASS}>
        <span id={labelId} className="min-w-0 truncate">{label}</span>
        {info ? <FieldInfo>{info}</FieldInfo> : null}
      </span>
      {children}
    </div>
  )
}

/** The ⓘ icon. A real button so a tap or keyboard focus opens the tooltip; a click here never reaches the input. */
function FieldInfo({ children }: { children: ReactNode }) {
  return (
    <Tip content={children} side="top" align="start">
      <button
        type="button"
        aria-label="설명"
        onClick={(event) => event.preventDefault()}
        className="inline-flex shrink-0 cursor-help items-center rounded-full text-muted-foreground normal-case outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
      >
        <Info className="size-3" />
      </button>
    </Tip>
  )
}

export { Field, FieldGroup, FieldInfo }
