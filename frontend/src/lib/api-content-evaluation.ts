import type { ContentEvaluationSettings, ContentEvaluationSettingsInput } from '@conai/shared'
import { requestApiData } from './api-request'

export const CONTENT_EVALUATION_QUERY_KEY = 'content-evaluation-settings'
export const getContentEvaluationSettings = () => requestApiData<ContentEvaluationSettings>('/api/settings/content-evaluation')
export const updateContentEvaluationSettings = (input: ContentEvaluationSettingsInput) => requestApiData<ContentEvaluationSettings>('/api/settings/content-evaluation', {
  method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
})
