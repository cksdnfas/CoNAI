import { requestJson } from './api-image-generation-request'
import type {
  NAICostEstimate,
  NAIEncodeVibePayload,
  NAIEncodeVibeResponse,
  NAIImageGenerationPayload,
  NAIImageGenerationResponse,
  NAILoginResponse,
  NAIUpscalePayload,
  NAIUpscaleResponse,
  NAIUserData,
  StoredNaiCharacterReferenceAsset,
  StoredNaiVibeAsset,
} from './api-image-generation-types'

interface NAICostEstimateResponse extends NAICostEstimate {}

/** Login to NovelAI with username/password and store the returned token on the backend. */
export async function loginNai(username: string, password: string) {
  return requestJson<NAILoginResponse>('/api/nai/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ username, password }),
  })
}

/** Validate and store a NovelAI access token on the backend. */
export async function loginNaiWithToken(token: string) {
  return requestJson<NAILoginResponse>('/api/nai/auth/login-with-token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ token }),
  })
}

/** Load NovelAI account info using the backend-stored token. */
export async function getNaiUserData() {
  return requestJson<NAIUserData>('/api/nai/user/data')
}

/** Calculate the expected NovelAI generation cost for the current settings. */
export async function getNaiCostEstimate(payload: {
  width: number
  height: number
  steps: number
  n_samples: number
  subscriptionTier: number
  anlasBalance: number
}) {
  return requestJson<NAICostEstimateResponse>('/api/nai/cost/calculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Start a NovelAI image generation request. */
export async function generateNaiImage(payload: NAIImageGenerationPayload) {
  return requestJson<NAIImageGenerationResponse>('/api/nai/generate/image', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Encode one image into a reusable NovelAI vibe payload. */
export async function encodeNaiVibe(payload: NAIEncodeVibePayload) {
  return requestJson<NAIEncodeVibeResponse>('/api/nai/generate/encode-vibe', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Upscale one image through NovelAI and return the generated PNG bytes as base64. */
export async function upscaleNaiImage(payload: NAIUpscalePayload) {
  return requestJson<NAIUpscaleResponse>('/api/nai/generate/upscale', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load saved reusable vibe-transfer assets. */
export async function listNaiVibeAssets(model?: string) {
  const searchParams = new URLSearchParams()
  if (model) {
    searchParams.set('model', model)
  }

  const response = await requestJson<{ items: StoredNaiVibeAsset[] }>(`/api/nai/store/vibes${searchParams.size > 0 ? `?${searchParams.toString()}` : ''}`)
  return response.items
}

/** Load one saved vibe-transfer asset with its full encoded payload. */
export async function getNaiVibeAsset(assetId: string) {
  return requestJson<StoredNaiVibeAsset>(`/api/nai/store/vibes/${assetId}`)
}

/** Save one reusable vibe-transfer asset for later use. */
export async function saveNaiVibeAsset(payload: {
  label?: string
  description?: string
  model: string
  image?: string
  encoded: string
  strength?: number
  information_extracted?: number
}) {
  return requestJson<StoredNaiVibeAsset>('/api/nai/store/vibes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one saved vibe-transfer asset. */
export async function deleteNaiVibeAsset(assetId: string) {
  return requestJson<{ success: boolean }>(`/api/nai/store/vibes/${assetId}`, {
    method: 'DELETE',
  })
}

/** Update one saved vibe-transfer asset. */
export async function updateNaiVibeAsset(assetId: string, payload: {
  label: string
  description?: string
}) {
  return requestJson<StoredNaiVibeAsset>(`/api/nai/store/vibes/${assetId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Load saved character-reference assets. */
export async function listNaiCharacterReferenceAssets() {
  const response = await requestJson<{ items: StoredNaiCharacterReferenceAsset[] }>('/api/nai/store/character-references')
  return response.items
}

/** Save one reusable character-reference asset. */
export async function saveNaiCharacterReferenceAsset(payload: {
  label?: string
  description?: string
  image: string
  type?: 'character' | 'style' | 'character&style'
  strength?: number
  fidelity?: number
}) {
  return requestJson<StoredNaiCharacterReferenceAsset>('/api/nai/store/character-references', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}

/** Delete one saved character-reference asset. */
export async function deleteNaiCharacterReferenceAsset(assetId: string) {
  return requestJson<{ success: boolean }>(`/api/nai/store/character-references/${assetId}`, {
    method: 'DELETE',
  })
}

/** Update one saved character-reference asset. */
export async function updateNaiCharacterReferenceAsset(assetId: string, payload: {
  label: string
  description?: string
}) {
  return requestJson<StoredNaiCharacterReferenceAsset>(`/api/nai/store/character-references/${assetId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  })
}
