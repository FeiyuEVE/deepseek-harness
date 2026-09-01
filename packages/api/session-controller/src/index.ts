/** Session Remote owner: cold reads, explicit Agent commands, and live control state. */

import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { extname } from 'node:path'
import type {} from '@deepseek-ai/dsh-fs'
import { errorChain } from '@deepseek-ai/dsh-llm'
import { canOpenNativePath, openNativePath } from '@deepseek-ai/dsh-native-command'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionInspection } from '@deepseek-ai/dsh-session-persistence'
import type { SessionObservation } from '@deepseek-ai/dsh-session-query'
import { Remote, RemoteError, TypertRemoteFailure, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { bytesToBase64 } from '@deepseek-ai/dsh-util-crypto'
import {
  ApiSessionAgentController,
  inspectApiSession,
  type ApiSessionAgentResult,
} from './agent.ts'
import { SessionCommandController } from './commands.ts'
import { SessionControlController } from './control.ts'
import { SessionHistoryController } from './history.ts'
import { SessionFileReferences } from './file-references.ts'
import { ApiSessionList, DEFAULT_COLD_BLANK_PROBE_MAX_BYTES } from './list.ts'
import { buildModelCatalog } from './catalog.ts'
import { installModelSelectionProjection } from './model-selection-projection.ts'
import { SessionSkillCatalog } from './skill-catalog.ts'
import type {
  ModelCatalog,
  SessionAttachmentRequest,
  SessionAttachmentValue,
  SessionCancelRequest,
  SessionCancelValue,
  SessionControlFrame,
  SessionCreateRequest,
  SessionCreateValue,
  SessionFollowFrame,
  SessionFollowRequest,
  SessionForkRequest,
  SessionForkValue,
  SessionListRequest,
  SessionListValue,
  SessionOpenWorkspacePathRequest,
  SessionOpenWorkspacePathValue,
  SessionPage,
  SessionPageRequest,
  SessionPromptRequest,
  SessionPromptValue,
  SessionReadWorkspaceFileBinaryRequest,
  SessionReadWorkspaceFileBinaryValue,
  SessionReadWorkspaceFileRequest,
  SessionReadWorkspaceFileValue,
  SessionRenameRequest,
  SessionRenameValue,
  SessionSearchRequest,
  SessionSearchValue,
  SessionSelectModelRequest,
  SessionSelectModelValue,
  SessionUpdateQueueRequest,
  SessionUpdateQueueValue,
} from './types.ts'

export type * from './types.ts'
export { ApiSessionNotFound } from './agent.ts'
export { SessionFileReferences } from './file-references.ts'
export { SessionSkillCatalog } from './skill-catalog.ts'

/** Default and maximum bytes returned by one `readWorkspaceFile` call. */
export const DEFAULT_WORKSPACE_FILE_CHUNK_BYTES = 256 * 1024

/** Default and maximum bytes returned by one `readWorkspaceFileBinary` image. */
export const DEFAULT_WORKSPACE_IMAGE_MAX_BYTES = 8 * 1024 * 1024

/** Leading bytes scanned for NUL to classify a file as binary. */
const BINARY_SAMPLE_BYTES = 8192

/** Extensions rendered as markdown by preview surfaces. */
const MARKDOWN_EXTENSIONS = new Set(['.md', '.markdown', '.mdx'])

/** Extensions rendered as structured JSON by preview surfaces. */
const JSON_EXTENSIONS = new Set(['.json', '.jsonc'])

/** Extensions rendered as structured YAML by preview surfaces. */
const YAML_EXTENSIONS = new Set(['.yaml', '.yml'])

/** Extensions rendered with code highlighting by preview surfaces. */
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.css', '.dart', '.go', '.h', '.hpp', '.html', '.java',
  '.js', '.jsx', '.kt', '.kts', '.lua', '.php', '.proto', '.py', '.rb', '.rs', '.scss',
  '.sh', '.sql', '.svelte', '.swift', '.toml', '.ts', '.tsx', '.vue', '.xml', '.zsh',
])

/** Browser-renderable image extensions served by `readWorkspaceFileBinary`. */
const WORKSPACE_IMAGE_EXTENSIONS = new Set([
  '.apng', '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.svgz',
  '.webp',
])

/** Media types for {@link WORKSPACE_IMAGE_EXTENSIONS}; unknown leaves the file unservable. */
const WORKSPACE_IMAGE_MEDIA_TYPES: Record<string, string> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.svgz': 'image/svg+xml',
  '.webp': 'image/webp',
}

