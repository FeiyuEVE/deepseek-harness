// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { makeTranslate, bindSnapshotSelector } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { SessionReadWorkspaceFileRequest } from '@deepseek-ai/dsh-api-session-controller/types'
import { zh } from '../src/client/locale.ts'
import { createChatStore } from '../src/client/stores.ts'
import type { WorkspaceFileReader } from '../src/client/file-preview.ts'
import { FilePreview, FilePreviewHost, fileBaseName, formatFileSize } from '../src/client/chat/FilePreview.tsx'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const t = makeTranslate(zh, commonZh)

/** A reader serving one logical file split into fixed-size chunks. */
function chunkedReader(chunks: ReadonlyArray<{
  offset: number
  content: string
  size: number
  eof: boolean
  kind: 'text'
  totalSize: number
}>): { read: WorkspaceFileReader; requestedOffsets: () => number[] } {
  const requested: number[] = []
  const read: WorkspaceFileReader = async (request: SessionReadWorkspaceFileRequest) => {
    if (request.offset !== undefined) requested.push(request.offset)
    const hit = chunks.find(chunk => chunk.offset === request.offset)
    if (hit === undefined) {
      const first = chunks[0]
      const value = first === undefined
        ? { content: '', kind: 'text' as const, size: 0, offset: request.offset ?? 0, eof: true }
        : { content: '', kind: 'text' as const, size: 0, offset: request.offset ?? 0, totalSize: first.totalSize, eof: true }
      return { ok: true, value }
    }
    return { ok: true, value: { ...hit } }
  }
  return { read, requestedOffsets: () => requested }
}

function scrollContainer(): HTMLElement {
  const element = document.querySelector('[data-file-preview-scroll]')
  if (element === null) throw new Error('missing file preview scroll container')
  Object.defineProperties(element, {
    scrollHeight: { configurable: true, value: 10000 },
    clientHeight: { configurable: true, value: 300 },
  })
  return element as HTMLElement
}

function scrollTo(element: HTMLElement, scrollTop: number): void {
  Object.defineProperty(element, 'scrollTop', { configurable: true, writable: true, value: scrollTop })
  fireEvent.scroll(element)
}

const WINDOW: ReadonlyArray<{
  offset: number
  content: string
  size: number
  eof: boolean
  kind: 'text'
  totalSize: number
}> = [
  { offset: 0, content: 'window-a', size: 262144, eof: false, kind: 'text', totalSize: 1048576 },
  { offset: 262144, content: 'window-b', size: 262144, eof: false, kind: 'text', totalSize: 1048576 },
  { offset: 524288, content: 'window-c', size: 262144, eof: false, kind: 'text', totalSize: 1048576 },
  { offset: 786432, content: 'window-d', size: 262144, eof: true, kind: 'text', totalSize: 1048576 },
]

describe('formatFileSize', () => {
  it('formats bytes, KiB and MiB', () => {
    expect(formatFileSize(undefined)).toBe('')
    expect(formatFileSize(512)).toBe('512 B')
    expect(formatFileSize(1536)).toBe('1.5 KB')
    expect(formatFileSize(2 * 1024 * 1024)).toBe('2.0 MB')
  })
})

describe('fileBaseName', () => {
  it('keeps the last path segment on both separators', () => {
    expect(fileBaseName('/workspace/src/main.ts')).toBe('main.ts')
    expect(fileBaseName('C:\\docs\\readme.md')).toBe('readme.md')
    expect(fileBaseName('/trailing/slash/')).toBe('slash')
  })
})

