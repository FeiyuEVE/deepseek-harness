// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import {
  imageDataUrl, isWorkspaceImagePath, resolveWorkspaceImagePath, WorkspaceImageUrlCache,
} from '../src/client/workspace-image.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('workspace image paths', () => {
  it('recognizes browser-renderable extensions only', () => {
    expect(isWorkspaceImagePath('./chart.png')).toBe(true)
    expect(isWorkspaceImagePath('/ws/diagram.svg')).toBe(true)
    expect(isWorkspaceImagePath('/ws/PHOTO.JPG')).toBe(true)
    expect(isWorkspaceImagePath('./notes.md')).toBe(false)
    expect(isWorkspaceImagePath('./no-extension')).toBe(false)
  })

  it('resolves relative sources against the workspace and refuses non-images', () => {
    expect(resolveWorkspaceImagePath('/ws', './output/chart.png')).toBe('/ws/./output/chart.png')
    expect(resolveWorkspaceImagePath('/ws', 'chart.svg')).toBe('/ws/chart.svg')
    expect(resolveWorkspaceImagePath('/ws', 'notes.md')).toBeUndefined()
    expect(resolveWorkspaceImagePath(undefined, './chart.png')).toBeUndefined()
    expect(resolveWorkspaceImagePath('/ws', 'https://example.com/chart.png')).toBeUndefined()
  })
})

describe('imageDataUrl', () => {
  it('prefers an object URL when the browser supports it', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:image')
    expect(imageDataUrl('image/png', 'aGk=')).toBe('blob:image')
    expect(create).toHaveBeenCalled()
  })

  it('falls back to a data URI without object URLs or on malformed payloads', () => {
    const withoutCreate = { ...URL }
    vi.stubGlobal('URL', { ...withoutCreate, createObjectURL: undefined, revokeObjectURL: undefined })
    expect(imageDataUrl('image/svg+xml', 'PHN2Zz48L3N2Zz4=')).toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=')
    vi.unstubAllGlobals()
    const malformed = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error('no') })
    expect(imageDataUrl('image/png', 'aGk=')).toBe('data:image/png;base64,aGk=')
    expect(malformed).toHaveBeenCalled()
  })
})

describe('WorkspaceImageUrlCache', () => {
  it('peeks the cached URL, loads once, and bumps the version on settle', async () => {
    const reader = vi.fn(() => Promise.resolve<RemoteResult<{ mediaType: string; data: string; size: number }>>({
      ok: true,
      value: { mediaType: 'image/png', data: 'aGk=', size: 2 },
    }))
    const cache = new WorkspaceImageUrlCache(reader)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:cached')

    expect(cache.peek('/ws/a.png')).toBeUndefined()
    expect(cache.peek('/ws/a.png')).toBeUndefined()
    expect(reader).toHaveBeenCalledTimes(1)
    await vi.waitFor(() => expect(cache.version.getSnapshot()).toBe(1))
    expect(cache.peek('/ws/a.png')).toBe('blob:cached')
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    cache.dispose()
    expect(revoke).toHaveBeenCalledWith('blob:cached')
  })

  it('caches a failed read as a declined resolution without retrying', async () => {
    const reader = vi.fn(() => Promise.resolve<RemoteResult<never>>({
      ok: false,
      error: { code: 'session/read-not-found', message: 'missing', details: {} },
    }))
    const cache = new WorkspaceImageUrlCache(reader)
    expect(cache.peek('/ws/missing.png')).toBeUndefined()
    await vi.waitFor(() => expect(cache.version.getSnapshot()).toBe(1))
    expect(cache.peek('/ws/missing.png')).toBeUndefined()
    expect(reader).toHaveBeenCalledTimes(1)
    cache.dispose()
  })

  it('never reads without a reader', () => {
    const cache = new WorkspaceImageUrlCache(null)
    expect(cache.peek('/ws/a.png')).toBeUndefined()
    expect(cache.version.getSnapshot()).toBe(0)
  })
})
