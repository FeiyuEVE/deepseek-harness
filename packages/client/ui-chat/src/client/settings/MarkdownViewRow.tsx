/** General Settings row for assistant-Markdown presentation. */

import { useState } from 'react'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-store'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { MarkdownViewMode } from '../../chat-settings.ts'
import type { ChatKey } from '../locale.ts'
import css from './MarkdownViewRow.module.css'

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
  const [open, setOpen] = useState(false)
  const selectedLabel = mode === 'render'
    ? 'settings.markdown.render'
    : 'settings.markdown.raw'
  const closeMenu = () => { setOpen(false) }
  const selectMode = (id: string) => {
    closeMenu()
    setMarkdownView(id as MarkdownViewMode)
  }
  const selector = (
    <button
      type="button"
      className={css.selector}
      aria-haspopup="menu"
      aria-expanded={open}
      onClick={() => { setOpen(value => !value) }}
    >
      {t(selectedLabel)}
      <IconChevronDownOutline14 className={css.chevron} />
    </button>
  )

  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{t('settings.markdown.title')}</div>
        <div className={css.desc}>{t('settings.markdown.description')}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={OPTIONS.map(option => ({ id: option.id, label: t(option.label) }))}
        selectedId={mode}
        onSelect={selectMode}
        align="end"
        portal
        anchor={selector}
      />
    </div>
  )
}
