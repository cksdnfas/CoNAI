export { default as LegacyGeneralSettings } from '../pages/Settings/components/GeneralSettings'
export { default as LegacyTaggerSettings } from '../pages/Settings/features/Tagger/TaggerSettings'
export { default as LegacyRatingScoreSettings } from '../pages/Settings/features/Rating/RatingScoreSettings'
export { default as LegacySimilaritySettings } from '../pages/Settings/features/Similarity/SimilaritySettings'
export { default as LegacyFolderSettings } from '../pages/Settings/features/Folder/FolderSettings'
export { AuthSettings as LegacyAuthSettings } from '../pages/Settings/features/Auth/AuthSettings'
export { ExternalApiSettings as LegacyExternalApiSettings } from '../pages/Settings/features/ExternalApi/ExternalApiSettings'
export { CivitaiSettings as LegacyCivitaiSettings } from '../pages/Settings/features/Civitai/CivitaiSettings'
export { PromptExplorer as LegacyPromptExplorer } from '../features/PromptExplorer/PromptExplorer'
export {
  settingsApi as legacySettingsApi,
  type AppSettings as LegacyAppSettings,
  type GeneralSettings as LegacyGeneralSettingsType,
  type MetadataExtractionSettings as LegacyMetadataExtractionSettings,
  type TaggerSettings as LegacyTaggerSettingsType,
  type ThumbnailSettings as LegacyThumbnailSettings,
} from '../services/settingsApi'
