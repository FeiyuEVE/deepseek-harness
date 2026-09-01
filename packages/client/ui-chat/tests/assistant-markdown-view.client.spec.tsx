// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { zh as commonZh } from '@deepseek-ai/dsh-client-locale/src/locales/zh.ts'
import type { RenderMessageImages } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AssistantMarkdown } from '../src/client/chat/AssistantMarkdown.tsx'
import { zh } from '../src/client/locale.ts'

afterEach(cleanup)

const t = makeTranslate(zh, commonZh)
const renderMessageImages: RenderMessageImages = () => null

describe('AssistantMarkdown presentation modes', () => {
  it('renders text blocks through MarkdownText in the rendered view', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '# Title\n\n**bold** content' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="render"
        resolveImage={() => undefined}
      />,
    )
    expect(view.getByRole('heading', { name: 'Title' })).toBeDefined()
    expect(view.getByText('bold', { selector: 'strong' })).toBeDefined()
  })

  it('shows the authored source verbatim in the raw view with no markdown chrome', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '# Title\n\n**bold** content' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="raw"
        resolveImage={() => undefined}
      />,
    )
    expect(view.container.querySelector('pre')?.textContent).toBe('# Title\n\n**bold** content')
    expect(view.queryByRole('heading')).toBeNull()
    expect(view.queryByText('bold', { selector: 'strong' })).toBeNull()
  })

  it('still renders prose file mentions through the rendered arm', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: 'use `chart.png` here' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="render"
        resolveImage={() => undefined}
        mentions={{
          resolve: () => ({ open: () => {}, label: '打开 chart.png', title: '/ws/chart.png' }),
        }}
      />,
    )
    expect(view.getByRole('button', { name: '打开 chart.png' })).toBeDefined()
  })

  it('passes the workspace image resolver into the rendered arm', () => {
    const resolveImage = vi.fn(() => 'blob:chart')
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '![chart](./output/chart.png)' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="render"
        resolveImage={resolveImage}
      />,
    )
    expect(resolveImage).toHaveBeenCalledWith('./output/chart.png')
    expect(view.getByRole('img', { name: 'chart' }).getAttribute('src')).toBe('blob:chart')
  })

  it('swaps between raw and rendered on an override change', () => {
    const view = render(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '# Title' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="raw"
        resolveImage={() => undefined}
      />,
    )
    expect(view.getByText('# Title')).toBeDefined()
    view.rerender(
      <AssistantMarkdown
        t={t}
        blocks={[{ kind: 'text', text: '# Title' }]}
        streaming={false}
        renderMessageImages={renderMessageImages}
        markdownView="render"
        resolveImage={() => undefined}
      />,
    )
    expect(view.getByRole('heading', { name: 'Title' })).toBeDefined()
  })
})
