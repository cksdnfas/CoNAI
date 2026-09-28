import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-sm text-sm font-medium tracking-tight whitespace-nowrap cursor-pointer transition-all duration-300 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        /**
         * Primary CTA: one per view. Solid primary (text uses the contrast-picked primary-foreground) with a secondary
         * top highlight standing in for the preset's gradient; kept in box-shadow so a bg-* override still replaces the fill.
         */
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_color-mix(in_srgb,var(--secondary)_45%,transparent),0_0_20px_color-mix(in_srgb,var(--primary)_14%,transparent)] hover:brightness-108 hover:shadow-[inset_0_1px_0_color-mix(in_srgb,var(--secondary)_55%,transparent),0_0_28px_color-mix(in_srgb,var(--primary)_18%,transparent)]",
        destructive:
          "bg-destructive-soft text-destructive-soft-foreground hover:brightness-110 focus-visible:ring-destructive/25",
        /** Default non-primary action: tonal fill, no border. Steps up one tone on a surface-high parent (popover, Panel tone=high). */
        secondary:
          "ui-tone-secondary text-foreground hover:bg-surface-highest hover:text-foreground aria-expanded:bg-surface-highest data-[state=open]:bg-surface-highest in-data-[surface=high]:hover:bg-surface-bright",
        /** Lowest-emphasis filled action for dense toolbars and sidebars. Translucent, so it reads on any surface tone. */
        subtle:
          "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground",
        /** Icon toolbars and inline actions: no fill until hover. */
        ghost:
          "text-muted-foreground hover:bg-surface-high hover:text-foreground in-data-[surface=high]:hover:bg-surface-highest",
        /** Sidebar / list navigation row. Mark the current row with data-active="true" or aria-current. */
        nav:
          "w-full justify-start text-left font-normal text-muted-foreground hover:bg-surface-high hover:text-foreground in-data-[surface=high]:hover:bg-surface-highest data-[active=true]:bg-primary/12 data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:[&_svg]:text-primary aria-[current=page]:bg-primary/12 aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=true]:bg-primary/12 aria-[current=true]:font-medium aria-[current=true]:text-foreground",
        link: "text-secondary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-sm px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-sm px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-sm",
        "icon-lg": "size-10 rounded-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
