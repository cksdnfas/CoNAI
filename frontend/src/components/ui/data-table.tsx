import type { ComponentProps, ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { textVariants } from './text'

/**
 * Flat hairline table for values compared down columns (usage by model, judge stats, file lists, record counts):
 * overline header row, hairline rows, sideways scroll on narrow screens. Put `DataTh` cells in `head` and `DataTr`
 * rows in children. `minWidthClassName` keeps wide tables from squeezing (they scroll instead). `relative` keeps
 * absolutely positioned sr-only header labels inside the scroll box.
 */
export function DataTable({ head, minWidthClassName, className, children }: {
  head: ReactNode
  minWidthClassName?: string
  className?: string
  children: ReactNode
}) {
  return (
    <div className={cn('relative scroll-x', className)}>
      <table className={cn('w-full text-left text-sm', minWidthClassName)}>
        <thead>
          <tr className={cn(textVariants({ variant: 'overline' }), 'border-b border-line')}>{head}</tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  )
}

/** Header cell; `numeric` right-aligns it over a number column. A `scope="row"` cell in a body row reads as a name. */
export function DataTh({ numeric = false, className, ...props }: ComponentProps<'th'> & { numeric?: boolean }) {
  return <th className={cn('py-2 pr-3 font-semibold last:pr-0', numeric && 'text-right', className)} {...props} />
}

/** Hairline row; `interactive` adds the hover wash, `selected` keeps it. */
export function DataTr({ interactive = false, selected = false, className, ...props }: ComponentProps<'tr'> & { interactive?: boolean; selected?: boolean }) {
  return <tr className={cn('border-b border-line last:border-b-0', interactive && 'hover:bg-fill', selected && 'bg-fill', className)} {...props} />
}

/**
 * Body cell; `numeric` right-aligns it with tabular figures, `meta` is muted one-line metadata (date, size, status),
 * `flush` drops the vertical padding for a cell whose control (a ghost button) sets the row height.
 */
export function DataTd({ numeric = false, meta = false, flush = false, className, ...props }: ComponentProps<'td'> & { numeric?: boolean; meta?: boolean; flush?: boolean }) {
  return (
    <td
      className={cn(
        'pr-3 last:pr-0',
        !flush && 'py-2',
        numeric && 'text-right tabular-nums',
        meta && 'whitespace-nowrap text-xs text-muted-foreground',
        className,
      )}
      {...props}
    />
  )
}

/** The select-all / row checkbox column (header and body). */
export function DataCheckTh({ className, ...props }: ComponentProps<'th'>) {
  return <th className={cn('w-10 py-2 pr-3', className)} {...props} />
}

export function DataCheckTd({ className, ...props }: ComponentProps<'td'>) {
  return <td className={cn('w-10 py-2 pr-3', className)} {...props} />
}

/**
 * Cell styling for tables inside rendered Markdown (chat replies, posts), where the renderer owns the markup and the
 * table reads as prose: smaller than the body, hairline under the header, fainter hairlines between rows.
 */
export const proseTableClassNames = {
  wrapper: 'scroll-x',
  table: 'w-full border-collapse text-[0.92em]',
  th: 'border-b border-line px-2 py-1 text-left font-semibold',
  td: 'border-b border-line/60 px-2 py-1 align-top',
} as const
