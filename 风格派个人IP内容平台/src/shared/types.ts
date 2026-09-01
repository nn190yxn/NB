export type StrategyLayer = 'reach' | 'trust' | 'conversion'

export interface IPProfile {
  role: string
  audiences: string[]
  problems: string[]
  pillars: string[]
  viewpoints: string[]
  tone_preferences: string[]
  prohibited_patterns: string[]
  source_refs: SourceRef[]
  version: number
  updated_at?: string
}

export interface SourceRef {
  type: string
  id: string | number
  captured_at: string
}

export type MaterialSourceType = 'research' | 'local_sync' | 'mobile_upload' | 'manual'
export type MaterialParseStatus = 'pending' | 'processing' | 'ready' | 'failed'

export interface Material {
  id: number
  owner_id: string
  name: string
  format: string
  content: string
  checksum: string
  status: 'ready' | 'failed' | 'queued'
  parse_status: MaterialParseStatus
  review_status: 'pending' | 'approved' | 'rejected'
  source_type: MaterialSourceType
  source_id: string | number | null
  source_path: string | null
  device_id: string | null
  source_deleted_at: string | null
  strategy_layer: StrategyLayer
  goal_refs: string[]
  source_refs: SourceRef[]
}

export interface SyncDevice {
  id: string
  owner_id: string
  name: string
  last_seen_at: string | null
}

export interface SyncDirectory {
  id: string
  owner_id: string
  device_id: string
  local_path: string
  enabled: boolean
  last_scanned_at: string | null
}

export interface SyncFile {
  id: string
  owner_id: string
  device_id: string
  directory_id: string
  relative_path: string
  checksum: string
  modified_at: string
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'failed' | 'duplicate' | 'source_deleted'
  material_id: number | null
}

export interface PrivateFile {
  id: string
  owner_id: string
  checksum: string
  original_name: string
  mime_type: string
  size: number
  storage_path: string
  created_at: string
}

export interface PerformanceSnapshot {
  id: number
  owner_id: string
  draft_id: number | null
  shooting_id: number | null
  platform: string
  published_at: string | null
  captured_at: string
  metrics: Record<string, number | null>
  screenshot_file_id: string | null
  raw_model_result: unknown
  confidence: number | null
  status: 'pending_confirmation' | 'confirmed' | 'rejected'
  corrected_fields: string[]
}

export interface VisionTask {
  id: string
  owner_id: string
  screenshot_file_ids: string[]
  status: 'pending' | 'processing' | 'ready' | 'failed'
  result: unknown
  error: string | null
  created_at: string
  updated_at: string
}

export interface ResearchItem {
  id: number
  platform: string
  title: string
  author: string
  url: string
  strategy_layer: StrategyLayer
  goal_refs: string[]
  source_refs: SourceRef[]
}

export interface TopicDraft {
  id: number
  title: string
  rationale: string
  strategy_layer: StrategyLayer
  content_job: string
  goal_refs: string[]
  source_refs: SourceRef[]
}
