/** Per-Session Chat selection store shared by the transcript and details panel. */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import type { AssistantMessageId, ChatStoreState, SelectionTarget, TurnProcessViewEntry } from './contract/store.ts'

type ChatActions = {
  select: (draft: ChatStoreState, target: SelectionTarget | null) => void
  setTurnProcessOpen: (
    draft: ChatStoreState,
    turn: number,
    answerStep: number,
    open: boolean,
  ) => void
  openFilePreview: (draft: ChatStoreState, path: string) => void
  closeFilePreview: (draft: ChatStoreState) => void
  /** Set one message's explicit presentation override (true = raw, false = rendered). */
  setMessageRaw: (draft: ChatStoreState, messageId: AssistantMessageId, raw: boolean) => void
}

/**
 * Resolve the manually expanded answer for one Turn.
 * @param state - Chat store snapshot.
 * @param turn - owning Turn.
 * @returns the Turn's stored entry, when present.
 */
export function storedTurnProcessEntry(
  state: Readonly<ChatStoreState>,
  turn: number,
): Readonly<TurnProcessViewEntry> | undefined {
  return state.turnProcesses.find(entry => entry.turn === turn)
}

/**
 * Create the Chat selection store handle.
 * @returns a handle instantiated once per rendered Session scope.
 */
export function createChatStore(): EngineStoreHandle<ChatStoreState, ChatActions> {
  return defineStore({
    init: (): ChatStoreState => ({
      selection: null,
      turnProcesses: [],
      filePreview: null,
      rawOverrides: {},
    }),
    actions: {
      select: (draft, target: SelectionTarget | null) => { draft.selection = target },
      setTurnProcessOpen: (draft, turn, answerStep, open) => {
        const index = draft.turnProcesses.findIndex(entry => entry.turn === turn)
        if (!open) {
          if (index >= 0) draft.turnProcesses.splice(index, 1)
          return
        }
        const next = { turn, answerStep } satisfies TurnProcessViewEntry
        if (index < 0) draft.turnProcesses.push(next)
        else draft.turnProcesses[index] = next
      },
      openFilePreview: (draft, path: string) => { draft.filePreview = { path } },
      closeFilePreview: (draft) => { draft.filePreview = null },
      setMessageRaw: (draft, messageId: AssistantMessageId, raw: boolean) => {
        draft.rawOverrides[messageId] = raw
      },
    },
  })
}
