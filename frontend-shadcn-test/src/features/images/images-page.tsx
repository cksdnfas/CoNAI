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
import { buildThumbnailUrl } from '@/lib/api/endpoints'
import { useImages } from '@/hooks/use-images'

const formatFileSize = (bytes?: number) => {
  if (!bytes || bytes <= 0) return '-'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

export function ImagesPage() {
  const [search, setSearch] = useState('')
  const imagesQuery = useImages(20)

  const rows = imagesQuery.data?.data.images ?? []
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase()
    if (!keyword) return rows

    return rows.filter((row) => {
      return (
        row.composite_hash.toLowerCase().includes(keyword) ||
        row.original_file_path?.toLowerCase().includes(keyword) ||
        row.model_name?.toLowerCase().includes(keyword)
      )
    })
  }, [rows, search])

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
                  <TableRow key={item.composite_hash}>
                    <TableCell>
                      <img
                        src={buildThumbnailUrl(item.composite_hash)}
                        alt={item.composite_hash}
                        className="h-14 w-14 rounded-md border object-cover"
                        loading="lazy"
                      />
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {item.composite_hash.slice(0, 20)}...
                    </TableCell>
                    <TableCell>
                      {item.width ?? '-'} × {item.height ?? '-'}
                    </TableCell>
                    <TableCell>{formatFileSize(item.file_size)}</TableCell>
                    <TableCell>
                      {item.model_name ? <Badge variant="secondary">{item.model_name}</Badge> : '-'}
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
