import type { ReactNode } from 'react'
import { FolderTree, Loader2 } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Sheet, SheetContent } from '@/components/ui/sheet'

interface GroupExplorerLayoutProps {
  breadcrumb?: ReactNode
  loading: boolean
  explorerTitle: string
  explorerDescription: string
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
  explorerTitle,
  explorerDescription,
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
        <div className="grid min-h-[640px] gap-4 lg:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="min-h-0 rounded-lg border bg-card">
            <div className="border-b px-4 py-3">
              <p className="text-sm font-semibold text-foreground">{explorerTitle}</p>
              <p className="text-xs text-muted-foreground">{explorerDescription}</p>
            </div>
            <ScrollArea className="h-full max-h-[calc(100vh-220px)]">
              <div className="space-y-4 p-4">
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

          <div className="hidden min-h-0 lg:block">{desktopPanel}</div>
        </div>
      )}

      <SheetContent side="bottom" className="flex h-[85vh] max-h-[85vh] flex-col rounded-t-2xl p-0 lg:hidden" showCloseButton={true}>
        <div className="mx-auto mt-2 h-1.5 w-12 rounded-full bg-muted" />
        <div className="border-b px-4 py-3">
          <p className="text-sm font-semibold text-foreground">이미지 탐색</p>
          <p className="text-xs text-muted-foreground">선택한 그룹의 이미지를 아래 패널에서 탐색하나이다.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden p-3">{mobileSheetContent}</div>
      </SheetContent>
    </Sheet>
  )
}
