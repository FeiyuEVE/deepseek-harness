/** Shared General-Settings row: label block plus a Menu-backed value selector. */

import { useState } from 'react'
import { IconChevronDownOutline14, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ReactNode } from 'react'
import css from './PreferenceRow.module.css'

/** One selectable value of a {@link PreferenceRow}. */
export interface PreferenceOption<Value extends string> {
  id: Value
  /** Localized row label inside the open menu. */
  label: string
}

export interface PreferenceRowProps<Value extends string> {
  /** Localized preference name. */
  title: string
  /** Localized sentence explaining what the preference controls. */
  description: string
  /** Localized label of the current value, shown on the closed selector. */
  selectedLabel: string
  /** Every value the menu offers. */
  options: readonly PreferenceOption<Value>[]
  /** The currently selected value; the menu marks its row. */
  selectedId: Value
  /** Persist and apply one chosen value. */
  onSelect: (value: Value) => void
}

/**
 * Render one preference row whose values are mutually exclusive.
 * @param props - localized copy, the offered values, and the selection.
 * @returns the preference row with its selector and menu.
 */
export function PreferenceRow<Value extends string>({
  title, description, selectedLabel, options, selectedId, onSelect,
}: PreferenceRowProps<Value>): ReactNode {
  const [open, setOpen] = useState(false)
  const closeMenu = (): void => { setOpen(false) }
  return (
    <div className={css.row}>
      <div className={css.rowText}>
        <div className={css.title}>{title}</div>
        <div className={css.desc}>{description}</div>
      </div>
      <Menu
        open={open}
        onClose={closeMenu}
        items={options.map(option => ({ id: option.id, label: option.label }))}
        selectedId={selectedId}
        onSelect={(id) => {
          closeMenu()
          onSelect(id as Value)
        }}
        align="end"
        portal
        anchor={(
          <button
            type="button"
            className={css.selector}
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => { setOpen(value => !value) }}
          >
            {selectedLabel}
            <IconChevronDownOutline14 className={css.chevron} />
          </button>
        )}
      />
    </div>
  )
}
