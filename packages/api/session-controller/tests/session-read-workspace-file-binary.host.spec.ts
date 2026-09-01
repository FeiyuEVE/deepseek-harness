import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import SessionStore from '@deepseek-ai/dsh-session'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createSessionTestRemote,
} from './test-remote.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'read-workspace-file-binary-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function context(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  return ctx
}

function remote(ctx: Context, maxBytes?: number) {
  return createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: dir,
    ...maxBytes === undefined ? {} : { workspaceImageMaxBytes: maxBytes },
  })
}

describe('session/readWorkspaceFileBinary', () => {
  it('serves one whole image with its media type and base64 data', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
    await writeFile(join(dir, 'a.png'), bytes)
    const rpc = remote(await context())

    const result = await rpc.readWorkspaceFileBinary({ path: join(dir, 'a.png') })
    expect(result).toEqual({
      ok: true,
      value: { mediaType: 'image/png', data: bytes.toString('base64'), size: bytes.byteLength },
    })
  })

  it('classifies common image extensions into their media types', async () => {
    const cases: Array<[string, string]> = [
      ['pic.jpg', 'image/jpeg'],
      ['pic.gif', 'image/gif'],
      ['pic.svg', 'image/svg+xml'],
      ['pic.webp', 'image/webp'],
    ]
    for (const [name, mediaType] of cases) {
      await writeFile(join(dir, name), 'x')
      const rpc = remote(await context())
      const result = await rpc.readWorkspaceFileBinary({ path: join(dir, name) })
      expect(result).toMatchObject({ ok: true, value: { mediaType } })
    }
  })

  it('rejects empty and relative paths', async () => {
    const rpc = remote(await context())
    await expect(rpc.readWorkspaceFileBinary({ path: '' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(rpc.readWorkspaceFileBinary({ path: 'a.png' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects non-image extensions', async () => {
    await writeFile(join(dir, 'a.txt'), 'content')
    const rpc = remote(await context())
    await expect(rpc.readWorkspaceFileBinary({ path: join(dir, 'a.txt') }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects missing paths and directories', async () => {
    await mkdir(join(dir, 'sub'))
    const rpc = remote(await context())
    await expect(rpc.readWorkspaceFileBinary({ path: join(dir, 'nope.png') }))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
    await expect(rpc.readWorkspaceFileBinary({ path: join(dir, 'sub') }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('refuses files past the configured preview cap', async () => {
    await writeFile(join(dir, 'big.png'), Buffer.alloc(64, 0xab))
    const rpc = remote(await context(), 32)

    const result = await rpc.readWorkspaceFileBinary({ path: join(dir, 'big.png') })
    expect(result).toMatchObject({ ok: false, error: { code: 'too-large' } })
  })

  it('honors aborted signals', async () => {
    await writeFile(join(dir, 'a.png'), 'data')
    const rpc = remote(await context())
    const aborted = new AbortController()
    aborted.abort()
    await expect(rpc.readWorkspaceFileBinary({ path: join(dir, 'a.png') }, aborted.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})