/** Whether a path is absolute in Host filesystem syntax. */
function isHostAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[A-Za-z]:[\\/]/.test(path)
}

/** Decode a byte range as UTF-8, replacing stray bytes at range edges. */
function decodeTextLenient(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

/** Best-effort preview class of a file from its extension. */
function kindOfWorkspaceFile(path: string): SessionReadWorkspaceFileValue['kind'] {
  const extension = extname(path).toLowerCase()
  if (MARKDOWN_EXTENSIONS.has(extension)) return 'markdown'
  if (JSON_EXTENSIONS.has(extension)) return 'json'
  if (YAML_EXTENSIONS.has(extension)) return 'yaml'
  if (CODE_EXTENSIONS.has(extension)) return 'code'
  return 'text'
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Host Session business API and Remote namespace owner. */
    sessionController: SessionController
  }
}

/** Session Controller deployment policy. */
export interface Config {
  /** Maximum cold Session artifact size eligible for one full projection observation. */
  readonly coldBlankProbeMaxBytes?: number
  /** Override platform desktop-opener detection. */
  readonly nativeOpen?: boolean
  /** Inclusive byte cap for one `readWorkspaceFile` chunk (default 256 KiB). */
  readonly workspaceFileChunkBytes?: number
  /** Inclusive byte cap for one `readWorkspaceFileBinary` image (default 8 MiB). */
  readonly workspaceImageMaxBytes?: number
}

/** Host integrations replaceable by direct unit tests. */
export interface SessionControllerInternals {
  /** Native default-application handoff. */
  readonly openPath?: (path: string, signal: AbortSignal) => Promise<void>
  /** Native handoff availability probe. */
  readonly canOpenPath?: () => boolean
}

/** Host service backing the generated `ctx.remote.session` namespace. */
export class SessionController extends TypertRemoteService {
  static inject = [
    'agentDefaultModel',
    'agents',
    'attachments',
    'fs',
    'llm',
    'sessions',
    'sessionProjections',
    'sessionQuery',
    'typert',
    'workspaceRegistry',
  ]

  static Config: z<Config> = z.object({
    coldBlankProbeMaxBytes: z.natural().default(DEFAULT_COLD_BLANK_PROBE_MAX_BYTES),
    nativeOpen: z.boolean(),
    workspaceFileChunkBytes: z.natural().min(1024).max(1048576).default(DEFAULT_WORKSPACE_FILE_CHUNK_BYTES),
  })

  private readonly agents: ApiSessionAgentController
  private readonly commands: SessionCommandController
  private readonly config: Config
  private readonly controlState: SessionControlController
  private readonly history: SessionHistoryController
  private readonly listState: ApiSessionList
  private readonly openPath: (path: string, signal: AbortSignal) => Promise<void>
  private readonly canOpenPath: () => boolean
  private readonly promotions = new Set<Promise<void>>()

