"use client"

import * as React from "react"
import * as TooltipPrimitive from "@radix-ui/react-tooltip"

import { cn } from "@/lib/utils"
import { toneAttribute } from "@/components/ui/tone"

function TooltipProvider({
  delayDuration = 0,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return (
    <TooltipPrimitive.Provider
      data-slot="tooltip-provider"
      delayDuration={delayDuration}
      {...props}
    />
  )
}

function Tooltip({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root>) {
  return (
    <TooltipProvider>
      <TooltipPrimitive.Root data-slot="tooltip" {...props} />
    </TooltipProvider>
  )
}

function TooltipTrigger({
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Trigger>) {
  return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />
}

function TooltipContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Content>) {
  return (
    <TooltipPrimitive.Portal>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        sideOffset={sideOffset}
        // The surface of a popover, not inverted, so a tooltip reads like the rest of the page.
        className={cn(
          "bg-raised text-foreground animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-lg border px-3 py-2 text-xs text-balance shadow-md",
          className
        )}
        {...props}
      >
        {children}
        {/* The border on two sides draws the outline of the arrow, its inner half covers the border of the tooltip. */}
        <TooltipPrimitive.Arrow className="bg-raised fill-raised z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] border-r border-b" />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}

/**
 * The first line of a tooltip that tells a state, like whether a destination answers: tinted in
 * the tone of the state with a dot in its color, the smallest form of the head of a popover. What
 * follows it is the explanation, in muted text.
 */
function TooltipHead({
  tone,
  className,
  children,
}: {
  tone: "success" | "warning" | "destructive"
  className?: string
  children: React.ReactNode
}) {
  return (
    <div
      {...toneAttribute(tone)}
      className={cn(
        "-mx-3 -mt-2 mb-1.5 flex min-w-0 items-center gap-2 rounded-t-[7px] border-b border-tone/20 bg-tone/5 px-3 py-1.5 font-semibold dark:bg-tone/10",
        className
      )}
    >
      <span className="size-1.5 shrink-0 rounded-full bg-tone" aria-hidden="true" />
      {children}
    </div>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipHead, TooltipProvider }
