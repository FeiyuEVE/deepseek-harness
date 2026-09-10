# Agent Note: OpenCode Go session header on llm-pi-ai routes

Status: implemented

English | [中文](2026-09-08-opencode-go-session-header.zh.md)

## Problem

OpenCode Go — the low-cost subscription relay at `https://opencode.ai/zen/go/v1` — began rejecting every model request that carries no `x-opencode-session` header with HTTP 400 `MissingSessionID` on 2026-09-05, so it can route requests and reuse prompt caches per conversation. The relay documents the requirement at [opencode.ai/docs/go](https://opencode.ai/docs/go/#where-can-i-use-it) and lists DeepSeek Harness among clients whose session information is missing on some model paths (tracked in [deepseek-harness discussion #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)).

`llm-pi-ai` routes such a gateway as a profile (`api: openai-completions`, `baseURL: https://opencode.ai/zen/go/v1`). Its dependency `@earendil-works/pi-ai` 0.84.x–0.85.x only maps the stream `sessionId` option to `x-session-id` (OpenRouter) or `session_id`/`x-session-affinity` (OpenAI) under its compat switches — there is no `x-opencode-session` path, so no configuration could put the harness conversation id on these requests. Every request failed with the relay's 400; a static profile `headers` value only cleared the rejection by collapsing every conversation into one session, defeating the routing and caching the header exists for.

## Decision

A provider profile may name its gateway's session header through a new validated field `sessionHeader` (the current consumer names `x-opencode-session`). The adapter then sends the harness conversation id (`GenerateOptions.sessionId`, already forwarded to pi-ai as the stream `sessionId` option) on every request of that route; a request the loop leaves unstamped carries a stable per-process fallback id instead, minted once per adapter instance and route, because the gateway rejects header-less requests outright. The fallback id is what the seam's optional `sessionId` costs: hand-built calls still satisfy the gateway without collapsing conversations the loop does stamp.

Static deployment `headers` of the same name lose to the dynamic value (only the conversation id varies per conversation), and `sessionHeader` names that collide with Harness attribution headers are refused at configuration resolution — attribution wins every collision by invariant, so such a value could never reach the wire. Fetch-unrepresentable and empty names are refused the same way.

The feature lives entirely in `llm-pi-ai` (config schema/validation in `src/config.ts`, injection in `src/adapter.ts`) because pi-ai does not implement the header and a catalog-route fix would depend on an upstream pi-ai release. When pi-ai ships native OpenCode session affinity, deployments can drop `sessionHeader` and the field stays a general per-route gateway knob.

## Alternatives considered

**Bump `@earendil-works/pi-ai` to a build with native OpenCode support.** Not available: the checked 0.85.1 dist still emits no `x-opencode-session` anywhere.

**Auto-detect OpenCode Go from the provider id or `baseURL` and inject the header implicitly.** Hides a gateway contract the deployment already states in its profile; the repo convention is explicit validated configuration over implicit vendor sniffing, and the same mechanism then serves any future relay that requires a session header.

**Keep the static profile `headers` workaround.** It cleared the 400 but collapsed every conversation and every process onto one session id, which is exactly the routing/cache degradation the header requirement exists to prevent, and it offered no per-conversation path once pi-ai grows native support.

## Consequences

- A route configured with `sessionHeader: x-opencode-session` sends the harness conversation id per request (fallback: a per-process id per route), satisfying the OpenCode Go relay on every call path, including auxiliary ones whose loop callers stamp no session id.
- Hand-edited or surfaced `settings.yaml` profiles gain one optional field; profiles that never set it send no session header, exactly as before.
- The seam's `GenerateOptions.sessionId` remains optional; only routes that opt in are affected by the fallback.
- Attribution-header collisions with `sessionHeader` fail loudly at profile resolution rather than silently losing the header on the wire.
- Fork-local until upstream discussion #5495 lands a pi-ai/dsh native fix; the config field is designed to be dropped then, keeping only the attribution-collision validation worth upstreaming on its own.
