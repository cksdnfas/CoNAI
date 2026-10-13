import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm text-2xs font-semibold tracking-overline uppercase whitespace-nowrap transition-[color,background,box-shadow] [&>svg]:pointer-events-none [&>svg]:size-3",
  {
    variants: {
      variant: {
        default: "bg-primary/14 text-secondary-text",
        secondary: "bg-surface-highest text-muted-foreground",
        /** Status tones: soft token fills that stay legible in dark and light. */
        success: "bg-success-soft text-success-soft-foreground",
        warning: "bg-warning-soft text-warning-soft-foreground",
        info: "bg-info-soft text-info-soft-foreground",
        destructive: "bg-destructive-soft text-destructive-soft-foreground",
        outline: "bg-transparent text-muted-foreground ring-1 ring-outline-input",
        ghost: "bg-transparent text-muted-foreground",
        link: "text-secondary-text underline-offset-4 [a&]:hover:underline",
        /**
         * On top of a photo / thumbnail (counts, "1/4", kind tags). Backdrop scrim + blur with a white foreground, like
         * Button `overlay`; keeps the text's own case.
         */
        overlay: "bg-backdrop font-medium tracking-normal normal-case text-white backdrop-blur-sm",
      },
      size: {
        default: "px-2.5 py-1",
        /** 20px tall: overlay tags on cards. */
        sm: "px-1.5 py-0 leading-5",
        /** 16px tall: overlay counts on small thumbnails. */
        xs: "px-1 py-0 leading-4",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
