import { cn } from "@/lib/utils"

function Skeleton({ className, radius = 'md', ...props }: React.ComponentProps<"div"> & { radius?: 'sm' | 'md' | 'full' }) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse bg-accent", { sm: 'rounded-sm', md: 'rounded-md', full: 'rounded-full' }[radius], className)}
      {...props}
    />
  )
}

export { Skeleton }
