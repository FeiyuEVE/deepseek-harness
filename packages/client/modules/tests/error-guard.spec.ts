/**
 * The catch-all frontend error guard: capture, dedup, queue, and throttled
 * delivery. The script is executed in a sandboxed window stub and driven by
 * synthetic events; delivery is observed through sendBeacon and XMLHttpRequest
 * stubs.
 */

import { describe, expect, it } from 'vitest'
import { runInNewContext } from 'node:vm'
import { ERROR_GUARD_MARK, ERROR_GUARD_ROW, ERROR_GUARD_SCRIPT } from '../src/error-guard.ts'

interface SentReport {
  url: string
  body: Promise<string>
}

interface XhrCall {
  method: string
  url: string
  headers: Record<string, string>
  body: string
}

interface Harness {
  window: Record<string, unknown>
  dispatch(type: string, event: unknown): void
  runFlush(): void
  sent: SentReport[]
  xhrCalls: XhrCall[]
  failNextXhr(): void
}

function makeHarness(options: {
  beacon?: boolean
  storageThrows?: boolean
  customIntake?: string
  remote?: boolean
} = {}): Harness {
  const listeners = new Map<string, Array<(event: unknown) => void>>()
  const storage = new Map<string, string>()
  const sent: SentReport[] = []
  const xhrCalls: XhrCall[] = []
  let timerFn: (() => void) | null = null
  let failNext = false

  const location = options.remote
    ? {
      href: 'https://feiyueve.com:18443/conversation',
      protocol: 'https:',
      hostname: 'feiyueve.com',
      port: '18443',
      host: 'feiyueve.com:18443',
    }
    : {
      href: 'http://localhost:3080/conversation',
      protocol: 'http:',
      hostname: 'localhost',
      port: '3080',
      host: 'localhost:3080',
    }

  const window: Record<string, unknown> = {
    [ERROR_GUARD_MARK]: undefined,
    location,
    localStorage: {
      getItem: (key: string) => {
        if (options.storageThrows) throw new Error('localStorage denied')
        return storage.has(key) ? storage.get(key) : null
      },
      setItem: (key: string, value: string) => {
        if (options.storageThrows) throw new Error('localStorage denied')
        storage.set(key, value)
      },
    },
    setTimeout: (fn: () => void) => {
      timerFn = fn
      return 1
    },
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      const list = listeners.get(type) ?? []
      list.push(fn)
      listeners.set(type, list)
    },
  }
  if (options.customIntake !== undefined) window.__DSH_RESCUE_INTAKE__ = options.customIntake

  class FakeXhr {
    method = ''
    url = ''
    headers: Record<string, string> = {}
    body = ''
    status = 200
    onload: (() => void) | null = null
    onerror: (() => void) | null = null
    open(method: string, url: string): void {
      this.method = method
      this.url = url
    }
    setRequestHeader(key: string, value: string): void {
      this.headers[key] = value
    }
    send(body: string): void {
      this.body = body
      xhrCalls.push({ method: this.method, url: this.url, headers: this.headers, body })
      if (failNext) {
        failNext = false
        this.onerror?.()
      } else {
        this.onload?.()
      }
    }
  }

  const sandbox: Record<string, unknown> = {
    window,
    Blob,
    Date,
    JSON,
    Error,
    String,
    XMLHttpRequest: FakeXhr,
  }
  if (options.beacon !== false) {
    sandbox.navigator = {
      sendBeacon: (url: string, blob: Blob) => {
        sent.push({ url, body: blob.text() })
        return true
      },
    }
  }

  runInNewContext(ERROR_GUARD_SCRIPT, sandbox)

  return {
    window,
    dispatch(type: string, event: unknown): void {
      for (const fn of listeners.get(type) ?? []) fn(event)
    },
    runFlush(): void {
      const fn = timerFn
      timerFn = null
      fn?.()
    },
    sent,
    xhrCalls,
    failNextXhr(): void {
      failNext = true
    },
  }
}

function errorEvent(partial: Record<string, unknown>): Record<string, unknown> {
  // The guard reads `error.message` (not the Event's own message), so the
  // inner error must follow an overridden outer message or the signature
  // dedup collapses distinct events.
  const message = partial.message === undefined ? 'boom' : String(partial.message)
  return {
    message,
    filename: 'http://localhost:3080/app.js',
    lineno: 12,
    colno: 3,
    error: { message, stack: `Error: ${message}\n    at app.js:12` },
    ...partial,
  }
}

