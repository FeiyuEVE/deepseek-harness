/** In-page file preview: chunked reading with a three-chunk sliding window. */

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  CodeBlock, JsonBlock, MarkdownText,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import { markdownLabels } from '../markdown-labels.ts'
import type { WorkspaceFileReader } from '../file-preview.ts'
import css from './FilePreview.module.css'

/** Default chunk size requested from the Host (mirrors the deployment default). */
const CHUNK_BYTES = 256 * 1024

/** Structured previews need the whole file, so only small ones render as data. */
const STRUCTURED_LIMIT = CHUNK_BYTES

/** One loaded chunk. */
interface Chunk {
  readonly offset: number
  readonly content: string
  readonly size: number
}

/** Chunked read state owned by the preview component. */
interface ChunkView {
  readonly chunks: readonly Chunk[]
  readonly kind: 'markdown' | 'code' | 'json' | 'yaml' | 'text' | 'binary' | undefined
  readonly totalSize: number | undefined
  readonly eof: boolean
  readonly error: string | undefined
}

const EMPTY_VIEW: ChunkView = { chunks: [], kind: undefined, totalSize: undefined, eof: false, error: undefined }

/** Format a byte count for the preview header. */
export function formatFileSize(bytes: number | undefined): string {
  if (bytes === undefined) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Map a preview kind to a code-highlight grammar hint. */
function grammarFor(path: string): string | undefined {
  const extension = path.slice(path.lastIndexOf('.')).toLowerCase()
  const grammars: Record<string, string> = {
    '.c': 'c', '.cc': 'cpp', '.cpp': 'cpp', '.cs': 'csharp', '.css': 'css', '.dart': 'dart',
    '.go': 'go', '.h': 'c', '.hpp': 'cpp', '.html': 'html', '.java': 'java', '.js': 'javascript',
    '.jsx': 'jsx', '.json': 'json', '.jsonc': 'json', '.kt': 'kotlin', '.kts': 'kotlin',
    '.lua': 'lua', '.php': 'php', '.proto': 'protobuf', '.py': 'python', '.rb': 'ruby',
    '.rs': 'rust', '.scss': 'scss', '.sh': 'shellscript', '.sql': 'sql', '.svelte': 'svelte',
    '.swift': 'swift', '.toml': 'toml', '.ts': 'typescript', '.tsx': 'tsx', '.vue': 'vue',
    '.xml': 'xml', '.yaml': 'yaml', '.yml': 'yaml', '.zsh': 'shellscript',
  }
  return grammars[extension]
}

/** File base name for the preview header. */
export function fileBaseName(path: string): string {
  const trimmed = path.replace(/[/\\]+$/, '')
  const separator = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'))
  return trimmed.slice(separator + 1)
}

/**
 * Read one file through {@link WorkspaceFileReader} with a three-chunk sliding
 * window: loading forward appends and drops the oldest chunk, loading backward
 * prepends and drops the newest, so at most three chunks stay rendered.
 */
function useChunkedFile(path: string, read: WorkspaceFileReader) {
  const [view, setView] = useState<ChunkView>(EMPTY_VIEW)
  const [busy, setBusy] = useState<{ prev: boolean; next: boolean }>({ prev: false, next: false })
  const generation = useRef(0)

  useEffect(() => {
    generation.current += 1
    const gen = generation.current
    setView(EMPTY_VIEW)
    setBusy({ prev: false, next: false })
    const controller = new AbortController()
    void read({ path, offset: 0, limit: CHUNK_BYTES }, controller.signal).then((result) => {
      if (gen !== generation.current) return
      if (!result.ok) {
        setView({ ...EMPTY_VIEW, error: result.error.message })
        return
      }
      setView({
        chunks: [{ offset: result.value.offset, content: result.value.content, size: result.value.size }],
        kind: result.value.kind,
        totalSize: result.value.totalSize,
        eof: result.value.eof || result.value.size === 0,
        error: undefined,
      })
    })
    return () => {
      generation.current += 1
      controller.abort()
    }
  }, [path, read])

  const loadNext = useCallback(async () => {
    const last = view.chunks[view.chunks.length - 1]
    if (busy.next || view.eof || last === undefined) return
    setBusy(previous => ({ ...previous, next: true }))
    const result = await read({ path, offset: last.offset + last.size, limit: CHUNK_BYTES }, new AbortController().signal)
    setBusy(previous => ({ ...previous, next: false }))
    if (!result.ok) {
      setView(previous => ({ ...previous, error: result.error.message }))
      return
    }
    if (result.value.size === 0) {
      setView(previous => ({ ...previous, eof: true }))
      return
    }
    setView((previous) => {
      const chunks = [...previous.chunks, { offset: result.value.offset, content: result.value.content, size: result.value.size }]
      if (chunks.length > 3) chunks.shift()
      return { ...previous, chunks, eof: result.value.eof, error: undefined }
    })
  }, [busy.next, path, read, view.chunks, view.eof])

  const loadPrev = useCallback(async () => {
    if (busy.prev || view.chunks.length === 0) return
    const first = view.chunks[0]
    if (first === undefined || first.offset === 0) return
    setBusy(previous => ({ ...previous, prev: true }))
    const offset = Math.max(0, first.offset - CHUNK_BYTES)
    const result = await read({ path, offset, limit: CHUNK_BYTES }, new AbortController().signal)
    setBusy(previous => ({ ...previous, prev: false }))
    if (!result.ok) {
      setView(previous => ({ ...previous, error: result.error.message }))
      return
    }
    setView((previous) => {
      const chunks = [{ offset: result.value.offset, content: result.value.content, size: result.value.size }, ...previous.chunks]
      if (chunks.length > 3) chunks.pop()
      return { ...previous, chunks, error: undefined }
    })
  }, [busy.prev, path, read, view.chunks])

  return { view, busy, loadNext, loadPrev }
}

/** One rendered chunk body; markdown/code surfaces render per chunk. */
function ChunkBody({ kind, path, content, t }: {
  kind: ChunkView['kind']
  path: string
  content: string
  t: ChatViewSlotProps['t']
}) {
  const labels = useMemo(() => markdownLabels(t), [t])
  if (kind === 'markdown') {
    return <div className={css.markdown}><MarkdownText text={content} labels={labels} /></div>
  }
  if (kind === 'json' || kind === 'yaml') {
    return (
      <CodeBlock
        code={content}
        lang={grammarFor(path)}
        copyLabel={t('filePreview.copy')}
        copiedLabel={t('filePreview.copied')}
      />
    )
  }
  if (kind === 'code') {
    return (
      <CodeBlock
        code={content}
        lang={grammarFor(path)}
        copyLabel={t('filePreview.copy')}
        copiedLabel={t('filePreview.copied')}
      />
    )
  }
  return <pre className={css.plain}>{content}</pre>
}

/** Props of the preview host rendered by the Chat view. */
export interface FilePreviewHostProps {
  useStore: ChatViewSlotProps['useStore']
  actions: ChatViewSlotProps['actions']
  readWorkspaceFile: WorkspaceFileReader | null
  t: ChatViewSlotProps['t']
}

/** Renders the open preview overlay, or nothing when the store has none. */
export const FilePreviewHost = memo(function FilePreviewHost({
  useStore, actions, readWorkspaceFile, t,
}: FilePreviewHostProps) {
  const preview = useStore(state => state.filePreview)
  if (preview === null || readWorkspaceFile === null) return null
  return (
    <FilePreview
      key={preview.path}
      path={preview.path}
      read={readWorkspaceFile}
      close={() => actions.closeFilePreview()}
      t={t}
    />
  )
})

/** Full-screen file preview with chunked scrolling. */
export function FilePreview({ path, read, close, t }: {
  path: string
  read: WorkspaceFileReader
  close: () => void
  t: ChatViewSlotProps['t']
}) {
  const { view, busy, loadNext, loadPrev } = useChunkedFile(path, read)
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const topChunkRef = useRef<HTMLDivElement | null>(null)
  const scrollTopBefore = useRef(0)

  const onScroll = useCallback(() => {
    const element = scrollRef.current
    if (element === null) return
    if (element.scrollTop < 64) {
      scrollTopBefore.current = element.scrollTop
      void loadPrev()
    } else if (element.scrollHeight - element.scrollTop - element.clientHeight < 256) {
      void loadNext()
    }
  }, [loadNext, loadPrev])

  // Keep the viewport anchored when a backward chunk prepends above it.
  useLayoutEffect(() => {
    if (!busy.prev && topChunkRef.current !== null && scrollTopBefore.current > 0) {
      const element = scrollRef.current
      if (element !== null) element.scrollTop = scrollTopBefore.current + topChunkRef.current.offsetHeight
      scrollTopBefore.current = 0
    }
  }, [busy.prev, view.chunks])

  const structured = (view.kind === 'json' || view.kind === 'yaml')
    && view.totalSize !== undefined && view.totalSize <= STRUCTURED_LIMIT
  const loadedBytes = view.chunks.reduce((sum, chunk) => sum + chunk.size, 0)
  const firstChunk = view.chunks[0]
  const canGoUp = firstChunk !== undefined && firstChunk.offset > 0
  const canGoDown = !view.eof && view.chunks.length > 0

  let body: ReactNode
  if (view.error !== undefined) {
    body = <p className={css.error}>{t('filePreview.error', { message: view.error })}</p>
  } else if (view.kind === 'binary') {
    body = <p className={css.notice}>{t('filePreview.binary')}</p>
  } else if (view.kind === undefined && view.chunks.length === 0) {
    body = <p className={css.notice}>{t('filePreview.loading')}</p>
  } else if (structured) {
    const whole = view.chunks.map(chunk => chunk.content).join('')
    let parsed: unknown = whole
    try {
      parsed = JSON.parse(whole)
    } catch {
      parsed = whole
    }
    body = (
      <JsonBlock
        label={t('filePreview.jsonLabel')}
        payload={parsed}
        defaultOpen
        truncatedLabel={total => t('filePreview.truncated', { total: String(total) })}
      />
    )
  } else {
    body = (
      <>
        {busy.prev && canGoUp && <div className={css.busy}>{t('filePreview.loading')}</div>}
        <div ref={topChunkRef}>
          {view.chunks.map(chunk => (
            <ChunkBody key={chunk.offset} kind={view.kind} path={path} content={chunk.content} t={t} />
          ))}
        </div>
        {busy.next && canGoDown && <div className={css.busy}>{t('filePreview.loading')}</div>}
      </>
    )
  }

  const sizeLabel = view.totalSize === undefined
    ? t('filePreview.loaded', { loaded: formatFileSize(loadedBytes), total: '…' })
    : t('filePreview.loaded', { loaded: formatFileSize(loadedBytes), total: formatFileSize(view.totalSize) })

  return (
    <div className={css.overlay} role="dialog" aria-modal="true" aria-label={t('filePreview.title')}>
      <div className={css.header}>
        <span className={css.title} title={path}>{fileBaseName(path)}</span>
        <span className={css.meta}>{sizeLabel}</span>
        <button type="button" className={css.close} onClick={close} aria-label={t('filePreview.close')}>
          ✕
        </button>
      </div>
      <div className={css.body} ref={scrollRef} onScroll={onScroll} data-file-preview-scroll>
        {body}
      </div>
    </div>
  )
}
