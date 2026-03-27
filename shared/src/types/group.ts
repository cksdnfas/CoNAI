/**
 * Group-related type definitions
 * Shared between backend and frontend
 */

import type { ComplexFilter } from './filter';

export interface GroupRecord {
  id: number;
  name: string;
  description?: string;
  color?: string;
  parent_id?: number | null;
  created_date: string;
  updated_date: string;

  // Auto-collection fields
  auto_collect_enabled: boolean;
  auto_collect_conditions?: string;  // JSON string (legacy format or ComplexFilter)
  auto_collect_last_run?: string;
}

export interface ImageGroupRecord {
  id: number;
  group_id: number;
  image_id: number;
  added_date: string;
  order_index: number;

  // Auto-collection type field
  collection_type: 'manual' | 'auto';
  auto_collected_date?: string;
}

export interface AutoCollectCondition {
  type: 'prompt_contains' | 'prompt_regex' |
        'negative_prompt_contains' | 'negative_prompt_regex' |
        'ai_tool' | 'model_name' |
        // Auto-tag related conditions
        'auto_tag_rating' | 'auto_tag_general' |
        'auto_tag_character' | 'auto_tag_model' |
        'auto_tag_has_character' | 'auto_tag_exists' |
        'auto_tag_rating_score' |  // Weighted rating score condition
        // Image similarity/duplicate detection conditions
        'duplicate_exact' |        // Exact duplicate (Hamming distance = 0)
        'duplicate_near' |         // Near duplicate (Hamming distance ≤ 5)
        'duplicate_similar' |      // Similar images (Hamming distance ≤ 15)
        'duplicate_custom';        // Custom Hamming distance threshold
  value: string | number | boolean;
  case_sensitive?: boolean;
  exact_match?: boolean;  // Exact word matching (for contains conditions)

  // Auto-tag additional fields
  min_score?: number;  // Min score (rating: 0.0 ~ 1.0, rating_score: weighted score)
  max_score?: number;  // Max score (rating: 0.0 ~ 1.0, rating_score: weighted score)
  rating_type?: 'general' | 'sensitive' | 'questionable' | 'explicit';  // For rating condition

  // Duplicate detection fields
  hamming_threshold?: number;  // Custom Hamming distance threshold (0-64, for duplicate_custom type)
}

export interface GroupCreateData {
  name: string;
  description?: string;
  color?: string;
  parent_id?: number | null;
  auto_collect_enabled?: boolean;
  auto_collect_conditions?: AutoCollectCondition[] | ComplexFilter;  // Support both formats
}

export interface GroupUpdateData {
  name?: string;
  description?: string;
  color?: string;
  parent_id?: number | null;
  auto_collect_enabled?: boolean;
  auto_collect_conditions?: AutoCollectCondition[] | ComplexFilter;  // Support both formats
}

export interface GroupWithStats extends GroupRecord {
  image_count: number;
  auto_collected_count: number;
  manual_added_count: number;
}

export interface GroupResponse {
  success: boolean;
  data?: any;
  error?: string;
}

export interface AutoCollectResult {
  group_id: number;
  group_name: string;
  images_added: number;
  images_removed: number;
  execution_time: number;
}

// ===== Hierarchy-related types =====

/**
 * Group with hierarchy information
 */
export interface GroupWithHierarchy extends GroupWithStats {
  child_count: number;
  has_children: boolean;
  depth?: number;
}

/**
 * Breadcrumb item for navigation
 */
export interface BreadcrumbItem {
  id: number;
  name: string;
  color?: string | null;
}

/**
 * Hierarchy validation result
 */
export interface HierarchyValidation {
  valid: boolean;
  error?: string;
  current_depth?: number;
  max_depth?: number;
}

/**
 * Group move request
 */
export interface GroupMoveRequest {
  parent_id: number | null;
}
