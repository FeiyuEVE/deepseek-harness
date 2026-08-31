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
 * `navigator.sendBeacon`. Reports follow the logging-stack HTTP JSON protocol
 * (see workspace `logging-stack/docs/PLUGIN-LOG-INGEST.md`): each entry
 * carries `tenant`/`level`/`service` plus structured extension fields.
 *
 * Delivery endpoints, in order (both go to the ES log store):
 * 1. same-origin `/log-ingest` — the dsh web host route that forwards to the
 *    Logstash HTTP channel (`logstash-dsh-client-error`) and keeps writing
 *    `client-error.log` + `client-error.flag` for the supervisor's restart /
 *    rescue watcher; works on loopback and remote (public tunnel) pages alike
 *    because it is same-origin;
 * 2. fallback `window.__DSH_RESCUE_INTAKE__` (injected by the deployment's
 *    web runtime config, pointing at the decoupled self-rescue supervisor
 *    intake) on loopback pages, or same-origin `/rescue-intake/report` on
 *    remote pages (the public tunnel reverse proxy) — reachable even when the
 *    dsh web process itself is down; entries land in `intake-reports.log`,
 *    which Filebeat ships to `logstash-dsh-intake-reports`.
 *
 * Reports are sent as `text/plain` JSON so the cross-origin fallback request
 * needs no CORS preflight. Manual self-rescue is owned by the Android app's
 * native button, not by this script.
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
  function isRemoteHost() {
    try {
      var host = window.location.hostname
      return typeof host === 'string' && host !== '' && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1'
    } catch (e) { return false }
  }
  function primaryIntake() {
    // Remote pages (mobile via the public tunnel) reach a token-guarded nginx
    // /log-ingest upstream; a tokenless guard POST is always 403 there (and
    // the guard cannot carry the deployment token). Skip straight to the
    // /rescue-intake reverse-proxy fallback on remote hosts instead.
    if (isRemoteHost()) return ''
    var origin = pageOrigin()
    return origin !== '' ? origin + '/log-ingest' : ''
  }
  function fallbackIntake() {
    try {
      // Remote pages (mobile via the public tunnel) must not use a loopback
      // address — that would mean the phone itself. The same-origin
      // /rescue-intake reverse proxy reaches the supervisor intake instead.
      if (isRemoteHost()) return pageOrigin() + '/rescue-intake/report'
      var custom = window.__DSH_RESCUE_INTAKE__
      if (typeof custom === 'string' && custom !== '') return custom
      return ''
    } catch (e) { return '' }
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
      // logging-stack protocol fields (PLUGIN-LOG-INGEST.md).
      entry.tenant = 'dsh'
      entry.dsh_component = 'client-error'
      entry.level = 'error'
      entry.service = 'dsh-web-client'
      entry.message = entry.message || ''
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
  function deliver(targets, entry, body, idx) {
    if (idx >= targets.length) { requeue(entry); return }
    var url = targets[idx]
    try {
      if (idx === 0 && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
        try {
          if (navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))) return
        } catch (e) {}
      }
      var xhr = new XMLHttpRequest()
      xhr.open('POST', url, true)
      xhr.setRequestHeader('content-type', 'text/plain')
      xhr.onload = function () { if (xhr.status !== 200) deliver(targets, entry, body, idx + 1) }
      xhr.onerror = function () { deliver(targets, entry, body, idx + 1) }
      xhr.send(body)
    } catch (e) { deliver(targets, entry, body, idx + 1) }
  }
  function flush() {
    flushTimer = null
    var q = readQueue()
    if (q.length === 0) return
    var entry = q.shift()
    writeQueue(q)
    if (q.length > 0) schedule()
    var targets = []
    var prim = primaryIntake()
    if (prim !== '') targets.push(prim)
    var fb = fallbackIntake()
    if (fb !== '' && targets.indexOf(fb) === -1) targets.push(fb)
    if (targets.length === 0) targets.push('/client-error')
    try {
      deliver(targets, entry, JSON.stringify(entry), 0)
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
