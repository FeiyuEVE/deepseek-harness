/** Chat transcript preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the Chat target. */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** Field carrying the completed-Turn transcript presentation mode. */
export const TRANSCRIPT_VIEW_FIELD = 'transcriptView'

/** Transcript presentation modes accepted at settings boundaries. */
export const TRANSCRIPT_VIEW_MODES = ['normal', 'compact'] as const

/** Completed-Turn transcript presentation. */
export type TranscriptViewMode = typeof TRANSCRIPT_VIEW_MODES[number]

/** Default preserves the compact process disclosure introduced by Chat. */
export const DEFAULT_TRANSCRIPT_VIEW_MODE: TranscriptViewMode = 'compact'

/** Field carrying the assistant-Markdown presentation mode. */
export const MARKDOWN_VIEW_FIELD = 'markdownView'

/** Assistant-Markdown presentation modes accepted at settings boundaries. */
export const MARKDOWN_VIEW_MODES = ['render', 'raw'] as const

/** Assistant-Markdown presentation. */
export type MarkdownViewMode = typeof MARKDOWN_VIEW_MODES[number]

/** The rendered document is the default; raw source stays one toggle away. */
export const DEFAULT_MARKDOWN_VIEW_MODE: MarkdownViewMode = 'render'

/** Durable Chat section shared by the Host schema and browser scope. */
export interface ChatSettings {
  /** Presentation mode for completed Turn process content. */
  transcriptView: TranscriptViewMode
  /** Presentation mode for assistant Markdown text blocks. */
  markdownView: MarkdownViewMode
}

/** Durable Chat schema; also the wire envelope the browser scope validates against. */
export const ChatSettingsSchema: z<ChatSettings> = z.object({
  [TRANSCRIPT_VIEW_FIELD]: z.union([...TRANSCRIPT_VIEW_MODES]).default(DEFAULT_TRANSCRIPT_VIEW_MODE),
  [MARKDOWN_VIEW_FIELD]: z.union([...MARKDOWN_VIEW_MODES]).default(DEFAULT_MARKDOWN_VIEW_MODE),
})
