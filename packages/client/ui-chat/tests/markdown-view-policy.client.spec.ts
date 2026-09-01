// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { stubSettingsScope } from '@deepseek-ai/dsh-client-test-runtime'
import type { ChatSettings } from '../src/chat-settings.ts'
import { MarkdownViewPolicy } from '../src/client/markdown-view.ts'

describe('MarkdownViewPolicy', () => {
  it('defaults to Rendered and publishes explicit choices before persistence settles', () => {
    const host = stubSettingsScope<ChatSettings>()
    const observed: string[] = []
    let current = (): string => 'unconstructed'
    const scope: typeof host.scope = {
      ...host.scope,
      set: (field, value) => {
        observed.push(`${field}=${String(value)}:${current()}`)
        return host.scope.set(field, value)
      },
    }
    const policy = new MarkdownViewPolicy(scope)
    current = () => policy.mode.getSnapshot()

    expect(policy.mode.getSnapshot()).toBe('render')
    policy.setMode('raw')
    expect(policy.mode.getSnapshot()).toBe('raw')
    expect(observed).toEqual(['markdownView=raw:raw'])
    expect(host.set).toHaveBeenCalledWith('markdownView', 'raw')
  })

  it('adopts Host state and ignores identical writes', () => {
    const host = stubSettingsScope<ChatSettings>()
    const policy = new MarkdownViewPolicy(host.scope)

    host.publish({ status: 'ready', value: { transcriptView: 'compact', markdownView: 'raw' }, revision: 1, writable: true })
    expect(policy.mode.getSnapshot()).toBe('raw')
    policy.setMode('raw')
    expect(host.set).not.toHaveBeenCalled()

    host.publish({ value: { transcriptView: 'compact', markdownView: 'render' }, revision: 2 })
    expect(policy.mode.getSnapshot()).toBe('render')
  })

  it('adopts an accepted section standing at construction', () => {
    const host = stubSettingsScope<ChatSettings>()
    host.publish({ status: 'ready', value: { transcriptView: 'compact', markdownView: 'raw' }, revision: 1, writable: true })
    expect(new MarkdownViewPolicy(host.scope).mode.getSnapshot()).toBe('raw')
  })
})
