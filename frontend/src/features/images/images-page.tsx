import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { createImageRenderItemFromApiItem } from '@/features/images/components/image-list-contract'
import { useImages } from '@/hooks/use-images'
import { getBackendOrigin } from '@/utils/backend'

export function ImagesPage() {
  const [search, setSearch] = useState('')
  const imagesQuery = useImages(20)
  const imageRows = imagesQuery.data?.data.images
  const backendOrigin = getBackendOrigin()

  const renderItems = useMemo(
    () => (imageRows ?? []).map((item, index) => createImageRenderItemFromApiItem(item, index, backendOrigin)),
    [backendOrigin, imageRows],
  )

  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return renderItems

    return renderItems.filter((row) => row.searchSource.includes(keyword))
  }, [renderItems, search])

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Images</h1>
          <p className="text-sm text-muted-foreground">
            `/api/images` 데이터를 shadcn table/card로 렌더링하는 분리 테스트 화면
          </p>
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="hash / path / model"
            className="pl-9"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Image List</CardTitle>
          <CardDescription>
            총 {imagesQuery.data?.data.total ?? '-'}개 중 현재 {filteredRows.length}개 표시
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[560px] rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[92px]">Thumbnail</TableHead>
                  <TableHead>Composite Hash</TableHead>
                  <TableHead>Resolution</TableHead>
                  <TableHead>Size</TableHead>
                  <TableHead>Model</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredRows.map((item) => (
                  <TableRow key={item.stableIdentity.stableKey}>
                    <TableCell>
                      <img
                        src={item.previewUrl}
                        alt={item.compositeHashLabel}
                        className="h-14 w-14 rounded-md border object-cover"
                        loading="lazy"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.compositeHashLabel === '-'
                        ? '-'
                        : `${item.compositeHashLabel.slice(0, 20)}...`}
                    </TableCell>
                    <TableCell>{item.resolutionLabel}</TableCell>
                    <TableCell>{item.fileSizeLabel}</TableCell>
                    <TableCell>
                      {item.modelLabel !== '-'
                        ? <Badge variant="secondary">{item.modelLabel}</Badge>
                        : '-'}
                    </TableCell>
                  </TableRow>
                ))}

                {!imagesQuery.isLoading && filteredRows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      표시할 이미지가 없습니다.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  )
}
