# Agent Note: OpenCode Go session header on llm-pi-ai routes

Status: implemented

[English](2026-09-08-opencode-go-session-header.md) | 中文

## Problem

OpenCode Go——位于 `https://opencode.ai/zen/go/v1` 的低成本订阅中继——自 2026-09-05 起拒绝所有不带 `x-opencode-session` 头的模型请求，返回 HTTP 400 `MissingSessionID`，以便按会话路由请求并复用提示缓存。中继在 [opencode.ai/docs/go](https://opencode.ai/docs/go/#where-can-i-use-it) 记录了该要求，并把 DeepSeek Harness 列为部分模型路径缺少会话信息的客户端（跟踪于 [deepseek-harness discussion #5495](https://github.com/deepseek-ai/deepseek-harness/discussions/5495)）。

`llm-pi-ai` 把这类网关登记为 profile（`api: openai-completions`、`baseURL: https://opencode.ai/zen/go/v1`）。其依赖 `@earendil-works/pi-ai` 0.84.x–0.85.x 只会把流式 `sessionId` 选项映射为 `x-session-id`（OpenRouter）或 `session_id`/`x-session-affinity`（OpenAI）——不存在 `x-opencode-session` 路径，因此任何配置都无法把 harness 会话 id 放到这些请求上。每个请求都被中继以 400 拒绝；静态 profile `headers` 值只能通过把所有会话压成一个会话来消除拒绝，恰恰破坏了该头本要服务的路由与缓存。

## Decision

Provider profile 新增受校验的字段 `sessionHeader`，用于点名其网关的会话头（当前消费者命名为 `x-opencode-session`）。adapter 随后把 harness 会话 id（`GenerateOptions.sessionId`，本已作为流式 `sessionId` 选项转发给 pi-ai）放到该路由的每个请求上；loop 未盖章的请求改携稳定、按进程生成的回退 id（每个 adapter 实例与路由各铸一次），因为网关会直接拒绝无头请求。回退 id 是接缝中可选 `sessionId` 的代价：手工构造的调用仍满足网关，同时不把 loop 已盖章的会话压到一起。

同名静态部署 `headers` 输给动态值（只有会话 id 才能随会话变化）；与 Harness 归因头冲突的 `sessionHeader` 名称在配置解析处被拒绝——归因头按不变量赢得一切冲突，此类值永远到不了线上。Fetch 无法表示的名称与空名称同样被拒。

该能力完全落在 `llm-pi-ai`（schema/校验在 `src/config.ts`，注入在 `src/adapter.ts`），因为 pi-ai 未实现该头，走目录路由修复将依赖 pi-ai 上游发版。当 pi-ai 原生支持 OpenCode 会话亲和后，部署可删除 `sessionHeader`，该字段作为通用的逐路由网关旋钮保留。

## Alternatives considered

**把 `@earendil-works/pi-ai` 升到原生支持 OpenCode 的构建。** 不可行：核查过的 0.85.1 dist 仍不产出任何 `x-opencode-session`。

**依据 provider id 或 `baseURL` 自动识别 OpenCode Go 并隐式注入。** 隐藏了部署已在 profile 中声明的网关契约；仓库惯例是显式、受校验的配置而非隐式厂商嗅探，且同一机制可服务未来任何要求会话头的类似中继。

**保留静态 profile `headers` 规避。** 它消除了 400，却把所有会话与进程压到同一个会话 id 上——这正是该头要求要防止的路由/缓存劣化——且当 pi-ai 原生支持后就失去逐会话路径。

## Consequences

- 配置 `sessionHeader: x-opencode-session` 的路由按请求发送 harness 会话 id（缺失时按路由使用逐进程 id），在所有调用路径上满足 OpenCode Go 中继，包括 loop 调用方未盖会话章的辅助路径。
- 手工编辑或界面呈现的 `settings.yaml` profile 多一个可选字段；未设置的路由与之前一样不发送会话头。
- 接缝 `GenerateOptions.sessionId` 仍为可选；只有显式选择的路由受回退影响。
- 与归因头冲突的 `sessionHeader` 在 profile 解析处响亮失败，而非在线上静默丢失。
- 在上游讨论 #5495 落地 pi-ai/dsh 原生修复前保持 fork 本地；届时该配置字段可删除，只保留值得单独上游化的归因冲突校验。
