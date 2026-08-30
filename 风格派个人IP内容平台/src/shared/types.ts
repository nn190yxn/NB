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

export interface Material {
  id: number
  name: string
  format: string
  content: string
  checksum: string
  status: 'ready' | 'failed' | 'queued'
  review_status: 'pending' | 'approved' | 'rejected'
  strategy_layer: StrategyLayer
  goal_refs: string[]
  source_refs: SourceRef[]
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
