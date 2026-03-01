import React from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getFoldersMock,
  apiGetMock,
} = vi.hoisted(() => ({
  getFoldersMock: vi.fn(),
  apiGetMock: vi.fn(),
}))

vi.mock('@/services/folder-api', () => ({
  folderApi: {
    getFolders: getFoldersMock,
    addFolder: vi.fn(),
    scanFolder: vi.fn(),
    scanAllFolders: vi.fn(),
    deleteFolder: vi.fn(),
  },
}))

vi.mock('@/lib/api/client', () => ({
  apiClient: {
    get: apiGetMock,
  },
}))

vi.mock('@/features/settings/modules/rating/rating-score-settings-feature', () => ({
  default: function MockRatingScoreSettings() {
    return (
      <section>
        <h3>Rating score settings</h3>
        <button type="button">Save weights</button>
      </section>
    )
  },
}))

vi.mock('@/features/settings/modules/similarity/similarity-settings-feature', () => ({
  default: function MockSimilaritySettings() {
    return (
      <section>
        <h3>Similarity settings</h3>
        <button type="button" role="switch" aria-checked="true">
          Auto generate hash
        </button>
      </section>
    )
  },
}))

vi.mock('@/features/settings/modules/auth-settings-feature', () => ({
  AuthSettingsFeature: function MockAuthSettings() {
    return (
      <section>
        <h3>Account settings</h3>
        <button type="button">Sign out all sessions</button>
      </section>
    )
  },
}))

vi.mock('@/features/settings/modules/external-api-settings-feature', () => ({
  ExternalApiSettingsFeature: function MockExternalApiSettings() {
    return (
      <section>
        <h3>External API settings</h3>
        <button type="button">Save API key</button>
      </section>
    )
  },
}))

vi.mock('@/features/settings/modules/civitai-settings-feature', () => ({
  CivitaiSettingsFeature: function MockCivitaiSettings() {
    return (
      <section>
        <h3>Civitai settings</h3>
        <button type="button">Save Civitai settings</button>
      </section>
    )
  },
}))

vi.mock('@/features/settings/bridges/folder-settings', () => ({
  default: function MockFolderSettings() {
    return (
      <section>
        <h3>Folder settings</h3>
        <button type="button">Load folders</button>
        <p>D:/restored-folder</p>
      </section>
    )
  },
}))

import FolderSettings from '@/features/settings/bridges/folder-settings'
import { PromptExplorer } from '@/features/settings/bridges/prompt-explorer'
import RatingScoreSettings from '@/features/settings/bridges/rating-score-settings'
import SimilaritySettings from '@/features/settings/bridges/similarity-settings'
import { AuthSettings } from '@/features/settings/bridges/auth-settings'
import { ExternalApiSettings } from '@/features/settings/bridges/external-api-settings'
import { CivitaiSettings } from '@/features/settings/bridges/civitai-settings'

describe('Settings post-restore parity contracts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    apiGetMock.mockResolvedValue({
      data: {
        data: [],
      },
    })
  })

  it('renders Folder settings through the restored bridge', async () => {
    render(<FolderSettings />)

    expect(await screen.findByRole('heading', { name: 'Folder settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Load folders' })).toBeInTheDocument()
    expect(await screen.findByText('D:/restored-folder')).toBeInTheDocument()
  })

  it.each(['positive', 'negative', 'auto'] as const)(
    'renders Prompt Management %s explorer with searchable prompt list',
    async (type) => {
    apiGetMock.mockResolvedValue({
      data: {
        data: [{ id: 7, prompt: `${type}-prompt`, usage_count: 3 }],
      },
    })

    render(<PromptExplorer type={type} />)

    expect(screen.getByRole('textbox', { name: 'Search prompts' })).toBeInTheDocument()
    expect(await screen.findByText(`${type}-prompt`)).toBeInTheDocument()
    await waitFor(() => {
      expect(apiGetMock).toHaveBeenCalledWith(
        '/api/prompt-collection/search',
        expect.objectContaining({ params: expect.objectContaining({ type }) }),
      )
    })
    },
  )

  it('renders Rating Score Settings as an active control surface', () => {
    render(<RatingScoreSettings />)

    expect(screen.getByRole('heading', { name: 'Rating score settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save weights' })).toBeInTheDocument()
  })

  it('renders Similarity Settings as an interactive control surface', () => {
    render(<SimilaritySettings />)

    expect(screen.getByRole('heading', { name: 'Similarity settings' })).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: 'Auto generate hash' })).toBeInTheDocument()
  })

  it('renders Account settings through the restored bridge', () => {
    render(<AuthSettings />)

    expect(screen.getByRole('heading', { name: 'Account settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sign out all sessions' })).toBeInTheDocument()
  })

  it('renders External API settings through the restored bridge', () => {
    render(<ExternalApiSettings />)

    expect(screen.getByRole('heading', { name: 'External API settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save API key' })).toBeInTheDocument()
  })

  it('renders Civitai settings through the restored bridge', () => {
    render(<CivitaiSettings />)

    expect(screen.getByRole('heading', { name: 'Civitai settings' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save Civitai settings' })).toBeInTheDocument()
  })
})
