/** Host-backed assistant-Markdown presentation policy. */

import { createSnapshotStore, type SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  DEFAULT_MARKDOWN_VIEW_MODE, MARKDOWN_VIEW_FIELD,
  type ChatSettings, type MarkdownViewMode,
} from '../chat-settings.ts'

/** Live Markdown presentation preference consumed by Chat and its Settings row. */
export class MarkdownViewPolicy {
  /** Reactive current mode; defaults to Rendered before Host settings arrive. */
  readonly mode: SnapshotStore<MarkdownViewMode> = createSnapshotStore(DEFAULT_MARKDOWN_VIEW_MODE)

  /**
   * @param host - durable Chat settings scope.
   */
  constructor(private readonly host: SettingsScope<ChatSettings>) {
    host.subscribe(() => { this.adopt() })
    this.adopt()
  }

  /**
   * Publish and persist one explicit user choice.
   * @param mode - Rendered or raw Markdown presentation.
   */
  setMode(mode: MarkdownViewMode): void {
    if (this.mode.getSnapshot() === mode) return
    this.mode.set(mode)
    void this.host.set(MARKDOWN_VIEW_FIELD, mode)
  }

  /** Adopt the latest accepted Host section without writing it back. */
  private adopt(): void {
    const section = this.host.getSnapshot().value
    if (section === undefined || this.mode.getSnapshot() === section.markdownView) return
    this.mode.set(section.markdownView)
  }
}
