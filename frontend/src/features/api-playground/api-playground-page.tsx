import { useMemo, useState, type FormEvent } from 'react'
import { Play, RefreshCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { apiClient } from '@/lib/api/client'

const presets = ['/health', '/api/settings', '/api/images?page=1&limit=5']

export function ApiPlaygroundPage() {
  const [path, setPath] = useState('/health')
  const [method, setMethod] = useState<'GET' | 'POST'>('GET')
  const [requestBody, setRequestBody] = useState('{\n  "limit": 5\n}')
  const [responseText, setResponseText] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const submitDisabled = useMemo(() => isLoading || !path.trim(), [isLoading, path])

  const runRequest = async (event?: FormEvent) => {
    event?.preventDefault()
    setIsLoading(true)

    try {
      const trimmedPath = path.trim()
      const requestConfig = {
        method,
        url: trimmedPath,
        data: method === 'POST' ? JSON.parse(requestBody) : undefined,
      }

      const { data, status } = await apiClient.request(requestConfig)
      setResponseText(JSON.stringify({ status, data }, null, 2))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown request error'
      setResponseText(`{\n  "error": ${JSON.stringify(message)}\n}`)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">API Playground</h1>
        <p className="text-sm text-muted-foreground">프록시(`/api`, `/uploads`, `/temp`) 경로가 기존 백엔드와 정상 연결되는지 즉시 검증합니다.</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Request</CardTitle>
          <CardDescription>GET/POST 테스트용 미니 클라이언트</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={runRequest} className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <Select value={method} onValueChange={(value: 'GET' | 'POST') => setMethod(value)}>
                <SelectTrigger className="w-[120px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                </SelectContent>
              </Select>

              <Input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/api/settings" />
            </div>

            <div className="flex flex-wrap gap-2">
              {presets.map((preset) => (
                <Button key={preset} type="button" variant="outline" size="sm" onClick={() => setPath(preset)}>
                  {preset}
                </Button>
              ))}
            </div>

            {method === 'POST' && (
              <Textarea
                value={requestBody}
                onChange={(event) => setRequestBody(event.target.value)}
                rows={7}
                className="font-mono text-xs"
              />
            )}

            <div className="flex gap-2">
              <Button type="submit" disabled={submitDisabled}>
                <Play className="mr-1 h-4 w-4" />
                Run
              </Button>
              <Button type="button" variant="outline" onClick={() => setResponseText('')}>
                <RefreshCcw className="mr-1 h-4 w-4" />
                Clear
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Response</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="min-h-[280px] overflow-auto rounded-md bg-muted p-3 text-xs">{responseText || '{ }'}</pre>
        </CardContent>
      </Card>
    </div>
  )
}
