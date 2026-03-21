import type { ReactNode } from 'react'
import { FolderTree, Loader2, X as CloseIcon } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'


interface GroupExplorerLayoutProps {
  breadcrumb?: ReactNode
  loading: boolean
  emptyTitle: string
  emptyDescription: string
  hasVisibleCards: boolean
  cards: ReactNode
  desktopPanel: ReactNode
  mobileSheetOpen: boolean
  onMobileSheetOpenChange: (open: boolean) => void
  mobileSheetContent: ReactNode
}

export function GroupExplorerLayout({
  breadcrumb,
  loading,
  emptyTitle,
  emptyDescription,
  hasVisibleCards,
  cards,
  desktopPanel,
  mobileSheetOpen,
  onMobileSheetOpenChange,
  mobileSheetContent,
}: GroupExplorerLayoutProps) {
  return (
    <Sheet open={mobileSheetOpen} onOpenChange={onMobileSheetOpenChange}>
      {breadcrumb ?? null}

      {loading ? (
        <div className="flex min-h-[220px] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="grid min-h-[640px] gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)] lg:gap-0">
          <div className="min-h-0 lg:pr-4 lg:border-r lg:max-h-[calc(100vh-220px)]">
            <ScrollArea className="h-full">
              <div className="space-y-4 py-1 lg:pr-4">
                {hasVisibleCards ? (
                  cards
                ) : (
                  <div className="py-10 text-center">
                    <FolderTree className="mx-auto mb-2 h-12 w-12 text-muted-foreground" />
                    <p className="text-base text-muted-foreground">{emptyTitle}</p>
                    <p className="mt-1 text-sm text-muted-foreground">{emptyDescription}</p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          <div className="hidden h-full min-h-0 lg:block lg:max-h-[calc(100vh-220px)] lg:pl-4">{desktopPanel}</div>
        </div>
      )}

      <SheetContent side="bottom" className="flex h-[85vh] max-h-[85vh] flex-col rounded-t-2xl p-0 lg:hidden" showCloseButton={false}>
        <SheetTitle className="sr-only">그룹 이미지</SheetTitle>
        <SheetDescription className="sr-only">그룹 이미지 상세 패널</SheetDescription>
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />
        <div className="min-h-0 flex-1 overflow-hidden">{mobileSheetContent}</div>
        <div className="border-t px-4 py-3">
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => onMobileSheetOpenChange(false)}
          >
            <CloseIcon className="mr-2 h-4 w-4" />
            닫기
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
