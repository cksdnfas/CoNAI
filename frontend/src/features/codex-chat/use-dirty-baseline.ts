import { useEffect, useState } from 'react'

/**
 * Whether an editor's value moved away from what it held right after it opened. `key` changes when the editor opens or
 * loads another item; the value one render later (after the editor's own reset) becomes the baseline.
 */
export function useDirtyBaseline(key: string, value: unknown) {
  const json = JSON.stringify(value)
  const [baseline, setBaseline] = useState<{ key: string; json: string | null }>({ key: '', json: null })
  useEffect(() => {
    if (baseline.key !== key) setBaseline({ key, json: null })
    else if (baseline.json === null) setBaseline({ key, json })
  }, [key, json, baseline])
  return baseline.key === key && baseline.json !== null && baseline.json !== json
}
