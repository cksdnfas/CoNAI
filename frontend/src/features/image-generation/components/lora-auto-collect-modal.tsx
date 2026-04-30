import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import { SettingsField, SettingsInsetBlock, SettingsModalBody, SettingsModalFooter } from '@/features/settings/components/settings-primitives'
import { useI18n } from '@/i18n'
import type { LoraFileData, LoraScanRequest } from '@/lib/api'

type LoraAutoCollectModalProps = {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: LoraScanRequest) => Promise<void>
}

type MatchingMode = 'filename' | 'common'

type RelativeFile = File & {
  webkitRelativePath?: string
}

function splitPromptLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
}

/** Build LoRA scan records from a selected folder dump. */
async function collectLoraFilesFromSelection(
  files: RelativeFile[],
  options: {
    matchingMode: MatchingMode
    commonTextFilename: string
  },
) {
  const loraFiles: LoraFileData[] = []
  const commonTextCache = new Map<string, string[]>()
  const normalizedCommonTextFilename = options.commonTextFilename.trim()

  if (normalizedCommonTextFilename.length > 0) {
    for (const file of files) {
      if (file.name !== normalizedCommonTextFilename) {
        continue
      }

      const relativePath = file.webkitRelativePath ?? file.name
      const folderPath = relativePath.split('/').slice(0, -1).join('/')
      commonTextCache.set(folderPath, splitPromptLines(await file.text()))
    }
  }

  for (const file of files) {
    if (!file.name.endsWith('.safetensors')) {
      continue
    }

    const relativePath = file.webkitRelativePath ?? file.name
    const pathParts = relativePath.split('/')
    const folderPath = pathParts.slice(0, -1).join('/')
    const folderName = pathParts.slice(1, -1).join('/') || pathParts[0] || 'root'
    const loraName = file.name.replace(/\.safetensors$/i, '')
    const pairedTextPath = relativePath.replace(/\.safetensors$/i, '.txt')
    const pairedTextFile = files.find((candidate) => (candidate.webkitRelativePath ?? candidate.name) === pairedTextPath)
    const pairedLines = pairedTextFile ? splitPromptLines(await pairedTextFile.text()) : []
    const commonLines = commonTextCache.get(folderPath) ?? []

    const promptLines = options.matchingMode === 'common'
      ? (commonLines.length > 0 ? commonLines : pairedLines)
      : (pairedLines.length > 0 ? pairedLines : commonLines)

    loraFiles.push({
      folderName,
      loraName,
      promptLines,
    })
  }

  return loraFiles
}

