/** Workspace-relative image resolution for Markdown and the file preview. */

import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import type {
  SessionReadWorkspaceFileBinaryRequest,
  SessionReadWorkspaceFileBinaryValue,
} from '@deepseek-ai/dsh-api-session-controller/types'
import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path'

/** Whole-file image reader bound to the Session Remote, supplied through the Chat inject face. */
export type WorkspaceImageReader = (
  request: SessionReadWorkspaceFileBinaryRequest,
  signal: AbortSignal,
) => Promise<RemoteResult<SessionReadWorkspaceFileBinaryValue>>

/** Browser-renderable image extensions resolved from authored sources; mirrors the Host allowlist. */
const IMAGE_EXTENSIONS = new Set([
  '.apng', '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.svgz', '.webp',
])

/**
 * Whether a file path names a browser-renderable image.
 * @param path - absolute or authored file path.
 * @returns whether the extension is in the renderable set.
 */
export function isWorkspaceImagePath(path: string): boolean {
  const lower = path.toLowerCase()
  const dot = lower.lastIndexOf('.')
  return dot >= 0 && IMAGE_EXTENSIONS.has(lower.slice(dot))
}

/**
 * Resolve one authored image source (relative paths and `./` prefixes) into
 * an absolute Host path against the Session workspace; non-image sources and
 * absolute HTTP(S) URLs return undefined (the renderer handles those itself).
 * @param cwd - Session workspace root; absent means no resolution.
 * @param src - the authored image destination.
 * @returns the absolute Host path, or undefined when unresolvable.
 */
export function resolveWorkspaceImagePath(cwd: string | undefined, src: string): string | undefined {
  if (cwd === undefined || !isWorkspaceImagePath(src)) return undefined
  // Absolute HTTP(S) URLs never reach the resolver in the renderer, but the
  // util stays defensive: any scheme-prefixed source is not a workspace path.
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(src)) return undefined
  try {
    return resolveWorkspacePath(cwd, src)
  } catch {
    // An authored destination the workspace resolver refuses (unparsable or
    // escaping the workspace) stays inert, exactly as before.
    return undefined
  }
}

/**
 * Decode one base64 image payload into a browser URL the `<img>` can load:
 * an object URL when the browser supports it (preferred, revocable), else a
 * data URI. Shared by the Markdown image resolver and the file preview.
 */
export function imageDataUrl(mediaType: string, base64: string): string {
  const dataUrl = `data:${mediaType};base64,${base64}`
  if (typeof URL.createObjectURL !== 'function') return dataUrl
  try {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) {
      bytes[index] = binary.charCodeAt(index)
    }
    return URL.createObjectURL(new Blob([bytes.buffer], { type: mediaType }))
  } catch {
    // A malformed payload falls back to the data URI; the browser then fails
    // the image load without crashing the viewer.
    return dataUrl
  }
}

/**
 * Session-scoped workspace-image URL cache: one blob URL per resolved path,
 * eagerly loaded on first request, and a reactive version counter so owners
 * can re-render when a lazy load lands (the plain alt-text fallback then
 * swaps to the real image). Failed loads cache as `undefined` so a dead path
 * is not re-read on every render.
 */
export class WorkspaceImageUrlCache {
  /** Bumped on every settled load; observe to re-render resolved images. */
  readonly version: SnapshotStore<number> = createSnapshotStore(0)
  private readonly urls = new Map<string, string | undefined>()
  private readonly pending = new Set<string>()

  /**
   * @param reader - whole-file image reader; null disables workspace images
   * (then every peek resolves nothing and no read is started).
   */
  constructor(private readonly reader: WorkspaceImageReader | null) {}

  /**
   * Read the cached URL for one path, starting the load on first use.
   * @param path - absolute Host image path.
   * @returns the current URL, or undefined while the read is in flight or failed.
   */
  peek(path: string): string | undefined {
    if (!this.urls.has(path)) this.load(path)
    return this.urls.get(path)
  }

  /** Start the read for one path unless it is cached, pending, or disabled. */
  private load(path: string): void {
    const reader = this.reader
    if (reader === null || this.pending.has(path)) return
    this.pending.add(path)
    void reader({ path }, new AbortController().signal).then((result) => {
      if (result.ok) {
        this.urls.set(path, imageDataUrl(result.value.mediaType, result.value.data))
      } else {
        this.urls.set(path, undefined)
      }
      this.pending.delete(path)
      this.version.set(this.version.getSnapshot() + 1)
    })
  }

  /** Release every object URL and clear the cache (Session-scope disposal). */
  dispose(): void {
    for (const url of this.urls.values()) {
      if (url !== undefined && url.startsWith('blob:')) URL.revokeObjectURL(url)
    }
    this.urls.clear()
    this.pending.clear()
  }
}
