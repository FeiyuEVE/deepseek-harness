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
  dir = await mkdtemp(join(tmpdir(), 'read-workspace-file-'))
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

function remote(ctx: Context) {
  return createSessionTestRemote(ctx, {
    defaultModelSelection: () => ({ provider: 'p', model: 'm' }),
    cwd: dir,
  })
}

describe('session/readWorkspaceFile', () => {
  it('reads one byte range with metadata and clamps the last range to the file end', async () => {
    await writeFile(join(dir, 'a.txt'), '0123456789abcdefghij')
    const rpc = remote(await context())

    const first = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), offset: 5, limit: 5 })
    expect(first).toEqual({ ok: true, value: { content: '56789', kind: 'text', size: 5, totalSize: 20, offset: 5, eof: false } })

    const last = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), offset: 15, limit: 100 })
    expect(last).toEqual({ ok: true, value: { content: 'fghij', kind: 'text', size: 5, totalSize: 20, offset: 15, eof: true } })
  })

  it('echoes the default chunk limit and reports eof for an exact-limit tail', async () => {
    await writeFile(join(dir, 'a.txt'), 'x'.repeat(256 * 1024))
    const rpc = remote(await context())

    const tail = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt') })
    expect(tail).toMatchObject({ ok: true, value: { size: 256 * 1024, offset: 0, eof: true } })
    const end = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), offset: 200 * 1024 })
    expect(end).toMatchObject({ ok: true, value: { size: 56 * 1024, eof: true } })
  })

  it('classifies files by extension', async () => {
    const cases: Array<[string, string]> = [
      ['note.md', 'markdown'],
      ['main.py', 'code'],
      ['data.json', 'json'],
      ['config.yaml', 'yaml'],
      ['plain.log', 'text'],
    ]
    for (const [name, kind] of cases) {
      await writeFile(join(dir, name), 'content')
      const rpc = remote(await context())
      const result = await rpc.readWorkspaceFile({ path: join(dir, name) })
      expect(result).toMatchObject({ ok: true, value: { kind, content: 'content' } })
    }
  })

  it('rejects binary content and returns metadata only', async () => {
    await writeFile(join(dir, 'a.bin'), Buffer.from([0x00, 0x01, 0x02]))
    const rpc = remote(await context())

    const result = await rpc.readWorkspaceFile({ path: join(dir, 'a.bin') })
    expect(result).toEqual({
      ok: true,
      value: { content: '', kind: 'binary', size: 3, totalSize: 3, offset: 0, eof: true },
    })
  })

  it('rejects relative paths, invalid offsets and limits', async () => {
    const rpc = remote(await context())
    await expect(rpc.readWorkspaceFile({ path: 'relative.txt' }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), offset: -1 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
    await expect(rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), limit: 0 }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('rejects missing paths and directories', async () => {
    await mkdir(join(dir, 'sub'))
    const rpc = remote(await context())
    await expect(rpc.readWorkspaceFile({ path: join(dir, 'nope') }))
      .resolves.toMatchObject({ ok: false, error: { code: 'not-found' } })
    await expect(rpc.readWorkspaceFile({ path: join(dir, 'sub') }))
      .resolves.toMatchObject({ ok: false, error: { code: 'bad-request' } })
  })

  it('honors cancellation before and during the read', async () => {
    await writeFile(join(dir, 'a.txt'), 'data')
    const rpc = remote(await context())
    const aborted = new AbortController()
    aborted.abort()
    await expect(rpc.readWorkspaceFile({ path: join(dir, 'a.txt') }, aborted.signal))
      .resolves.toMatchObject({ ok: false, error: { code: 'cancelled' } })

    const live = new AbortController()
    const result = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt') }, live.signal)
    expect(result).toMatchObject({ ok: true, value: { content: 'data' } })
  })

  it('caps the limit at the deployment chunk size', async () => {
    await writeFile(join(dir, 'a.txt'), 'y'.repeat(400 * 1024))
    const rpc = remote(await context())

    const result = await rpc.readWorkspaceFile({ path: join(dir, 'a.txt'), limit: 10 * 1024 * 1024 })
    expect(result).toMatchObject({ ok: true, value: { size: 256 * 1024 } })
  })
})
