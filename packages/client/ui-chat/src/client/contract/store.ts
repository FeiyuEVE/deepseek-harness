/** Chat-owned selection state shared by the transcript and details panel. */

import type { TurnProcessGeneration } from './turn-process.ts'
import type { FilePreviewState } from '../file-preview.ts'

/** Tool call identity as carried by Chat nodes. */
export type ToolCallId = string

/** Selection target for the Chat details linkage channel. */
export interface SelectionTarget {
  turnSeq: number
  stepSeq?: number
  callId?: ToolCallId
  toolName?: string
}

/** One manually expanded Turn answer generation. */
export interface TurnProcessViewEntry {
  readonly turn: number
  readonly generation: TurnProcessGeneration
}

/** Durable assistant message identity shared by the answer body and its tail chrome. */
export type AssistantMessageId = string

/** Per-Session state shared only by the Chat view and details surface. */
export interface ChatStoreState {
  selection: SelectionTarget | null
  turnProcesses: TurnProcessViewEntry[]
  /** Open in-page file preview; null when none is open. */
  filePreview: FilePreviewState | null
  /** Explicit per-message presentation overrides over the persisted default
   *  (true = raw source, false = rendered); absent means the default governs. */
  rawOverrides: Record<AssistantMessageId, boolean>
}