export function LoraAutoCollectModal({ open, isSubmitting = false, onClose, onSubmit }: LoraAutoCollectModalProps) {
  const { t, formatNumber } = useI18n()
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedSourceFiles, setSelectedSourceFiles] = useState<RelativeFile[]>([])
  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([])
  const [loraWeight, setLoraWeight] = useState('1.0')
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number')
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('filename')
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPreparingFiles, setIsPreparingFiles] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedSourceFiles([])
    setSelectedFiles([])
    setLoraWeight('1.0')
    setDuplicateHandling('number')
    setMatchingMode('filename')
    setCommonTextFilename('add.txt')
    setFormError(null)
  }, [open])

  useEffect(() => {
    if (!inputRef.current) {
      return
    }

    inputRef.current.setAttribute('webkitdirectory', '')
    inputRef.current.setAttribute('directory', '')
  }, [open])

  const previewSummary = useMemo(() => selectedFiles.slice(0, 5), [selectedFiles])

  const buildSelectedFiles = useCallback(async (files: RelativeFile[], overrides?: { matchingMode?: MatchingMode; commonTextFilename?: string }) => {
    return collectLoraFilesFromSelection(files, {
      matchingMode: overrides?.matchingMode ?? matchingMode,
      commonTextFilename: overrides?.commonTextFilename ?? commonTextFilename,
    })
  }, [commonTextFilename, matchingMode])

  const rebuildSelectedFiles = useCallback(async (files: RelativeFile[], overrides?: { matchingMode?: MatchingMode; commonTextFilename?: string }) => {
    setIsPreparingFiles(true)
    setFormError(null)

    try {
      const nextFiles = await buildSelectedFiles(files, overrides)
      setSelectedFiles(nextFiles)
      return nextFiles
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t({ ko: '폴더 파일을 읽는 중 오류가 났어.', en: 'An error occurred while reading the folder files.' }))
      setSelectedFiles([])
      return []
    } finally {
      setIsPreparingFiles(false)
    }
  }, [buildSelectedFiles, t])

  const handlePickFolder = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as RelativeFile[]
    if (files.length === 0) {
      return
    }

    setSelectedSourceFiles(files)
    await rebuildSelectedFiles(files)
    event.target.value = ''
  }

  const handleMatchingModeChange = (nextMode: MatchingMode) => {
    setMatchingMode(nextMode)
    if (selectedSourceFiles.length > 0) {
      void rebuildSelectedFiles(selectedSourceFiles, { matchingMode: nextMode })
    }
  }

  const handleCommonTextFilenameChange = (nextFilename: string) => {
    setCommonTextFilename(nextFilename)
    if (selectedSourceFiles.length > 0) {
      void rebuildSelectedFiles(selectedSourceFiles, { commonTextFilename: nextFilename })
    }
  }

  const handleSubmit = async () => {
    if (selectedSourceFiles.length === 0) {
      setFormError(t({ ko: '먼저 LoRA 폴더를 골라줘.', en: 'Choose a LoRA folder first.' }))
      return
    }

    const parsedWeight = Number(loraWeight)
    if (!Number.isFinite(parsedWeight) || parsedWeight < 0.1 || parsedWeight > 2.0) {
      setFormError(t({ ko: 'LoRA weight는 0.1에서 2.0 사이여야 해.', en: 'LoRA weight must be between 0.1 and 2.0.' }))
      return
    }

    setFormError(null)
    setIsPreparingFiles(true)

    try {
      const nextFiles = await buildSelectedFiles(selectedSourceFiles)
      setSelectedFiles(nextFiles)

      if (nextFiles.length === 0) {
        setFormError(t({ ko: '선택한 폴더에서 LoRA 파일을 찾지 못했어.', en: 'Could not find LoRA files in the selected folder.' }))
        return
      }

      await onSubmit({
        loraFiles: nextFiles,
        loraWeight: parsedWeight,
        duplicateHandling,
        matchingMode,
        commonTextFilename,
      })
    } catch (error) {
      setFormError(error instanceof Error ? error.message : t({ ko: '자동 수집 준비 중 오류가 났어.', en: 'An error occurred while preparing auto-collection.' }))
    } finally {
      setIsPreparingFiles(false)
    }
  }

  return (
    <SettingsModal
      open={open}
      onClose={() => {
        if (!isSubmitting && !isPreparingFiles) {
          onClose()
        }
      }}
      title={t({ ko: 'LoRA 자동 수집', en: 'LoRA auto-collection' })}
      description={t({ ko: '폴더 덤프를 읽어서 자동 수집용 LoRA 와일드카드 트리를 다시 만들자.', en: 'Read a folder dump and rebuild the LoRA wildcard tree for auto-collection.' })}
      widthClassName="max-w-3xl"
    >
      <SettingsModalBody className="space-y-5">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>{t({ ko: '수집 준비 실패', en: 'Collection preparation failed' })}</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <SettingsInsetBlock className="text-sm text-muted-foreground">
          {t({ ko: '선택한 폴더 안의 `.safetensors`, 같은 이름의 `.txt`, 그리고 지정한 공용 텍스트 파일을 읽어서 auto-collected LoRA 트리를 다시 만든다.', en: 'Reads `.safetensors`, same-name `.txt`, and the configured shared text file inside the selected folder, then rebuilds the auto-collected LoRA tree.' })}
        </SettingsInsetBlock>

        <input ref={inputRef} type="file" className="hidden" multiple onChange={(event) => void handleFileChange(event)} />

        <div className="space-y-3 rounded-sm border border-border bg-surface-low p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handlePickFolder} disabled={isSubmitting || isPreparingFiles}>
              <FolderOpen className="h-4 w-4" />
              {selectedFiles.length > 0 ? t({ ko: 'LoRA {count}개 선택됨', en: '{count} LoRA files selected' }, { count: formatNumber(selectedFiles.length) }) : t({ ko: 'LoRA 폴더 선택', en: 'Select LoRA folder' })}
            </Button>
            {isPreparingFiles ? <div className="text-sm text-muted-foreground">{t({ ko: '폴더 구조 읽는 중…', en: 'Reading folder structure…' })}</div> : null}
          </div>

          {selectedFiles.length > 0 ? (
            <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">{t({ ko: 'LoRA 파일 {count}개를 찾았어.', en: 'Found {count} LoRA files.' }, { count: formatNumber(selectedFiles.length) })}</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {previewSummary.map((file) => (
                  <li key={`${file.folderName}/${file.loraName}`}>
                    <span className="font-medium text-foreground">{file.loraName}</span>
                    <span className="text-muted-foreground"> · {file.folderName || 'root'}</span>
                    {file.promptLines.length > 0 ? <span className="text-muted-foreground"> · {t({ ko: '프롬프트 {count}줄', en: '{count} prompt lines' }, { count: formatNumber(file.promptLines.length) })}</span> : null}
                  </li>
                ))}
                {selectedFiles.length > previewSummary.length ? <li>{t({ ko: '외 {count}개 더 있어.', en: '{count} more.' }, { count: formatNumber(selectedFiles.length - previewSummary.length) })}</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '기본 LoRA weight', en: 'Default LoRA weight' })}>
            <Input type="number" min="0.1" max="2.0" step="0.1" value={loraWeight} onChange={(event) => setLoraWeight(event.target.value)} />
          </SettingsField>

          <SettingsField label={t({ ko: '중복 이름 처리', en: 'Duplicate name handling' })}>
            <Select value={duplicateHandling} onChange={(event) => setDuplicateHandling(event.target.value as 'number' | 'parent')}>
              <option value="number">{t({ ko: '숫자 suffix 붙이기', en: 'Append numeric suffix' })}</option>
              <option value="parent">{t({ ko: '부모 경로 이름 붙이기', en: 'Append parent path name' })}</option>
            </Select>
          </SettingsField>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <SettingsField label={t({ ko: '프롬프트 매칭 모드', en: 'Prompt matching mode' })}>
            <Select value={matchingMode} onChange={(event) => handleMatchingModeChange(event.target.value as MatchingMode)}>
              <option value="filename">{t({ ko: '개별 txt 먼저, 없으면 공용 txt', en: 'Individual txt first, then shared txt' })}</option>
              <option value="common">{t({ ko: '공용 txt 먼저, 없으면 개별 txt', en: 'Shared txt first, then individual txt' })}</option>
            </Select>
          </SettingsField>

          <SettingsField label={t({ ko: '공용 txt 파일명', en: 'Shared txt filename' })}>
            <Input value={commonTextFilename} onChange={(event) => handleCommonTextFilenameChange(event.target.value)} placeholder={t({ ko: '예: add.txt', en: 'e.g. add.txt' })} />
          </SettingsField>
        </div>

        <SettingsInsetBlock className="text-sm text-muted-foreground">
          {t({ ko: '실행하면 기존 auto-collected LoRA 항목은 지워지고, 이번 폴더 기준으로 다시 생성된다.', en: 'Running this removes existing auto-collected LoRA entries and recreates them from this folder.' })}
        </SettingsInsetBlock>

        <SettingsModalFooter>
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting || isPreparingFiles}>
            {t({ ko: '취소', en: 'Cancel' })}
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isPreparingFiles || selectedSourceFiles.length === 0}>
            <Upload className="h-4 w-4" />
            {isSubmitting ? t({ ko: '수집 중…', en: 'Collecting…' }) : t({ ko: '자동 수집 실행', en: 'Run auto-collection' })}
          </Button>
        </SettingsModalFooter>
      </SettingsModalBody>
    </SettingsModal>
  )
}
