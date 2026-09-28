import { useMemo, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, FlaskConical, FolderOpen, PackagePlus, RefreshCw } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { IconButton } from '@/components/ui/icon-button'
import { Heading } from '@/components/ui/heading'
import { cn } from '@/lib/utils'
import { Inset } from '@/components/ui/inset'
import { Section } from '@/components/ui/section'
import { Text } from '@/components/ui/text'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useSnackbar } from '@/components/ui/snackbar-context'
import { useI18n } from '@/i18n'
import { Field } from '@/components/ui/field'
import { StatTile } from '@/components/ui/stat-tile'
import {
  getCustomNodeSource,
  installCustomNodeDependencies,
  listCustomNodes,
  openCustomNodeFolder,
  rescanCustomNodes,
  scaffoldCustomNode,
  testCustomNode,
  type CustomNodeScaffoldTemplate,
  type CustomNodeTestResult,
} from '@/lib/api-custom-nodes'
import { copyTextToClipboard } from '@/lib/clipboard'
import { LoadingState } from '@/components/ui/loading-state'
import { ErrorState } from '@/components/ui/error-state'

type CustomNodeManagementPanelProps = {
  onModulesChanged?: () => Promise<unknown> | void
}

function stringifyPrettyJson(value: unknown) {
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function isImageDataUrl(value: unknown): value is string {
  return typeof value === 'string' && /^data:image\//.test(value)
}

function isLikelyFilePath(value: unknown): value is string {
  return typeof value === 'string' && !/^data:image\//.test(value) && /[\\/]|\.[a-z0-9]+$/i.test(value)
}

type PanelCardHeaderProps = {
  title: string
  meta?: ReactNode
  actions?: ReactNode
}

function PanelCardHeader({ title, meta, actions }: PanelCardHeaderProps) {
  return (
    <div className="flex items-center justify-between gap-3 pb-1">
      <div className="flex min-w-0 items-baseline gap-2">
        <Heading level={3}>{title}</Heading>
        {meta ? <Text as="span" variant="caption" className="truncate">{meta}</Text> : null}
      </div>

      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  )
}

/** Render a local-only manager for file-based custom nodes inside the module graph workspace. */
export function CustomNodeManagementPanel({ onModulesChanged }: CustomNodeManagementPanelProps) {
  const { showSnackbar } = useSnackbar()
  const { t } = useI18n()
  const queryClient = useQueryClient()
  const [folderName, setFolderName] = useState('')
  const [nodeKey, setNodeKey] = useState('')
  const [nodeName, setNodeName] = useState('')
  const [nodeDescription, setNodeDescription] = useState('')
  const [scaffoldTemplate, setScaffoldTemplate] = useState<CustomNodeScaffoldTemplate>('empty')
  const [selectedTestKey, setSelectedTestKey] = useState<string>('')
  const [testInputsText, setTestInputsText] = useState('{}')
  const [testResultText, setTestResultText] = useState('')
  const [testResultData, setTestResultData] = useState<CustomNodeTestResult | null>(null)
  const [installResultText, setInstallResultText] = useState('')

  const customNodesQuery = useQuery({
    queryKey: ['custom-nodes'],
    queryFn: listCustomNodes,
  })

  const loadedNodes = useMemo(() => customNodesQuery.data?.nodes ?? [], [customNodesQuery.data?.nodes])
  const loadErrors = customNodesQuery.data?.errors ?? []

  const selectedTestNode = useMemo(
    () => loadedNodes.find((node) => node.manifest.key === selectedTestKey) ?? null,
    [loadedNodes, selectedTestKey],
  )

  const testResultNode = useMemo(
    () => loadedNodes.find((node) => node.manifest.key === testResultData?.key) ?? null,
    [loadedNodes, testResultData?.key],
  )

  const selectedNodeSourceQuery = useQuery({
    queryKey: ['custom-node-source', selectedTestKey],
    queryFn: () => getCustomNodeSource(selectedTestKey),
    enabled: !!selectedTestKey,
  })

  const previewableImageOutputs = useMemo(() => {
    if (!testResultData || !testResultNode) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    return testResultNode.manifest.outputs
      .filter((port) => (port.data_type === 'image' || port.data_type === 'mask') && isImageDataUrl(testResultData.outputs[port.key]))
      .map((port) => ({
        key: port.key,
        label: port.label ?? port.key,
        value: testResultData.outputs[port.key] as string,
      }))
  }, [testResultData, testResultNode])

  const filePathOutputs = useMemo(() => {
    if (!testResultData || !testResultNode) {
      return [] as Array<{ key: string; label: string; value: string }>
    }

    return testResultNode.manifest.outputs
      .filter((port) => (port.data_type === 'image' || port.data_type === 'mask') && isLikelyFilePath(testResultData.outputs[port.key]))
      .map((port) => ({
        key: port.key,
        label: port.label ?? port.key,
        value: testResultData.outputs[port.key] as string,
      }))
  }, [testResultData, testResultNode])

  const handleModulesChanged = async () => {
    await queryClient.invalidateQueries({ queryKey: ['custom-nodes'] })
    await onModulesChanged?.()
  }

  const rescanMutation = useMutation({
    mutationFn: rescanCustomNodes,
    onSuccess: async (result) => {
      showSnackbar({
        message: t({ ko: '커스텀 노드 {nodes}개 스캔 완료. 오류 {errors}개.', en: 'Scanned {nodes} custom nodes. {errors} errors.' }, { nodes: result.nodes.length, errors: result.errors.length }),
        tone: result.errors.length > 0 ? 'error' : 'info',
      })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 재스캔에 실패했어.', en: 'Failed to rescan custom nodes.' }),
        tone: 'error',
      })
    },
  })

  const scaffoldMutation = useMutation({
    mutationFn: scaffoldCustomNode,
    onSuccess: async (result, variables) => {
      setFolderName('')
      setNodeKey('')
      setNodeName('')
      setNodeDescription('')
      setSelectedTestKey(variables.key)
      setTestResultData(null)
      setTestResultText('')
      setInstallResultText('')
      showSnackbar({ message: t({ ko: '커스텀 노드 폴더를 만들었어: {path}', en: 'Created the custom node folder: {path}' }, { path: result.folderPath }), tone: 'info' })
      await handleModulesChanged()
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 스캐폴드 생성에 실패했어.', en: 'Failed to create the custom node scaffold.' }),
        tone: 'error',
      })
    },
  })

  const openFolderMutation = useMutation({
    mutationFn: async (key: string) => await openCustomNodeFolder(key),
    onSuccess: (result) => {
      showSnackbar({ message: t({ ko: '커스텀 노드 폴더를 열었어: {path}', en: 'Opened the custom node folder: {path}' }, { path: result.folderPath }), tone: 'info' })
    },
    onError: (error) => {
      showSnackbar({
        message: error instanceof Error ? error.message : t({ ko: '커스텀 노드 폴더 열기에 실패했어.', en: 'Failed to open the custom node folder.' }),
        tone: 'error',
      })
    },
  })

  const installDependenciesMutation = useMutation({
    mutationFn: async (key: string) => await installCustomNodeDependencies(key),
    onSuccess: (result) => {
      setInstallResultText(stringifyPrettyJson(result))
      showSnackbar({ message: t({ ko: 'npm install 완료: {key}', en: 'npm install complete: {key}' }, { key: result.key }), tone: 'info' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t({ ko: '커스텀 노드 의존성 설치에 실패했어.', en: 'Failed to install custom node dependencies.' })
      setInstallResultText(message)
      showSnackbar({ message, tone: 'error' })
    },
  })

  const testMutation = useMutation({
    mutationFn: async () => {
      if (!selectedTestKey) {
        throw new Error(t({ ko: '먼저 테스트할 커스텀 노드를 하나 골라줘.', en: 'Select a custom node to test first.' }))
      }

      let parsedInputs: Record<string, unknown> = {}
      const trimmed = testInputsText.trim()
      if (trimmed.length > 0) {
        const parsed = JSON.parse(trimmed)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          throw new Error(t({ ko: '테스트 입력은 JSON object 형태여야 해.', en: 'Test input must be a JSON object.' }))
        }
        parsedInputs = parsed as Record<string, unknown>
      }

      return await testCustomNode(selectedTestKey, parsedInputs)
    },
    onSuccess: (result) => {
      setTestResultData(result)
      setTestResultText(stringifyPrettyJson(result))
      showSnackbar({ message: t({ ko: '커스텀 노드 테스트 완료: {name}', en: 'Custom node test complete: {name}' }, { name: result.name }), tone: 'info' })
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : t({ ko: '커스텀 노드 테스트 실행에 실패했어.', en: 'Failed to run the custom node test.' })
      setTestResultData(null)
      setTestResultText(message)
      showSnackbar({ message, tone: 'error' })
    },
  })

  return (
    <div className="space-y-4">
      <Inset className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <Text as="div" variant="overline">{t({ ko: '커스텀 노드 디렉터리', en: 'Custom Nodes Directory' })}</Text>
          <div className="mt-1 break-all text-sm text-foreground">{customNodesQuery.data?.customNodesDir ?? 'user/custom_nodes'}</div>
        </div>

        <IconButton variant="secondary" label={t({ ko: '재스캔', en: 'Rescan' })} onClick={() => void rescanMutation.mutateAsync()} disabled={rescanMutation.isPending}>
          <RefreshCw className={cn(rescanMutation.isPending && 'animate-spin')} />
        </IconButton>
      </Inset>

      {customNodesQuery.isLoading ? (
        <LoadingState variant="inline" label={t({ ko: '커스텀 노드 폴더를 읽고 있어.', en: 'Reading the custom node folders.' })} />
      ) : null}

      {customNodesQuery.isError ? (
        <ErrorState
          title={t({ ko: '목록 로드 실패', en: 'Failed to load list' })}
          description={customNodesQuery.error instanceof Error ? customNodesQuery.error.message : t({ ko: '커스텀 노드 목록을 불러오지 못했어.', en: 'Failed to load the custom node list.' })}
        />
      ) : null}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <div className="space-y-4">
          <Section bodyClassName="space-y-3">
              <PanelCardHeader title={t({ ko: '등록된 커스텀 노드', en: 'Registered custom nodes' })} />

              {loadedNodes.length === 0 ? (
                <EmptyState size="compact" title={t({ ko: '노드 없음', en: 'No nodes' })} />
              ) : (
                <div className="space-y-2.5">
                  {loadedNodes.map((node) => {
                    const isSelected = selectedTestKey === node.manifest.key
                    return (
                      <Inset
                        key={node.manifest.key}
                        data-selected={isSelected}
                        className={cn('px-3 py-2.5 transition-colors', isSelected && 'bg-primary/12')}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 space-y-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-medium text-foreground">{node.manifest.name}</span>
                              <Badge variant="outline">{node.manifest.key}</Badge>
                            </div>
                            {node.manifest.description ? <div className="text-xs text-muted-foreground">{node.manifest.description}</div> : null}
                            <div className="text-2xs text-muted-foreground">{node.folderPath}</div>
                          </div>

                          <div className="flex flex-wrap gap-1">
                            <IconButton
                              size="icon-sm"
                              variant="ghost"
                              active={isSelected}
                              label={isSelected ? t({ ko: '테스트 대상', en: 'Test target' }) : t({ ko: '테스트 선택', en: 'Select for test' })}
                              onClick={() => {
                                setSelectedTestKey(node.manifest.key)
                                setTestResultData(null)
                                setTestResultText('')
                                setInstallResultText('')
                              }}
                            >
                              <FlaskConical />
                            </IconButton>
                            <IconButton
                              size="icon-sm"
                              variant="ghost"
                              label={t({ ko: '폴더 열기', en: 'Open folder' })}
                              onClick={() => void openFolderMutation.mutateAsync(node.manifest.key)}
                              disabled={openFolderMutation.isPending}
                            >
                              <FolderOpen />
                            </IconButton>
                            <IconButton
                              size="icon-sm"
                              variant="ghost"
                              label={t({ ko: '경로 복사', en: 'Copy path' })}
                              onClick={async () => {
                                try {
                                  await copyTextToClipboard(node.folderPath)
                                  showSnackbar({ message: t({ ko: '폴더 경로를 복사했어.', en: 'Copied the folder path.' }), tone: 'info' })
                                } catch {
                                  showSnackbar({ message: t({ ko: '폴더 경로 복사에 실패했어.', en: 'Failed to copy the folder path.' }), tone: 'error' })
                                }
                              }}
                            >
                              <Copy />
                            </IconButton>
                          </div>
                        </div>
                      </Inset>
                    )
                  })}
                </div>
              )}
          </Section>

          <Section bodyClassName="space-y-3">
              <PanelCardHeader title={t({ ko: '로드 오류', en: 'Load errors' })} />

              {loadErrors.length === 0 ? (
                <EmptyState size="compact" title={t({ ko: '오류 없음', en: 'No errors' })} />
              ) : (
                <div className="space-y-3">
                  {loadErrors.map((errorItem) => (
                    <Alert key={`${errorItem.folderPath}:${errorItem.message}`} variant="destructive">
                      <AlertTitle>{errorItem.folderName}</AlertTitle>
                      <AlertDescription>
                        <div className="text-sm">{errorItem.message}</div>
                        <div className="mt-1 text-xs opacity-90">{errorItem.folderPath}</div>
                      </AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
          </Section>
        </div>

        <div className="space-y-4">
          <Section bodyClassName="space-y-3">
              <PanelCardHeader title={t({ ko: '새 노드 스캐폴드', en: 'New node scaffold' })} />

              <div className="grid gap-3">
                <Field label="folder">
                  <Input variant="settings" value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="weather-api" />
                </Field>

                <Field label="node key">
                  <Input variant="settings" value={nodeKey} onChange={(event) => setNodeKey(event.target.value)} placeholder="custom.weather_api" />
                </Field>

                <Field label={t({ ko: '표시 이름', en: 'Display name' })}>
                  <Input variant="settings" value={nodeName} onChange={(event) => setNodeName(event.target.value)} placeholder="Weather API" />
                </Field>

                <Field label={t({ ko: '설명', en: 'Description' })}>
                  <Textarea variant="settings" rows={3} value={nodeDescription} onChange={(event) => setNodeDescription(event.target.value)} placeholder={t({ ko: '선택', en: 'Optional' })} />
                </Field>

                <Field label={t({ ko: '템플릿', en: 'Template' })}>
                  <Select variant="settings" value={scaffoldTemplate} onChange={(event) => setScaffoldTemplate(event.target.value as CustomNodeScaffoldTemplate)}>
                    <option value="empty">{t({ ko: '비어 있음', en: 'Empty' })}</option>
                    <option value="hello_world">{t({ ko: '헬로 월드', en: 'Hello World' })}</option>
                    <option value="http_json">HTTP JSON</option>
                    <option value="image_file">{t({ ko: '이미지 파일', en: 'Image File' })}</option>
                  </Select>
                </Field>
                <Button
                  type="button"
                  onClick={() => void scaffoldMutation.mutateAsync({
                    folderName: folderName.trim(),
                    key: nodeKey.trim(),
                    name: nodeName.trim(),
                    description: nodeDescription.trim() || undefined,
                    template: scaffoldTemplate,
                  })}
                  disabled={scaffoldMutation.isPending || !folderName.trim() || !nodeKey.trim() || !nodeName.trim()}
                >
                  {scaffoldMutation.isPending ? t({ ko: '생성 중...', en: 'Creating...' }) : t({ ko: '스캐폴드 생성', en: 'Create scaffold' })}
                </Button>
              </div>
          </Section>

          <Section bodyClassName="space-y-3">
              <PanelCardHeader title={t({ ko: '단건 테스트', en: 'Single test' })} meta={selectedTestNode?.manifest.name} />

              {selectedNodeSourceQuery.data ? (
                <Inset className="space-y-3 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium text-foreground">{t({ ko: '소스 정보', en: 'Source info' })}</div>
                    <Badge variant="outline">{selectedNodeSourceQuery.data.sourceHash.slice(0, 12)}</Badge>
                  </div>
                  <div className="grid gap-2.5 md:grid-cols-2">
                    <StatTile label={t({ ko: '폴더', en: 'Folder' })} value={selectedNodeSourceQuery.data.folderPath} className="bg-surface-container" valueClassName="break-all text-xs font-medium" />
                    <StatTile label="manifest" value={selectedNodeSourceQuery.data.manifestPath} className="bg-surface-container" valueClassName="break-all text-xs font-medium" />
                    <StatTile label="entry" value={selectedNodeSourceQuery.data.entryPath} className="bg-surface-container" valueClassName="break-all text-xs font-medium" />
                    <StatTile label="package.json" value={selectedNodeSourceQuery.data.packageJsonPath ?? t({ ko: '없음', en: 'None' })} className="bg-surface-container" valueClassName="break-all text-xs font-medium" />
                    <StatTile label="README" value={selectedNodeSourceQuery.data.readmePath ?? t({ ko: '없음', en: 'None' })} className="bg-surface-container md:col-span-2" valueClassName="break-all text-xs font-medium" />
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <IconButton size="icon-sm" variant="ghost" label={t({ ko: '폴더 열기', en: 'Open folder' })} onClick={() => void openFolderMutation.mutateAsync(selectedNodeSourceQuery.data.key)} disabled={openFolderMutation.isPending}>
                      <FolderOpen />
                    </IconButton>
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      label={t({ ko: 'Entry 경로 복사', en: 'Copy entry path' })}
                      onClick={async () => {
                        try {
                          await copyTextToClipboard(selectedNodeSourceQuery.data.entryPath)
                          showSnackbar({ message: t({ ko: 'entry 경로를 복사했어.', en: 'Copied the entry path.' }), tone: 'info' })
                        } catch {
                          showSnackbar({ message: t({ ko: 'entry 경로 복사에 실패했어.', en: 'Failed to copy the entry path.' }), tone: 'error' })
                        }
                      }}
                    >
                      <Copy />
                    </IconButton>
                    <IconButton
                      size="icon-sm"
                      variant="ghost"
                      label={installDependenciesMutation.isPending ? t({ ko: 'npm install 중...', en: 'Running npm install...' }) : 'npm install'}
                      onClick={() => void installDependenciesMutation.mutateAsync(selectedNodeSourceQuery.data.key)}
                      disabled={installDependenciesMutation.isPending || !selectedNodeSourceQuery.data.packageJsonPath}
                    >
                      <PackagePlus />
                    </IconButton>
                  </div>
                  {selectedNodeSourceQuery.data.packageJsonPath ? (
                    <Textarea variant="settings" rows={8} value={installResultText} placeholder={t({ ko: 'npm install 결과가 여기에 보여.', en: 'The npm install result appears here.' })} readOnly />
                  ) : null}
                  <Textarea variant="settings" rows={8} value={stringifyPrettyJson(selectedNodeSourceQuery.data.manifest)} readOnly />
                </Inset>
              ) : null}

              <Field label={t({ ko: '테스트 입력 JSON', en: 'Test input JSON' })}>
                <Textarea
                  variant="settings"
                  rows={8}
                  value={testInputsText}
                  onChange={(event) => setTestInputsText(event.target.value)}
                  placeholder={"{\n  \"input\": \"value\"\n}"}
                />
              </Field>
              <Button type="button" variant="secondary" onClick={() => void testMutation.mutateAsync()} disabled={testMutation.isPending || !selectedTestKey}>
                {testMutation.isPending ? t({ ko: '테스트 실행 중...', en: 'Running test...' }) : t({ ko: '테스트 실행', en: 'Run test' })}
              </Button>

              {previewableImageOutputs.length > 0 ? (
                <Inset className="space-y-2.5 p-3">
                  <div className="text-sm font-medium text-foreground">{t({ ko: '이미지 미리보기', en: 'Image preview' })}</div>
                  <div className="grid gap-3 md:grid-cols-2">
                    {previewableImageOutputs.map((output) => (
                      <div key={output.key} className="space-y-2">
                        <div className="text-xs text-muted-foreground">{output.label}</div>
                        <img src={output.value} alt={output.label} className="max-h-56 w-full rounded-sm bg-surface-container object-contain" />
                      </div>
                    ))}
                  </div>
                </Inset>
              ) : null}

              {filePathOutputs.length > 0 ? (
                <Alert>
                  <AlertTitle>{t({ ko: '파일 경로 이미지 출력', en: 'File-path image output' })}</AlertTitle>
                  <AlertDescription>
                    <div className="space-y-1 text-sm">
                      {filePathOutputs.map((output) => (
                        <div key={output.key} className="font-mono text-xs text-muted-foreground">
                          {output.label}: {output.value}
                        </div>
                      ))}
                    </div>
                  </AlertDescription>
                </Alert>
              ) : null}

              {testResultData?.logs.length ? (
                <Inset className="space-y-2 p-3">
                  <div className="text-sm font-medium text-foreground">{t({ ko: '실행 로그', en: 'Execution logs' })}</div>
                  <div className="space-y-1 text-sm text-muted-foreground">
                    {testResultData.logs.map((logItem, index) => (
                      <div key={`${index}:${logItem.message}`}>
                        <span className="font-medium text-foreground">[{logItem.level ?? 'info'}]</span> {logItem.message}
                      </div>
                    ))}
                  </div>
                </Inset>
              ) : null}

              <Field label={t({ ko: '테스트 결과', en: 'Test result' })}>
                <Textarea variant="settings" rows={14} value={testResultText} placeholder={t({ ko: '테스트 결과가 여기에 보여.', en: 'The test result appears here.' })} readOnly />
              </Field>
          </Section>
        </div>
      </div>
    </div>
  )
}
