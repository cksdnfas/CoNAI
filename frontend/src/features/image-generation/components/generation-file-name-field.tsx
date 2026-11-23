import { FileText } from 'lucide-react'
import { FILE_NAMING_LIMITS } from '@conai/shared'
import { IconInputField } from '@/components/common/search-field'
import { useI18n } from '@/i18n'
import { useGenerationFileName } from '../generation-file-name-store'

/** The `filename` layout block of the generation screens: the name new results are stored under. */
export function GenerationFileNameField() {
  const { t } = useI18n()
  const { fileName, setFileName } = useGenerationFileName()
  return (
    <IconInputField
      icon={FileText}
      value={fileName}
      onChange={setFileName}
      placeholder={t({ ko: '파일 이름', en: 'File name' })}
      clearLabel={t({ ko: '파일 이름 지우기', en: 'Clear file name' })}
      maxLength={FILE_NAMING_LIMITS.stemLength}
      autoComplete="off"
      spellCheck={false}
    />
  )
}
