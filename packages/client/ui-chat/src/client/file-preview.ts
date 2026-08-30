/** In-page file preview state and the Session Remote chunk reader. */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionReadWorkspaceFileRequest,
  SessionReadWorkspaceFileValue,
} from '@deepseek-ai/dsh-api-session-controller/types'

/** Chunk reader bound to the Session Remote, supplied through the Chat inject face. */
export type WorkspaceFileReader = (
  request: SessionReadWorkspaceFileRequest,
  signal: AbortSignal,
) => Promise<RemoteResult<SessionReadWorkspaceFileValue>>

/** Which file the Chat view previews, stored on the shared Chat store. */
export interface FilePreviewState {
  /** Absolute Host path, resolved against the Session workspace. */
  readonly path: string
}
