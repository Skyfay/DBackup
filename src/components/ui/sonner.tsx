"use client"

import { useState } from "react"
import { Check, CircleCheck, CircleX, Copy, Info, Loader2, TriangleAlert } from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { cn } from "@/lib/utils"

/** How long a toast stays, which the line along its foot counts down. */
const DURATION = 4000

// Copy and close only show on hover, and always on a touch screen, which has none.
const CORNER_BUTTON =
  "absolute top-2 flex size-6 cursor-pointer items-center justify-center rounded-md opacity-0 transition-opacity focus-visible:opacity-100 group-hover/toast:opacity-100 pointer-coarse:opacity-100 [&>svg]:size-3.5"

/**
 * Copies what a toast says, so an error can be pasted instead of photographed. It sits in the
 * icon of errors and warnings and reads the toast around it when clicked.
 */
function CopyToast() {
  const [copied, setCopied] = useState(false)

  const copy = async (event: React.MouseEvent<HTMLButtonElement>) => {
    const toast = event.currentTarget.closest("[data-sonner-toast]")
    const text = ["[data-title]", "[data-description]"]
      .map((selector) => toast?.querySelector(selector)?.textContent?.trim())
      .filter(Boolean)
      .join("\n")
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "Message copied" : "Copy the message"}
      className={cn(CORNER_BUTTON, "right-9 text-muted-foreground hover:bg-muted hover:text-foreground")}
    >
      {copied ? <Check className="text-success" /> : <Copy />}
    </button>
  )
}

/**
 * The toasts at the bottom right, in the look of the redesign: a quiet card with the icon in the
 * color of its kind and a line along its foot for the time it has left. Sonner stops the timer of
 * every toast while the stack is hovered, and the line stops with it, see `toast-time` in
 * globals.css. Hovering also shows Close, and Copy on errors and warnings.
 */
const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      duration={DURATION}
      closeButton
      icons={{
        success: <CircleCheck className="text-success" />,
        info: <Info className="text-muted-foreground" />,
        warning: (
          <>
            <TriangleAlert className="text-warning" />
            <CopyToast />
          </>
        ),
        error: (
          <>
            <CircleX className="text-destructive" />
            <CopyToast />
          </>
        ),
        loading: <Loader2 className="animate-spin text-muted-foreground" />,
      }}
      style={{ "--toast-duration": `${DURATION}ms` } as React.CSSProperties}
      toastOptions={{
        // Sonner's own look is left out, so every part takes the tokens of the app.
        unstyled: true,
        classNames: {
          toast:
            "group/toast grid w-(--width) grid-cols-[auto_minmax(0,1fr)] items-start gap-x-3 rounded-xl border bg-raised py-3 pr-2 pl-3.5 font-sans text-popover-foreground shadow-lg",
          // Not positioned, so Copy inside it can sit in the corner of the toast.
          icon: "mt-0.5 flex size-4 shrink-0 items-center justify-center [&>svg]:size-4",
          // The spinner of a toast that is still working sits in the icon's place.
          loader: "static! transform-none! data-[visible=false]:hidden",
          // Room on the right for the buttons that show on hover.
          content: "grid min-w-0 gap-0.5 pr-7 group-data-[type=error]/toast:pr-14 group-data-[type=warning]/toast:pr-14",
          title: "text-sm leading-5 font-medium",
          description: "text-xs leading-relaxed text-muted-foreground!",
          actionButton:
            "col-start-2 mt-2 inline-flex h-7 w-fit cursor-pointer items-center rounded-md border border-input bg-background px-2.5 text-xs font-medium shadow-xs transition-colors hover:bg-muted dark:bg-input/30 dark:hover:bg-input/50",
          cancelButton:
            "col-start-2 mt-2 inline-flex h-7 w-fit cursor-pointer items-center rounded-md px-2.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
          closeButton: cn(CORNER_BUTTON, "right-2 border-0! bg-transparent! text-muted-foreground! hover:bg-muted! hover:text-foreground!"),
          success: "[--toast-time-color:var(--success)]",
          error: "[--toast-time-color:var(--destructive)]",
          warning: "[--toast-time-color:var(--warning)]",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
