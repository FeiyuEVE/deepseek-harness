// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MarkdownText } from '../src/index.ts'
import { markdownLabels } from './labels.client.ts'

afterEach(cleanup)

describe('Markdown images', () => {
  it('wraps a rendered remote image in a zoom button that opens the viewer', () => {
    const view = render(<MarkdownText text="![photo](https://example.com/a.png)" labels={markdownLabels} />)
    const opener = view.getByRole('button', { name: markdownLabels.image.open })
    expect(opener.querySelector('img')).not.toBeNull()
    fireEvent.click(opener)
    // The viewer renders through a body portal; the dialog carries the
    // viewer label and the image keeps its authored alt text.
    const dialog = screen.getByRole('dialog', { name: markdownLabels.image.open })
    const image = dialog.querySelector('img')
    expect(image).not.toBeNull()
    expect(image?.getAttribute('alt')).toBe('photo')
    expect(image?.getAttribute('src')).toBe('https://example.com/a.png')
  })

  it('closes the viewer on Escape and on the close control', () => {
    const view = render(<MarkdownText text="![photo](https://example.com/a.png)" labels={markdownLabels} />)
    fireEvent.click(view.getByRole('button', { name: markdownLabels.image.open }))
    expect(screen.queryByRole('dialog')).not.toBeNull()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()

    fireEvent.click(view.getByRole('button', { name: markdownLabels.image.open }))
    fireEvent.click(screen.getByRole('button', { name: markdownLabels.image.close }))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('renders an unresolved relative source as inert alt text', () => {
    const view = render(<MarkdownText text="![local](./missing.png)" labels={markdownLabels} />)
    expect(view.queryByRole('button', { name: markdownLabels.image.open })).toBeNull()
    expect(view.getByText('local')).toBeTruthy()
  })

  it('resolves a non-HTTP source through the resolver callback', () => {
    const resolveImage = vi.fn(() => 'blob:workspace-chart')
    const view = render(
      <MarkdownText
        text="![chart](./output/chart.png)"
        labels={markdownLabels}
        resolveImage={resolveImage}
      />,
    )
    expect(resolveImage).toHaveBeenCalledWith('./output/chart.png')
    const image = view.getByRole('img', { name: 'chart' })
    expect(image.getAttribute('src')).toBe('blob:workspace-chart')
  })

  it('keeps the alt-text fallback when the resolver declines the source', () => {
    const view = render(
      <MarkdownText
        text="![chart](./output/chart.png)"
        labels={markdownLabels}
        resolveImage={() => undefined}
      />,
    )
    expect(view.queryByRole('img', { name: 'chart' })).toBeNull()
    expect(view.getByText('chart')).toBeTruthy()
  })
})
