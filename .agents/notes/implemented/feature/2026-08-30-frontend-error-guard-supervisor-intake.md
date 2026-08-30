# Agent Note: decoupled frontend error guard with supervisor intake and manual self-rescue

Status: implemented

## Problem

The frontend error guard reported through the web profile's own HTTP server — the very process most likely to be broken when a report matters. The capture bundle also registered only after the application booted, so a crash in an earlier bundle or in the shell itself was invisible, and renderer-level failures could not be detected at all. There was no routine path that handed collected exceptions to the rescue agent for analysis; the supervisor only launched the rescue agent on recurring crashes.

## Decision

The catch-all capture moves to the outermost layer of the served page: `dsh-client-modules` now injects an inline error-guard script as the first `<head>` row (via `table.unshift` on `webserver/index-inject`), before the module-system facade and every bundle. The script captures `error` (capture phase, so resource-load failures are included), `unhandledrejection`, and `securitypolicyviolation`, deduplicates signatures within a 30 s window, queues in memory plus `localStorage` (survives reloads), throttles to one report per flush, retries failed deliveries, and never throws. Reports are sent as `text/plain` JSON so the cross-origin request needs no CORS preflight.

The intake URL is resolved lazily and adapts to the page origin: on loopback pages it is `window.__DSH_RESCUE_INTAKE__` (injected by `dsh-web-app`'s `rescueIntakeUrl` config, e.g. `http://127.0.0.1:18445/report`; the fallback stays `/client-error`), while on remote pages (the mobile tunnel, where `127.0.0.1` would mean the phone itself) it is the same-origin reverse proxy `location.origin + '/rescue-intake/report'`, served by the frps nginx over the new `dsh-rescue-intake` frp tunnel (`18445` → `18445`).

Manual self-rescue is owned by the **Android app's native button** (`dsh-mobile` fork, `SelfRescueClient` + the connection-failure dialog's Self-rescue action): it POSTs `{source:'android-app', kind:'manual-rescue', message, ts}` to `https://<remote gateway>/rescue-intake/rescue`, works even when the DSH web profile failed to start, and asks for explicit confirmation first (the web page carries no rescue button at all). The guard script itself only reports.

The decoupled sink is the supervisor: `dsh-web-supervisor` serves a loopback HTTP intake (`POST /report` and `POST /rescue`, plus `GET /health` `/reports` `/analysis` `/log`, CORS-open) and appends every report to `~/.dsh/profiles/web/.service/intake-reports.log`. The web backend's abnormal exits are appended to the same intake as `web-process-crash` entries.

The rescue agent runs **only on demand** — no background poller: crash-triggered (the existing quick-crash/flag rescue paths) or user-triggered via `POST /rescue`. A manual run spawns `dsh --profile rescue` with the latest intake reports plus the user's note as context, instructs the agent that the web profile is running (no restarts, minimal reversible fixes only), records the final message in `intake-analysis.log`, and restarts the web profile on exit **only when the profile is still down** (so the app button can bring DSH back after a failed boot). One rescue agent at a time (`rescueActive` guards both triggers; `POST /rescue` answers `409` while one runs). The on-demand design replaces the earlier every-5-min analysis poller: idle polling burned model tokens for a sink that only the user or a crash can meaningfully act on. A real-world run (2026-08-30, user-triggered) diagnosed and repaired a UTF-8-mangled favicon PNG in a bundle.

## Alternatives considered

**Keep the in-profile intake.** Rejected: reporting through the broken process defeats the purpose.

**New repository rescue-service profile.** Rejected for now: the supervisor is already an always-on process independent of the web profile and already owns rescue dispatch; one loopback endpoint is the minimal decoupled sink.

**Report the full backend log stream.** Rejected: only error-level events (crash path today; the intake format is open to future in-process hooks) are reported, matching the analysis use case without log-volume cost.

**Keep the periodic analysis poller.** Rejected: every run costs a rescue-agent process and model tokens, and the reports it evaluated were rarely actionable on a schedule; the manual button and crash triggers cover the actionable cases.

**Point the mobile page at the loopback intake.** Rejected: `127.0.0.1` on a phone is the phone; the same-origin `/rescue-intake` nginx proxy avoids mixed-content and certificate issues entirely.

## Consequences

- A crash in any bundle after the guard is observable and reportable even on a white-screened page, as long as the JS engine, network, and supervisor survive; renderer-level deaths remain out-of-band (the heartbeat extension is deferred).
- Frontend reports no longer depend on `dsh-web-guard`; the deployment's `rescueIntakeUrl` config switches them to the supervisor intake, and the old flag pipeline stays as a fallback while the supervisor is not restarted.
- Mobile pages report and trigger rescue through the same-origin `/rescue-intake` proxy; this requires the frp tunnel `dsh-rescue-intake` and an nginx `location /rescue-intake/` → `127.0.0.1:18445` proxy on the frps host.
- Rescue runs cost one rescue-agent process per trigger; a run while another is active is refused with `409` instead of queued.
- The supervisor fails open on intake errors: a busy port disables intake with a loud log line instead of taking the web profile down.

## Related decisions

The repair rescue (crash-loop quarantine, git rollback, rescue-agent repair) remains owned by `dsh-web-supervisor` as before; manual self-rescue is additive and shares its `rescueActive` guard.
