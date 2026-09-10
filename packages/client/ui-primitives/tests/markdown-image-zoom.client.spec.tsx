// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { MarkdownText } from './markdown-test-components.tsx'
import { markdownLabels } from './labels.client.ts'
import type { MarkdownLabels } from '../src/markdown/MarkdownText.tsx'

afterEach(cleanup)

const IMAGE = '![diagram](https://example.com/graph.png)'

/** Chat-shaped chrome: the viewer labels are what opt an owner into zooming. */
const viewer = { open: '查看大图', close: '关闭图片预览' }
const zoomLabels: MarkdownLabels = { ...markdownLabels, image: viewer }

describe('MarkdownText image viewer', () => {
  it('leaves images inert without viewer labels', () => {
    const { container } = render(<MarkdownText text={IMAGE} />)
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByRole('img', { name: 'diagram' }).getAttribute('src'))
      .toBe('https://example.com/graph.png')
  })

  it('opens the full-size viewer from the labelled image button', () => {
    const { container } = render(
      <MarkdownText text={IMAGE} labels={zoomLabels} />,
    )
    const opener = screen.getByRole('button', { name: viewer.open })
    expect(opener.querySelector('img')?.getAttribute('src')).toBe('https://example.com/graph.png')

    fireEvent.click(opener)
    // The viewer is portalled to the body, so it sits outside the flow column.
    expect(container.querySelector('[role="dialog"]')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: viewer.open })
    expect(dialog.querySelector('img')?.getAttribute('alt')).toBe('diagram')
    expect(dialog.querySelector('img')?.getAttribute('src')).toBe('https://example.com/graph.png')
  })

  it('closes on Escape, the close control, and the mask, restoring the opener', () => {
    render(<MarkdownText text={IMAGE} labels={zoomLabels} />)
    const opener = screen.getByRole('button', { name: viewer.open })

    const open = (): void => {
      // A real pointer press focuses the button; the viewer restores whatever
      // held focus when it opened.
      opener.focus()
      fireEvent.click(opener)
      expect(screen.queryByRole('dialog')).not.toBeNull()
    }
    const expectClosed = (): void => {
      expect(screen.queryByRole('dialog')).toBeNull()
      expect(document.activeElement).toBe(opener)
    }

    open()
    fireEvent.keyDown(document, { key: 'Escape' })
    expectClosed()

    open()
    fireEvent.click(screen.getByRole('button', { name: viewer.close }))
    expectClosed()

    open()
    // The mask is the Modal primitive's own dismissal layer.
    fireEvent.click(document.querySelector('[role="presentation"] > div[aria-hidden="true"]') as Element)
    expectClosed()
  })

  it('keeps the alt-text fallback of a failed image without a zoom button', () => {
    const { container } = render(<MarkdownText text={IMAGE} labels={zoomLabels} />)
    fireEvent.error(screen.getByRole('img'))
    expect(container.querySelector('img')).toBeNull()
    expect(container.querySelector('button')).toBeNull()
    expect(screen.getByText('diagram')).toBeTruthy()
  })

  it('does not nest the zoom button inside a linked image', () => {
    const linked = '[![diagram](https://example.com/graph.png)](https://example.com/page)'
    const { container } = render(<MarkdownText text={linked} labels={zoomLabels} />)
    expect(container.querySelector('a > button')).toBeNull()
    expect(container.querySelector('a > img')?.getAttribute('src'))
      .toBe('https://example.com/graph.png')
  })
})
