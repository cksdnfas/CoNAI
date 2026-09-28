import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

// Teach tailwind-merge the project's custom theme keys so `className` overrides
// replace them instead of stacking (`tracking-overline` + `tracking-wide` etc.).
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      tracking: ['overline'],
      shadow: ['elevation-1', 'elevation-2', 'elevation-3'],
    },
  },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
