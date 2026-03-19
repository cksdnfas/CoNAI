import type { ReactNode } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { ScrollArea } from '@/components/ui/scroll-area'

interface ResponsiveGenerationShellProps {
  controller: ReactNode
  history: ReactNode
  mobileControllerTitle: string
  mobileControllerDescription: string
  mobileTriggerLabel: string
  mobileFooter?: ReactNode
}

export function ResponsiveGenerationShell({
  controller,
  history,
  mobileControllerTitle,
  mobileControllerDescription,
  mobileTriggerLabel,
  mobileFooter,
}: ResponsiveGenerationShellProps) {
  const hasMobileHeader = Boolean(mobileControllerTitle || mobileControllerDescription)

  return (
    <>
      <div className="hidden gap-6 lg:grid lg:grid-cols-[minmax(0,420px)_minmax(0,1fr)] lg:items-start">
        <div className="min-w-0">{controller}</div>
        <div className="min-w-0">{history}</div>
      </div>

      <div className="space-y-4 pb-20 lg:hidden">
        <div className="min-h-[60vh]">{history}</div>

        <Sheet>
          <SheetTrigger asChild>
            <Button
              type="button"
              size="lg"
              className="fixed right-4 bottom-4 z-40 h-12 rounded-full px-4 shadow-lg sm:right-6 sm:bottom-6"
            >
              <SlidersHorizontal className="h-4 w-4" />
              {mobileTriggerLabel}
            </Button>
          </SheetTrigger>
          <SheetContent side="bottom" className="flex h-[85vh] max-h-[85vh] flex-col rounded-t-2xl p-0" showCloseButton={!mobileFooter}>
            <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />
            {hasMobileHeader ? (
              <SheetHeader className="border-b px-4 py-3 text-left">
                <SheetTitle>{mobileControllerTitle}</SheetTitle>
                <SheetDescription>{mobileControllerDescription}</SheetDescription>
              </SheetHeader>
            ) : null}
            <ScrollArea className="min-h-0 flex-1">
              <div className="p-4 pb-8">{controller}</div>
            </ScrollArea>
            {mobileFooter ? <SheetFooter className="border-t px-4 py-3">{mobileFooter}</SheetFooter> : null}
          </SheetContent>
        </Sheet>
      </div>
    </>
  )
}
