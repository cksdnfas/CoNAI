import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

/** Pressed look for toggle buttons (IconButton `active` sets data-pressed="true" + aria-pressed). */
const PRESSED_TINT =
  "data-[pressed=true]:bg-primary/12 data-[pressed=true]:text-primary data-[pressed=true]:hover:bg-primary/16 data-[pressed=true]:hover:text-primary"

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
        secondary: cn(
          "ui-tone-secondary text-foreground hover:bg-surface-highest hover:text-foreground aria-expanded:bg-surface-highest data-[state=open]:bg-surface-highest in-data-[surface=high]:hover:bg-surface-bright",
          PRESSED_TINT,
        ),
        /** Lowest-emphasis filled action for dense toolbars and sidebars. Translucent, so it reads on any surface tone. */
        subtle: cn(
          "bg-foreground/5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground aria-expanded:bg-foreground/10 aria-expanded:text-foreground",
          PRESSED_TINT,
        ),
        /** Icon toolbars and inline actions: no fill until hover. */
        ghost: cn(
          "text-muted-foreground hover:bg-surface-high hover:text-foreground in-data-[surface=high]:hover:bg-surface-highest",
          PRESSED_TINT,
        ),
        /**
         * Sidebar / list navigation row (same look as SidebarItem). Mark the current row with data-active="true" or
         * aria-current → subtle fill + 2px primary bar on the left + foreground text.
         */
        nav: cn(
          "w-full justify-start text-left font-normal text-muted-foreground hover:bg-fill hover:text-foreground",
          "data-[active=true]:bg-fill data-[active=true]:font-medium data-[active=true]:text-foreground data-[active=true]:shadow-[inset_2px_0_0_var(--primary)]",
          "aria-[current=page]:bg-fill aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-[inset_2px_0_0_var(--primary)]",
          "aria-[current=true]:bg-fill aria-[current=true]:font-medium aria-[current=true]:text-foreground aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
        ),
        link: "text-secondary-text underline-offset-4 hover:underline",
        /**
         * Glass icon buttons in the floating app header (search, queue, account). Chrome lives in
         * `.theme-shell-icon-button` (index.css): translucent low tone, blur, hairline; open/pressed tint with primary.
         */
        shell:
          "theme-shell-icon-button text-foreground/80 hover:text-foreground aria-expanded:text-foreground",
        /**
         * Controls that sit on top of photos (viewer toolbars, media tiles). Translucent backdrop scrim + blur with a
         * white foreground, so they read on any image in both themes. Pressed = solid primary.
         */
        overlay:
          "bg-backdrop/50 text-white shadow-elevation-1 backdrop-blur-md hover:bg-backdrop/80 hover:text-white aria-expanded:bg-backdrop/80 focus-visible:ring-white/50 data-[pressed=true]:bg-primary data-[pressed=true]:text-primary-foreground data-[pressed=true]:hover:bg-primary data-[pressed=true]:hover:text-primary-foreground",
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