  /**
   * @param ctx - Host context containing the Session capability assembly.
   * @param config - cold-list observation policy.
   */
  constructor(ctx: Context, config: Config, internals: SessionControllerInternals = {}) {
    super(ctx, 'sessionController', { namespace: 'session' })
    installModelSelectionProjection(ctx)
    this.config = config
    this.agents = new ApiSessionAgentController(ctx)
    this.commands = new SessionCommandController(ctx, this.agents, process.cwd())
    this.controlState = new SessionControlController(ctx)
    // Registered before history so reverse-order teardown closes every
    // follower before waiting for already-admitted promotions.
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.promotions])
    }, 'session-controller.promotions')
    this.history = new SessionHistoryController(ctx, (observation) => { this.promote(observation) })
    this.listState = new ApiSessionList(
      ctx,
      config.coldBlankProbeMaxBytes ?? DEFAULT_COLD_BLANK_PROBE_MAX_BYTES,
    )
    this.openPath = internals.openPath ?? openNativePath
    this.canOpenPath = internals.canOpenPath
      ?? (() => config.nativeOpen ?? (internals.openPath !== undefined || canOpenNativePath()))
    ctx.plugin(SessionFileReferences)
    ctx.plugin(SessionSkillCatalog)

    ctx.on('session/created', (session) => {
      ctx.emit('api-session/added', this.listState.summaryFor(session))
    })
    ctx.on('session/disposed', (session) => {
      ctx.emit('api-session/removed', session.id)
    })
    ctx.on('agent/status', ({ agent, status }) => {
      ctx.emit('api-session/status', agent.id, status === 'running')
    })
    ctx.on('agent/error', ({ agent, error }) => {
      ctx.emit('api-session/error', agent.id, errorChain(error))
    })
    ctx.on('session/event', (session, event) => {
      if (event.type === 'request/header') {
        const agent = ctx.agents.get(session.id)
        if (agent?.session === session) this.agents.consumeSelection(
          agent,
          event.data.header.config.provider,
          event.data.header.config.model,
          event.data.header.config.reasoningEffort,
        )
      }
      if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
      ctx.emit('api-session/activity', session.id, event.time)
    })
  }

  private promote(observation: SessionObservation): void {
    const sessionId = observation.header.id
    const task = (async () => {
      using ownedObservation = observation
      const result = await this.agents.resolveObservedAgent(ownedObservation)
      if ('error' in result) this.ctx.emit('api-session/error', sessionId, result.error.message)
    })().catch((error: unknown) => {
      this.ctx.logger.error(`session-controller: background activation for "${sessionId}" failed: ${errorChain(error)}`)
    })
    this.promotions.add(task)
    void task.finally(() => { this.promotions.delete(task) })
  }

  /**
   * Resolve or resume one ordinary Session for another Host API domain.
   * @param sessionId - Session identity whose Agent owns the operation.
   * @returns the live Agent or the stable Session-domain failure.
   */
  resolveAgent(sessionId: SessionId): Promise<ApiSessionAgentResult> {
    return this.agents.resolveAgent(sessionId)
  }

  /**
   * Inspect one attached or persisted Session without activating its Agent.
   * @param sessionId - durable Session identity.
   * @param signal - optional caller cancellation for persistence reads.
   * @returns the current attached state or persisted header and event prefix.
   */
  inspect(
    sessionId: SessionId,
    signal?: AbortSignal,
  ): Promise<SessionInspection> {
    const attached = this.ctx.sessions.get(sessionId)
    if (attached !== undefined) {
      return Promise.resolve({
        meta: attached.header,
        inheritedEventCount: attached.inheritedEventCount,
        events: attached.snapshotEvents(),
      })
    }
    return inspectApiSession(this.ctx, sessionId, signal)
  }

  /**
   * Read all visible Session rows without resuming an Agent.
   * @param _request - reserved empty list request.
   * @param signal - cancellation for persistence reads.
   * @returns visible Session summaries ordered by activity.
   */
  @Remote('list')
  async list(_request: SessionListRequest, signal: AbortSignal): Promise<SessionListValue> {
    return { items: await this.listState.list(signal) }
  }

  /**
   * Search visible Session content without resuming an Agent.
   * @param request - literal message-content query.
   * @param signal - cancellation for list and search reads.
   * @returns authorized bounded Session search results.
   */
  @Remote('search')
  search(request: SessionSearchRequest, signal: AbortSignal): Promise<SessionSearchValue> {
    return this.listState.search(request.query, signal)
  }

  /**
   * Create or idempotently adopt one ordinary Session.
   * @param request - requested identity, location, and Agent preset.
   * @returns the Session identity and resolved preset when configured.
   */
  @Remote('create')
  create(request: SessionCreateRequest): Promise<SessionCreateValue> {
    return this.commands.create(request)
  }

  /**
   * Select one Session-local model after explicitly resuming the Session.
   * @param request - Session identity and requested model selection.
   * @returns the normalized selection installed for the Session.
   */
  @Remote('selectModel')
  selectModel(request: SessionSelectModelRequest): Promise<SessionSelectModelValue> {
    return this.commands.selectModel(request)
  }

  /**
   * Describe every currently routable model for Host-generation selectors.
   * @returns provider-grouped models, the deployment default, and isolated provider failures.
   */
  @Remote('modelCatalog')
  modelCatalog(): Promise<ModelCatalog> {
    return buildModelCatalog(this.ctx)
  }

  /**
   * Report whether this deployment can hand a Session workspace path to a native desktop.
   * @returns true when the matching open operation is available.
   */
  @Remote
  canOpenWorkspacePath(): boolean {
    return this.canOpenPath()
  }

  /**
   * Open one path prepared by a Session-aware caller on the Host desktop.
   * @param request - path after best-effort Session workspace resolution.
   * @param signal - caller lifetime; abort terminates the native command.
   * @returns confirmation after the native opener accepts the path.
   * @throws RemoteError when the request is invalid, cancelled, or the opener fails.
   */
  @Remote('openWorkspacePath')
  async openWorkspacePath(
    request: SessionOpenWorkspacePathRequest,
    signal: AbortSignal,
  ): Promise<SessionOpenWorkspacePathValue> {
    if (request.path.length === 0) {
      throw new RemoteError(
        'gateway/bad-request',
        'session.openWorkspacePath requires a non-empty path',
        {},
      )
    }
    signal.throwIfAborted()
    try {
      await this.openPath(request.path, signal)
      return { opened: true }
    } catch (error: unknown) {
      if (signal.aborted) throw new RemoteError('gateway/cancelled', 'path open was aborted', {})
      throw new RemoteError(
        'gateway/internal',
        `path open failed: ${error instanceof Error ? error.message : String(error)}`,
        {},
      )
    }
  }

  /**
   * Read one byte range of a file for in-page preview. The file must be a
   * regular file on the Session's own filesystem, so the readable set is the
   * same one the Session's own agent tools can touch. Relative paths are
   * rejected; the caller resolves against the Session workspace first.
   * @param request - absolute path plus the zero-based byte range to read.
   * @param signal - caller lifetime; abort terminates the read.
   * @returns the decoded text chunk and file metadata; binary files return
   *   metadata only with an empty content.
   * @throws TypertRemoteFailure when the path is invalid, absent, not a regular
   *   file, or the read fails.
   */
  @Remote('readWorkspaceFile')
  async readWorkspaceFile(
    request: SessionReadWorkspaceFileRequest,
    signal: AbortSignal,
  ): Promise<SessionReadWorkspaceFileValue> {
    const chunkBytes = this.config.workspaceFileChunkBytes ?? DEFAULT_WORKSPACE_FILE_CHUNK_BYTES
    const offset = request.offset ?? 0
    const limit = request.limit === undefined ? chunkBytes : Math.min(request.limit, chunkBytes)
    if (request.path.length === 0 || !isHostAbsolutePath(request.path)) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'session.readWorkspaceFile requires an absolute non-empty path',
        details: {},
      })
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'session.readWorkspaceFile offset must be a non-negative integer',
        details: {},
      })
    }
    if (!Number.isSafeInteger(limit) || limit < 1) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'session.readWorkspaceFile limit must be a positive integer',
        details: {},
      })
    }
    signal.throwIfAborted()
    const fs = this.ctx.fs
    const target = await fs.resolve(request.path, { signal })
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new TypertRemoteFailure({
        code: 'not-found',
        message: `session.readWorkspaceFile: "${target.displayPath}" does not exist`,
        details: {},
      })
    }
    if (info.type !== 'file') {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: `session.readWorkspaceFile: "${target.displayPath}" is not a regular file`,
        details: {},
      })
    }
    const bytes = await fs.readBytesRange(target, offset, limit, signal)
    const binary = bytes.subarray(0, BINARY_SAMPLE_BYTES).includes(0)
    const totalSize = info.size
    return {
      content: binary ? '' : decodeTextLenient(bytes),
      kind: binary ? 'binary' : kindOfWorkspaceFile(request.path),
      size: bytes.byteLength,
      ...totalSize === undefined ? {} : { totalSize },
      offset,
      eof: bytes.byteLength < limit || (totalSize !== undefined && offset + bytes.byteLength >= totalSize),
    }
  }

  /**
   * Read one whole browser-renderable image for in-page preview. Only the
   * image extensions in {@link WORKSPACE_IMAGE_EXTENSIONS} are served, and the
   * file must be an existing regular file on the Session's own filesystem —
   * the same readable set the Session's own agent tools can touch. Relative
   * paths are rejected; the caller resolves against the Session workspace
   * first. A file past the configured {@link Config.workspaceImageMaxBytes}
   * cap is refused rather than shipped to the browser in full.
   * @param request - absolute path of the image file to read.
   * @param signal - caller lifetime; abort terminates the read.
   * @returns the media type and base64-encoded whole-file bytes.
   * @throws TypertRemoteFailure when the path is invalid, unsupported, absent,
   *   oversized, not a regular file, or the read fails.
   */
  @Remote('readWorkspaceFileBinary')
  async readWorkspaceFileBinary(
    request: SessionReadWorkspaceFileBinaryRequest,
    signal: AbortSignal,
  ): Promise<SessionReadWorkspaceFileBinaryValue> {
    const maxBytes = this.config.workspaceImageMaxBytes ?? DEFAULT_WORKSPACE_IMAGE_MAX_BYTES
    if (request.path.length === 0 || !isHostAbsolutePath(request.path)) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: 'session.readWorkspaceFileBinary requires an absolute non-empty path',
        details: {},
      })
    }
    const extension = extname(request.path).toLowerCase()
    const mediaType = WORKSPACE_IMAGE_MEDIA_TYPES[extension]
    if (mediaType === undefined || !WORKSPACE_IMAGE_EXTENSIONS.has(extension)) {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: `session.readWorkspaceFileBinary: "${extension || '(no extension)'}" is not a renderable image`,
        details: {},
      })
    }
    signal.throwIfAborted()
    const fs = this.ctx.fs
    const target = await fs.resolve(request.path, { signal })
    const info = await fs.stat(target, signal)
    if (info === undefined) {
      throw new TypertRemoteFailure({
        code: 'not-found',
        message: `session.readWorkspaceFileBinary: "${target.displayPath}" does not exist`,
        details: {},
      })
    }
    if (info.type !== 'file') {
      throw new TypertRemoteFailure({
        code: 'bad-request',
        message: `session.readWorkspaceFileBinary: "${target.displayPath}" is not a regular file`,
        details: {},
      })
    }
    if (info.size !== undefined && info.size > maxBytes) {
      throw new TypertRemoteFailure({
        code: 'too-large',
        message: `session.readWorkspaceFileBinary: "${target.displayPath}" exceeds the ${maxBytes}-byte preview cap`,
        details: {},
      })
    }
    const bytes = await fs.readBytesRange(target, 0, Math.min(maxBytes + 1, info.size ?? maxBytes + 1), signal)
    return {
      mediaType,
      data: bytesToBase64(bytes),
      size: bytes.byteLength,
    }
  }

  /**
   * Rename one Session after explicitly resuming it.
   * @param request - Session identity and proposed title.
   * @returns the accepted title and durable event sequence.
   */
  @Remote('rename')
  rename(request: SessionRenameRequest): Promise<SessionRenameValue> {
    return this.commands.rename(request)
  }

  /**
   * Fork one cold-readable completed-turn prefix into a new Session.
   * @param request - source Session and optional event anchor.
   * @returns the new Session identity.
   */
  @Remote('fork')
  fork(request: SessionForkRequest): Promise<SessionForkValue> {
    return this.commands.fork(request)
  }

  /**
   * Admit one prompt after explicitly resuming its Session.
   * @param request - Session identity, prompt content, source metadata, and delivery mode.
   * @param signal - caller cancellation before prompt admission begins.
   * @returns acknowledgement that the Agent accepted the prompt.
   */
  @Remote('prompt')
  prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
    signal.throwIfAborted()
    return this.commands.prompt(request)
  }

  /**
   * Read one image proven reachable from the addressed Session log.
   * @param request - Session and attachment identities used for authorization.
   * @returns the durable attachment reference and base64-encoded bytes.
   */
  @Remote('attachment')
  attachment(request: SessionAttachmentRequest): Promise<SessionAttachmentValue> {
    return this.commands.attachment(request)
  }

  /**
   * Mutate one still-pending queue occurrence on a live Agent.
   * @param request - Session, queue item, and requested mutation.
   * @returns acknowledgement that the queue mutation was applied.
   */
  @Remote('updateQueue')
  updateQueue(request: SessionUpdateQueueRequest): SessionUpdateQueueValue {
    return this.commands.updateQueue(request)
  }

  /**
   * Cancel one active Agent turn without dropping its pending inbox.
   * @param request - Session whose active Agent turn is cancelled.
   * @returns acknowledgement that cancellation was requested.
   */
  @Remote('cancel')
  cancel(request: SessionCancelRequest): SessionCancelValue {
    return this.commands.cancel(request)
  }

  /**
   * Read one cold-safe, message-aligned Session history page.
   * @param request - durable address, backward cursor, and page budget.
   * @param signal - cancellation for persistence reads.
   * @returns one chronological page.
   */
  @Remote('page')
  page(request: SessionPageRequest, signal: AbortSignal): Promise<SessionPage> {
    return this.history.page(request, signal)
  }

  /**
   * Follow one Session log from its opening or resume cursor.
   * @param request - durable address and last committed sequence already held by the caller.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns a complete opening snapshot followed by gap-free event frames.
   */
  @Remote({ mode: 'stream' })
  follow(request: SessionFollowRequest, signal: AbortSignal): AsyncIterable<SessionFollowFrame> {
    return this.history.follow(request, signal)
  }

  /**
   * Stream a complete live-control baseline followed by replacement frames.
   * @param signal - cancellation owned by the Remote stream carrier.
   * @returns one complete baseline followed by live replacement frames.
   */
  @Remote({ mode: 'stream' })
  control(signal: AbortSignal): AsyncIterable<SessionControlFrame> {
    return this.controlState.control(signal)
  }

}

export { buildModelCatalog }
export default SessionController
