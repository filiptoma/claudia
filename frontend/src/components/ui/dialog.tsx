import * as React from 'react'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { useVisualViewport } from '@/hooks/useVisualViewport'

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-black/60 backdrop-blur-[2px] pointer-events-none',
        'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  style,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  // Keep the dialog centered within the VISIBLE viewport when the on-screen keyboard is up. `fixed` is
  // anchored to the layout viewport, which iOS/iPadOS/WebKit do not shrink for the keyboard — so a
  // focused input in this vertically-centered dialog would otherwise sit hidden behind the keyboard.
  // (`top` overrides the `top-1/2` class; the `-translate-y-1/2` centering and zoom animation are kept.)
  const vp = useVisualViewport()
  const keyboardStyle: React.CSSProperties | undefined = vp?.keyboardOpen
    ? { top: vp.offsetTop + vp.height / 2, maxHeight: vp.height - 16, overflowY: 'auto' }
    : undefined

  // With the keyboard up the dialog itself becomes the scroll container (keyboardStyle above), but
  // nothing scrolls the focused field into view within it — a position:fixed dialog isn't scrolled
  // into view by the browser or Radix, so a field below the fold (e.g. the password) stays hidden
  // behind the keyboard. Center it by nudging only the dialog's own scrollTop (never the window, which
  // would re-introduce the stuck-viewport bug useKeyboardScrollReset guards against).
  const contentRef = React.useRef<HTMLDivElement>(null)
  const keyboardOpen = vp?.keyboardOpen ?? false
  const keyboardOpenRef = React.useRef(keyboardOpen)
  React.useEffect(() => {
    keyboardOpenRef.current = keyboardOpen
  }, [keyboardOpen])

  const centerFocused = React.useCallback(() => {
    const container = contentRef.current
    const el = document.activeElement
    if (!container || !(el instanceof HTMLElement) || !container.contains(el)) return
    const c = container.getBoundingClientRect()
    const e = el.getBoundingClientRect()
    container.scrollTop += e.top - c.top - (c.height - e.height) / 2
  }, [])

  // Center the focused field when the keyboard opens / its height settles...
  React.useEffect(() => {
    if (!keyboardOpen) return
    const id = requestAnimationFrame(centerFocused)
    return () => cancelAnimationFrame(id)
  }, [keyboardOpen, vp?.height, centerFocused])

  // ...and when focus moves between fields while it is already open (no viewport change to react to).
  React.useEffect(() => {
    const node = contentRef.current
    if (!node) return
    const onFocusIn = () => {
      if (!keyboardOpenRef.current) return
      requestAnimationFrame(centerFocused)
    }
    node.addEventListener('focusin', onFocusIn)
    return () => node.removeEventListener('focusin', onFocusIn)
  }, [centerFocused])

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        ref={contentRef}
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-full max-w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4',
          'rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl shadow-black/20 ring-1 ring-black/5 dark:ring-white/5',
          'duration-200 sm:max-w-lg',
          'data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className,
        )}
        style={{ ...style, ...keyboardStyle }}
        {...props}
      >
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground opacity-80 transition-[color,opacity,background-color] hover:bg-accent hover:text-foreground hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1.5 text-center sm:text-left', className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    />
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-base leading-none font-semibold tracking-tight', className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