async function drain(sent: SentReport[]): Promise<Array<{ url: string; body: Record<string, unknown> }>> {
  return Promise.all(sent.map(async s => ({ url: s.url, body: JSON.parse(await s.body) })))
}

describe('frontend error guard script', () => {
  it('captures an uncaught error and reports it to the same-origin log-ingest primary', async () => {
    const h = makeHarness()
    h.dispatch('error', errorEvent({}))
    h.runFlush()
    const reports = await drain(h.sent)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.url).toBe('http://localhost:3080/log-ingest')
    expect(reports[0]!.body).toMatchObject({
      source: 'frontend',
      kind: 'window-error',
      message: 'boom',
      line: 12,
      col: 3,
      tenant: 'dsh',
      dsh_component: 'client-error',
      level: 'error',
      service: 'dsh-web-client',
    })
    expect(reports[0]!.body.url).toBe('http://localhost:3080/conversation')
    expect(h.sent).toHaveLength(1)
  })

  it('falls back to the decoupled self-rescue intake when configured and the primary fails', async () => {
    const h = makeHarness({ beacon: false, customIntake: 'http://127.0.0.1:18445/report' })
    h.dispatch('error', errorEvent({}))
    h.failNextXhr()
    h.runFlush()
    expect(h.xhrCalls).toHaveLength(2)
    expect(h.xhrCalls[0]!.url).toBe('http://localhost:3080/log-ingest')
    expect(h.xhrCalls[1]!.url).toBe('http://127.0.0.1:18445/report')
  })

  it('deduplicates identical signatures within the window', async () => {
    const h = makeHarness()
    h.dispatch('error', errorEvent({}))
    h.dispatch('error', errorEvent({}))
    h.dispatch('error', errorEvent({ message: 'different' }))
    h.runFlush()
    h.runFlush()
    const reports = await drain(h.sent)
    expect(reports).toHaveLength(2)
    expect(reports.map(r => r.body.message).sort()).toEqual(['boom', 'different'])
  })

  it('captures resource-load errors through the capture phase', async () => {
    const h = makeHarness()
    h.dispatch('error', {
      message: '',
      target: { tagName: 'IMG', src: 'http://localhost:3080/missing.png' },
    })
    h.runFlush()
    const reports = await drain(h.sent)
    expect(reports[0]!.body).toMatchObject({
      kind: 'resource-error',
      sourceUrl: 'http://localhost:3080/missing.png',
    })
  })

  it('captures unhandled rejections', async () => {
    const h = makeHarness()
    h.dispatch('unhandledrejection', { reason: new Error('async boom') })
    h.runFlush()
    const reports = await drain(h.sent)
    expect(reports[0]!.body).toMatchObject({ kind: 'unhandled-rejection', message: 'async boom' })
  })

  it('falls back to XHR without sendBeacon and requeues on failure', async () => {
    const h = makeHarness({ beacon: false })
    h.dispatch('error', errorEvent({}))
    h.failNextXhr()
    h.runFlush()
    expect(h.xhrCalls).toHaveLength(1)
    expect(h.xhrCalls[0]!.method).toBe('POST')
    expect(h.xhrCalls[0]!.headers['content-type']).toBe('text/plain')
    // failed delivery requeued: the next flush retries
    h.runFlush()
    expect(h.xhrCalls).toHaveLength(2)
    const retried = JSON.parse(h.xhrCalls[1]!.body) as Record<string, unknown>
    expect(retried.message).toBe('boom')
  })

  it('never throws when localStorage is unavailable', () => {
    const h = makeHarness({ storageThrows: true })
    expect(() => h.dispatch('error', errorEvent({}))).not.toThrow()
    expect(() => h.runFlush()).not.toThrow()
    expect(h.sent).toHaveLength(0)
  })

  it('routes remote pages (mobile tunnel) to the same-origin log-ingest primary', async () => {
    const h = makeHarness({ remote: true })
    h.dispatch('error', errorEvent({}))
    h.runFlush()
    const reports = await drain(h.sent)
    expect(reports).toHaveLength(1)
    expect(reports[0]!.url).toBe('https://feiyueve.com:18443/log-ingest')
  })


  it('exports a head script row whose source cannot break the injection renderer', () => {
    expect(ERROR_GUARD_ROW).toEqual({ kind: 'script', placement: 'head', text: ERROR_GUARD_SCRIPT })
    expect(ERROR_GUARD_SCRIPT).not.toContain('</script')
  })
})
