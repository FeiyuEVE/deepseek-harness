/**
 * The catch-all frontend error guard: an inline classic script injected as
 * the outermost `<head>` row of the served index — before the module-system
 * facade, before every bundle, before the shell. It is the only page code
 * guaranteed to observe a crash in anything that follows, so it captures and
 * reports without depending on the application, React, the DOM, or the module
 * table, and never throws.
 *
 * The script queues reports in memory and `localStorage` (the queue survives
 * reloads), deduplicates identical signatures within a short window,
 * throttles delivery to one report per request with a bounded flush, retries
 * failed deliveries on the next flush, and flushes on `pagehide` through
 * `navigator.sendBeacon`. The endpoint is resolved lazily: on loopback pages
 * it is `window.__DSH_RESCUE_INTAKE__` (injected by the deployment's web
 * runtime config, pointing at the decoupled self-rescue service) with the
 * in-profile intake `/client-error` as fallback; on remote pages (mobile via
 * the public tunnel) it is the same-origin `/rescue-intake` reverse proxy,
 * because the loopback address would mean the phone itself. Reports are sent
 * as `text/plain` JSON so the cross-origin request needs no CORS preflight.
 *
 * Manual self-rescue is owned by the Android app's native button, not by
 * this script.
 * @module
 */

import type { IndexInjection } from '@deepseek-ai/dsh-host-webserver'

/** The guard's one-time installation marker on `window`. */
const GUARD_MARK = '__dshErrorGuard'

/**
 * The inline guard source. Plain ES5-style browser script: no backticks, no
 * `${` interpolation, no `</script` sequence (the injection renderer rejects
 * it), no imports. Every step is wrapped so a broken environment (missing
 * localStorage, a throwing getter) can never break the page.
 */
const GUARD_SOURCE = `(() => {
  if (typeof window === 'undefined' || window.__dshErrorGuard) return
  window.__dshErrorGuard = true
  var STORE = '__dshErrorQueue'
  var MAX_QUEUE = 100
  var BATCH_MAX = 10
  var FLUSH_DELAY = 5000
  var DEDUP_MS = 30000
  var flushTimer = null
  var seen = {}
  var seenCount = 0
  function pageOrigin() {
    try {
      var l = window.location
      var port = l.port ? ':' + l.port : ''
      return l.protocol + '//' + l.hostname + port
    } catch (e) { return '' }
  }
  function intakeBase() {
    try {
      var host = window.location.hostname
      var remote = typeof host === 'string' && host !== '' && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1'
      if (remote) return pageOrigin() + '/rescue-intake'
      var custom = window.__DSH_RESCUE_INTAKE__
      if (typeof custom === 'string' && custom !== '') {
        var slash = custom.indexOf('/', custom.indexOf('//') + 2)
        return slash === -1 ? custom : custom.slice(0, slash)
      }
      return ''
    } catch (e) { return '' }
  }
  function intake() {
    var base = intakeBase()
    return base !== '' ? base + '/report' : '/client-error'
  }
  function readQueue() {
    try {
      var raw = window.localStorage.getItem(STORE)
      var arr = raw ? JSON.parse(raw) : []
      return Array.isArray(arr) ? arr : []
    } catch (e) { return [] }
  }
  function writeQueue(q) {
    try { window.localStorage.setItem(STORE, JSON.stringify(q)) } catch (e) {}
  }
  function schedule() {
    if (flushTimer === null) flushTimer = window.setTimeout(flush, FLUSH_DELAY)
  }
  function enqueue(entry) {
    try {
      var now = Date.now()
      var sig = entry.kind + '|' + entry.message + '|' + (entry.sourceUrl || entry.source)
      var last = seen[sig]
      if (last !== undefined && now - last < DEDUP_MS) return
      if (seenCount > 500) { seen = {}; seenCount = 0 }
      seen[sig] = now
      seenCount++
      entry.ts = now
      entry.url = window.location.href.slice(0, 500)
      var q = readQueue()
      q.push(entry)
      if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE)
      writeQueue(q)
      schedule()
    } catch (e) {}
  }
  function requeue(entry) {
    try {
      var q = readQueue()
      q.unshift(entry)
      if (q.length > MAX_QUEUE) q.splice(0, q.length - MAX_QUEUE)
      writeQueue(q)
      schedule()
    } catch (e) {}
  }
  function flush() {
    flushTimer = null
    var q = readQueue()
    if (q.length === 0) return
    var entry = q.shift()
    writeQueue(q)
    if (q.length > 0) schedule()
    try {
      var body = JSON.stringify(entry)
      var ok = false
      if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try { ok = navigator.sendBeacon(intake(), new Blob([body], { type: 'text/plain' })) } catch (e) { ok = false }
      }
      if (ok) return
      var xhr = new XMLHttpRequest()
      xhr.open('POST', intake(), true)
      xhr.setRequestHeader('content-type', 'text/plain')
      xhr.onload = function () { if (xhr.status !== 200) requeue(entry) }
      xhr.onerror = function () { requeue(entry) }
      xhr.send(body)
    } catch (e) { requeue(entry) }
  }
  function describeError(e) {
    var err = e && e.error
    var target = e && e.target
    if (target && target.tagName) {
      return {
        source: 'frontend',
        kind: 'resource-error',
        message: String((e && e.message) || 'resource load failed'),
        sourceUrl: String(target.src || target.href || ''),
      }
    }
    return {
      source: 'frontend',
      kind: 'window-error',
      message: String((err && err.message) || (e && e.message) || ''),
      sourceUrl: String((e && e.filename) || ''),
      line: (e && e.lineno) || 0,
      col: (e && e.colno) || 0,
      stack: err && err.stack ? String(err.stack).slice(0, 4000) : '',
    }
  }
  window.addEventListener('error', function (e) { enqueue(describeError(e)) }, true)
  window.addEventListener('unhandledrejection', function (e) {
    var r = e && e.reason
    enqueue({
      source: 'frontend',
      kind: 'unhandled-rejection',
      message: r instanceof Error ? String(r.message) : String(r),
      stack: r instanceof Error && r.stack ? String(r.stack).slice(0, 4000) : '',
    })
  })
  window.addEventListener('securitypolicyviolation', function (e) {
    enqueue({
      source: 'frontend',
      kind: 'csp-violation',
      message: String((e && e.violatedDirective) || ''),
      sourceUrl: String((e && e.blockedURI) || ''),
    })
  })
  window.addEventListener('pagehide', function () { flush() })
})()`

/** The guard as an index injection row: head placement, first in the table. */
export const ERROR_GUARD_ROW: IndexInjection = { kind: 'script', placement: 'head', text: GUARD_SOURCE }

/** The guard script text, exported for tests. */
export const ERROR_GUARD_SCRIPT = GUARD_SOURCE

/** The one-time installation marker, exported for tests. */
export const ERROR_GUARD_MARK = GUARD_MARK
