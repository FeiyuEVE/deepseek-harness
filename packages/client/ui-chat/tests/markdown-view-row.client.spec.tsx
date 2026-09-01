// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionPendingInteractionSnapshot } from '@deepseek-ai/dsh-client-ui-session/client'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import { bindSnapshotSelector, makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { MarkdownViewRow, type MarkdownViewRowProps } from '../src/client/settings/MarkdownViewRow.tsx'
import { en } from '../src/client/locale.ts'

afterEach(cleanup)

function emptySessions() {
  return bindSnapshotSelector(createSnapshotStore<SessionListState>({
    ids: [], byId: {}, current: undefined, phase: 'ready', subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }))
}

function emptyWorkspaces() {
  return bindSnapshotSelector(createSnapshotStore<WorkspaceSnapshot>({
    items: [], archivedSessionIds: [], state: 'idle', phase: 'ready', error: null,
  }))
}

function noPendingInteraction() {
  return bindSnapshotSelector(createSnapshotStore<SessionPendingInteractionSnapshot>(new Map()))
}

function mount(mode: 'render' | 'raw' = 'render') {
  const source = createSnapshotStore(mode)
  const setMarkdownView = vi.fn((next: 'render' | 'raw') => { source.set(next) })
  const props: MarkdownViewRowProps = {
    useSessions: emptySessions(),
    useSessionPendingInteraction: noPendingInteraction(),
    useWorkspaces: emptyWorkspaces(),
    useMarkdownView: bindSnapshotSelector(source),
    setMarkdownView,
    t: makeTranslate(en),
  }
  render(<MarkdownViewRow {...props} />)
  return { setMarkdownView }
}

describe('MarkdownViewRow', () => {
  it('explains the preference and shows Rendered by default', () => {
    mount()
    expect(screen.getByText('Markdown display')).toBeDefined()
    expect(screen.getByText('Controls whether assistant messages render or show raw source')).toBeDefined()
    expect(screen.getByRole('button', { name: /Rendered/ }).getAttribute('aria-expanded')).toBe('false')
  })

  it('selects Raw and follows the mirrored value', () => {
    const b = mount()
    fireEvent.click(screen.getByRole('button', { name: /Rendered/ }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Raw' }))
    expect(b.setMarkdownView).toHaveBeenCalledWith('raw')
    const trigger = screen.getByRole('button', { name: /Raw/ })
    fireEvent.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Rendered' })).toBeDefined()
  })
})