describe('FilePreview', () => {
  it('renders a markdown chunk with a header and close button', async () => {
    const close = vi.fn()
    const read: WorkspaceFileReader = async () => ({
      ok: true,
      value: {
        content: '# Heading\n\nbody text',
        kind: 'markdown',
        size: 25,
        totalSize: 25,
        offset: 0,
        eof: true,
      },
    })
    const view = render(<FilePreview path="/workspace/README.md" read={read} close={close} t={t} />)
    expect(await screen.findByText('Heading')).toBeTruthy()
    expect(screen.getByText('body text')).toBeTruthy()
    expect(screen.getByText('README.md')).toBeTruthy()
    expect(screen.getByText(/已加载/)).toBeTruthy()
    fireEvent.click(screen.getByLabelText('关闭预览'))
    expect(close).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('renders code chunks with a grammar hint', async () => {
    const read: WorkspaceFileReader = async () => ({
      ok: true,
      value: { content: 'export const x = 1', kind: 'code', size: 18, totalSize: 18, offset: 0, eof: true },
    })
    render(<FilePreview path="/workspace/src/main.ts" read={read} close={vi.fn()} t={t} />)
    const code = await screen.findByRole('code')
    expect(code.textContent).toBe('export const x = 1')
  })

  it('renders small JSON files as structured data', async () => {
    const read: WorkspaceFileReader = async () => ({
      ok: true,
      value: { content: '{"a":1}', kind: 'json', size: 7, totalSize: 7, offset: 0, eof: true },
    })
    render(<FilePreview path="/workspace/data.json" read={read} close={vi.fn()} t={t} />)
    expect(await screen.findByText(/JSON 内容/)).toBeTruthy()
  })

  it('renders binary files as an unreadable notice', async () => {
    const read: WorkspaceFileReader = async () => ({
      ok: true,
      value: { content: '', kind: 'binary', size: 0, totalSize: 4096, offset: 0, eof: true },
    })
    render(<FilePreview path="/workspace/image.png" read={read} close={vi.fn()} t={t} />)
    expect(await screen.findByText('二进制文件，无法在页面内预览')).toBeTruthy()
  })

  it('surfaces read failures', async () => {
    const read: WorkspaceFileReader = async () => ({
      ok: false,
      error: { message: 'boom', code: 'read-failed', details: {} },
    })
    render(<FilePreview path="/workspace/missing.txt" read={read} close={vi.fn()} t={t} />)
    expect(await screen.findByText('无法读取文件：boom')).toBeTruthy()
  })

  it('slides a three-chunk window forward and refetches backward', async () => {
    const { read, requestedOffsets } = chunkedReader(WINDOW)
    render(<FilePreview path="/workspace/big.log" read={read} close={vi.fn()} t={t} />)

    expect(await screen.findByText('window-a')).toBeTruthy()
    const element = scrollContainer()

    scrollTo(element, 9900)
    expect(await screen.findByText('window-b')).toBeTruthy()
    expect(screen.getByText('window-a')).toBeTruthy()

    scrollTo(element, 9900)
    expect(await screen.findByText('window-c')).toBeTruthy()
    expect(screen.getByText('window-b')).toBeTruthy()

    scrollTo(element, 9900)
    expect(await screen.findByText('window-d')).toBeTruthy()
    expect(screen.queryByText('window-a')).toBeNull()

    // Backward: refetch the chunk before the window head; the newest drops.
    scrollTo(element, 10)
    expect(await screen.findByText('window-a')).toBeTruthy()
    expect(screen.queryByText('window-d')).toBeNull()
    expect(screen.getByText('window-b')).toBeTruthy()
    expect(screen.getByText('window-c')).toBeTruthy()

    expect(requestedOffsets()).toEqual([0, 262144, 524288, 786432, 0])
  })

  it('does not fetch past the end or before the start', async () => {
    const { read, requestedOffsets } = chunkedReader(WINDOW)
    render(<FilePreview path="/workspace/big.log" read={read} close={vi.fn()} t={t} />)
    await screen.findByText('window-a')
    const element = scrollContainer()

    // At the very top the first chunk is already loaded: no backward fetch.
    scrollTo(element, 10)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(requestedOffsets()).toEqual([0])

    scrollTo(element, 9900)
    await screen.findByText('window-b')
    scrollTo(element, 9900)
    await screen.findByText('window-c')
    scrollTo(element, 9900)
    await screen.findByText('window-d')

    // Reaching eof stops further forward fetches.
    scrollTo(element, 9900)
    await new Promise(resolve => setTimeout(resolve, 20))
    expect(requestedOffsets()).toEqual([0, 262144, 524288, 786432])
  })
})

describe('FilePreviewHost', () => {
  it('renders nothing while no file is open or no reader is bound', () => {
    const store = createChatStore().create()
    const { container } = render(
      <FilePreviewHost
        useStore={bindSnapshotSelector(store.store)}
        actions={store.actions}
        readWorkspaceFile={null}
        t={t}
      />,
    )
    expect(container.childElementCount).toBe(0)
  })

  it('renders the preview when the store opens a file', async () => {
    const store = createChatStore().create()
    const read: WorkspaceFileReader = async () => ({
      ok: true,
      value: { content: 'hello', kind: 'text', size: 5, totalSize: 5, offset: 0, eof: true },
    })
    store.actions.openFilePreview('/workspace/notes.txt')
    const view = render(
      <FilePreviewHost
        useStore={bindSnapshotSelector(store.store)}
        actions={store.actions}
        readWorkspaceFile={read}
        t={t}
      />,
    )
    expect(await screen.findByText('hello')).toBeTruthy()
    expect(screen.getByText('notes.txt')).toBeTruthy()

    store.actions.closeFilePreview()
    await vi.waitFor(() => expect(view.container.childElementCount).toBe(0))
    view.unmount()
  })
})
