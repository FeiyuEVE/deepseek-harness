/** General Settings row for assistant-Markdown presentation. */

import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarkdownViewMode } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import { PreferenceRow } from './PreferenceRow.tsx'

/** Registration-side Markdown preference face. */
export interface MarkdownViewRowInjected {
  hooks: {
    /** Persisted Markdown preference bound as useMarkdownView. */
    markdownView: SnapshotStore<MarkdownViewMode>
  }
  /** Change the assistant-Markdown presentation. */
  setMarkdownView: (mode: MarkdownViewMode) => void
}

/** Full Settings-row props. */
export type MarkdownViewRowProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'chat'>
  & InjectFace<MarkdownViewRowInjected>

const OPTIONS: readonly { id: MarkdownViewMode; label: ChatKey }[] = [
  { id: 'render', label: 'settings.markdown.render' },
  { id: 'raw', label: 'settings.markdown.raw' },
]

/**
 * Render the assistant-Markdown presentation selector.
 * @param props - composed Settings slot props.
 * @returns the preference row.
 */
export function MarkdownViewRow({ useMarkdownView, setMarkdownView, t }: MarkdownViewRowProps) {
  const mode = useMarkdownView(value => value)
  const selectedLabel = mode === 'render'
    ? 'settings.markdown.render'
    : 'settings.markdown.raw'
  return (
    <PreferenceRow
      title={t('settings.markdown.title')}
      description={t('settings.markdown.description')}
      selectedLabel={t(selectedLabel)}
      options={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
      selectedId={mode}
      onSelect={setMarkdownView}
    />
  )
}
