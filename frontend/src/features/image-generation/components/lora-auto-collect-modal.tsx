import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { FolderOpen, Upload } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { SettingsModal } from '@/features/settings/components/settings-modal'
import type { LoraFileData, LoraScanRequest } from '@/lib/api'

type LoraAutoCollectModalProps = {
  open: boolean
  isSubmitting?: boolean
  onClose: () => void
  onSubmit: (input: LoraScanRequest) => Promise<void>
}

type MatchingMode = 'filename' | 'common'

type MatchingPriority = 'filename' | 'common'

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
    matchingPriority: MatchingPriority
  },
) {
  const loraFiles: LoraFileData[] = []
  const commonTextCache = new Map<string, string[]>()

  if (options.matchingMode === 'common') {
    for (const file of files) {
      if (file.name !== options.commonTextFilename) {
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

    let promptLines: string[] = []
    const commonLines = commonTextCache.get(folderPath) ?? []

    if (options.matchingMode === 'filename') {
      promptLines = pairedTextFile ? splitPromptLines(await pairedTextFile.text()) : []
    } else if (options.matchingPriority === 'common') {
      promptLines = commonLines.length > 0
        ? commonLines
        : pairedTextFile
          ? splitPromptLines(await pairedTextFile.text())
          : []
    } else {
      promptLines = pairedTextFile
        ? splitPromptLines(await pairedTextFile.text())
        : commonLines
    }

    loraFiles.push({
      folderName,
      loraName,
      promptLines,
    })
  }

  return loraFiles
}

export function LoraAutoCollectModal({ open, isSubmitting = false, onClose, onSubmit }: LoraAutoCollectModalProps) {
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [selectedFiles, setSelectedFiles] = useState<LoraFileData[]>([])
  const [loraWeight, setLoraWeight] = useState('1.0')
  const [duplicateHandling, setDuplicateHandling] = useState<'number' | 'parent'>('number')
  const [matchingMode, setMatchingMode] = useState<MatchingMode>('filename')
  const [commonTextFilename, setCommonTextFilename] = useState('add.txt')
  const [matchingPriority, setMatchingPriority] = useState<MatchingPriority>('filename')
  const [formError, setFormError] = useState<string | null>(null)
  const [isPreparingFiles, setIsPreparingFiles] = useState(false)

  useEffect(() => {
    if (!open) {
      return
    }

    setSelectedFiles([])
    setLoraWeight('1.0')
    setDuplicateHandling('number')
    setMatchingMode('filename')
    setCommonTextFilename('add.txt')
    setMatchingPriority('filename')
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

  const handlePickFolder = () => {
    inputRef.current?.click()
  }

  const handleFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []) as RelativeFile[]
    if (files.length === 0) {
      return
    }

    setIsPreparingFiles(true)
    setFormError(null)

    try {
      const nextFiles = await collectLoraFilesFromSelection(files, {
        matchingMode,
        commonTextFilename,
        matchingPriority,
      })
      setSelectedFiles(nextFiles)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : '폴더 파일을 읽는 중 오류가 났어.')
      setSelectedFiles([])
    } finally {
      setIsPreparingFiles(false)
      event.target.value = ''
    }
  }

  const handleSubmit = async () => {
    if (selectedFiles.length === 0) {
      setFormError('먼저 LoRA 폴더를 골라줘.')
      return
    }

    const parsedWeight = Number(loraWeight)
    if (!Number.isFinite(parsedWeight) || parsedWeight < 0.1 || parsedWeight > 2.0) {
      setFormError('LoRA weight는 0.1에서 2.0 사이여야 해.')
      return
    }

    setFormError(null)
    await onSubmit({
      loraFiles: selectedFiles,
      loraWeight: parsedWeight,
      duplicateHandling,
      matchingMode,
      commonTextFilename,
      matchingPriority,
    })
  }

  return (
    <SettingsModal
      open={open}
      onClose={() => {
        if (!isSubmitting && !isPreparingFiles) {
          onClose()
        }
      }}
      title="LoRA 자동 수집"
      description="폴더 덤프를 읽어서 자동 수집용 LoRA 와일드카드 트리를 다시 만들자."
      widthClassName="max-w-3xl"
    >
      <div className="space-y-5">
        {formError ? (
          <Alert variant="destructive">
            <AlertTitle>수집 준비 실패</AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        ) : null}

        <Alert>
          <AlertTitle>동작 방식</AlertTitle>
          <AlertDescription>
            선택한 폴더 안의 `.safetensors`와 짝이 되는 `.txt` 또는 공용 텍스트 파일을 읽어서 auto-collected LoRA 트리를 다시 만든다.
          </AlertDescription>
        </Alert>

        <input ref={inputRef} type="file" className="hidden" multiple onChange={(event) => void handleFileChange(event)} />

        <div className="space-y-3 rounded-sm border border-border bg-surface-container p-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={handlePickFolder} disabled={isSubmitting || isPreparingFiles}>
              <FolderOpen className="h-4 w-4" />
              {selectedFiles.length > 0 ? `LoRA ${selectedFiles.length}개 선택됨` : 'LoRA 폴더 선택'}
            </Button>
            {isPreparingFiles ? <div className="text-sm text-muted-foreground">폴더 구조 읽는 중…</div> : null}
          </div>

          {selectedFiles.length > 0 ? (
            <div className="rounded-sm border border-emerald-500/30 bg-emerald-500/10 p-3 text-sm text-muted-foreground">
              <div className="font-medium text-foreground">LoRA 파일 {selectedFiles.length}개를 찾았어.</div>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {previewSummary.map((file) => (
                  <li key={`${file.folderName}/${file.loraName}`}>
                    <span className="font-medium text-foreground">{file.loraName}</span>
                    <span className="text-muted-foreground"> · {file.folderName || 'root'}</span>
                    {file.promptLines.length > 0 ? <span className="text-muted-foreground"> · 프롬프트 {file.promptLines.length}줄</span> : null}
                  </li>
                ))}
                {selectedFiles.length > previewSummary.length ? <li>외 {selectedFiles.length - previewSummary.length}개 더 있어.</li> : null}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">기본 LoRA weight</p>
            <Input type="number" min="0.1" max="2.0" step="0.1" value={loraWeight} onChange={(event) => setLoraWeight(event.target.value)} />
            <p className="text-xs text-muted-foreground">생성되는 auto-collected 항목에 기본으로 박을 weight 값.</p>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">중복 이름 처리</p>
            <Select value={duplicateHandling} onChange={(event) => setDuplicateHandling(event.target.value as 'number' | 'parent')}>
              <option value="number">숫자 suffix 붙이기</option>
              <option value="parent">부모 경로 이름 붙이기</option>
            </Select>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">프롬프트 매칭 모드</p>
            <Select value={matchingMode} onChange={(event) => setMatchingMode(event.target.value as MatchingMode)}>
              <option value="filename">같은 이름의 txt 우선</option>
              <option value="common">공용 txt 허용</option>
            </Select>
          </div>

          {matchingMode === 'common' ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">공용 txt 파일명</p>
              <Input value={commonTextFilename} onChange={(event) => setCommonTextFilename(event.target.value)} placeholder="예: add.txt" />
            </div>
          ) : null}
        </div>

        {matchingMode === 'common' ? (
          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">우선순위</p>
            <Select value={matchingPriority} onChange={(event) => setMatchingPriority(event.target.value as MatchingPriority)}>
              <option value="filename">개별 txt 먼저, 없으면 공용 txt</option>
              <option value="common">공용 txt 먼저, 없으면 개별 txt</option>
            </Select>
          </div>
        ) : null}

        <Alert>
          <AlertTitle>주의</AlertTitle>
          <AlertDescription>
            실행하면 기존 auto-collected LoRA 항목은 지워지고, 이번 폴더 기준으로 다시 생성된다.
          </AlertDescription>
        </Alert>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/70 pt-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting || isPreparingFiles}>
            취소
          </Button>
          <Button type="button" onClick={() => void handleSubmit()} disabled={isSubmitting || isPreparingFiles || selectedFiles.length === 0}>
            <Upload className="h-4 w-4" />
            {isSubmitting ? '수집 중…' : '자동 수집 실행'}
          </Button>
        </div>
      </div>
    </SettingsModal>
  )
}
