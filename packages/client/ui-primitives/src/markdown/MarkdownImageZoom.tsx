import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { IconCloseOutline16 } from '../icons/index.tsx'
import type { MarkdownImageLabels } from './render.tsx'
import css from './MarkdownImageZoom.module.css'

export { type MarkdownImageLabels } from './render.tsx'

export interface MarkdownImageZoomProps {
  /** The displayed image source (remote URL or resolved workspace URL). */
  src: string
  /** Accessible image caption. */
  alt: string
  /** Localized viewer chrome. */
  labels: MarkdownImageLabels
  /** Close the viewer. */
  onClose: () => void
}

/**
 * Full-size Markdown image viewer: a dark fixed layer that fits the image to
 * the viewport and leaves the browser's own pinch/scroll zoom untouched for
 * handheld surfaces. Closes on Escape, backdrop press, or the close control;
 * focus moves to the control on open and returns to the opener on close.
 * Rendered through a body portal: an opener inside a transformed or filtered
 * ancestor would otherwise trap the fixed backdrop in that ancestor's box.
 */
export function MarkdownImageZoom({ src, alt, labels, onClose }: MarkdownImageZoomProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      restoreRef.current?.focus()
    }
  }, [onClose])

  return createPortal(
    <div
      className={css.backdrop}
      role="dialog"
      aria-modal="true"
      aria-label={labels.open}
    >
      <div className={css.mask} aria-hidden="true" onMouseDown={onClose} />
      <img className={css.image} src={src} alt={alt} />
      <button ref={closeRef} type="button" className={css.close} aria-label={labels.close} onClick={onClose}>
        <IconCloseOutline16 size={16} />
      </button>
    </div>,
    document.body,
  )
}
