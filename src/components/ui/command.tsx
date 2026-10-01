"use client"

import * as React from "react"
import { Command as CommandPrimitive } from "cmdk"
import { SearchIcon } from "lucide-react"

import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"

function Command({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "text-popover-foreground flex h-full w-full flex-col overflow-hidden rounded-md bg-transparent",
        className
      )}
      {...props}
    />
  )
}

function CommandInput({
  className,
  wrapperClassName,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input> & {
  /** Classes for the row around the input, like a frame that makes it look like a field. */
  wrapperClassName?: string
}) {
  return (
    <div
      data-slot="command-input-wrapper"
      className={cn("flex h-9 items-center gap-2 border-b px-3", wrapperClassName)}
    >
      <SearchIcon className="size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "placeholder:text-muted-foreground flex h-10 w-full rounded-md bg-transparent py-3 text-sm outline-hidden disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        {...props}
      />
    </div>
  )
}

function CommandList({
  className,
  scrollClassName,
  children,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.List> & {
  /** Classes for the scroll area inside, like a max-height other than the default. */
  scrollClassName?: string
}) {
  const viewportRef = React.useRef<HTMLDivElement>(null)

  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("overflow-hidden!", className)}
      {...props}
      onWheel={(e) => {
        const viewport = viewportRef.current
        if (!viewport) return

        const { scrollTop, scrollHeight, clientHeight } = viewport
        const maxScroll = scrollHeight - clientHeight
        if (maxScroll <= 0) return

        const atTop = scrollTop <= 0 && e.deltaY < 0
        const atBottom = scrollTop >= maxScroll && e.deltaY > 0
        if (atTop || atBottom) return

        viewport.scrollTop += e.deltaY
        e.preventDefault()
      }}
    >
      <ScrollArea viewportRef={viewportRef} className={cn("max-h-75 **:data-[slot=scroll-area-viewport]:max-h-[inherit]", scrollClassName)}>
        {children}
      </ScrollArea>
    </CommandPrimitive.List>
  )
}

function CommandEmpty({
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm"
      {...props}
    />
  )
}

function CommandGroup({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        "text-foreground **:[[cmdk-group-heading]]:text-muted-foreground overflow-hidden p-1 **:[[cmdk-group-heading]]:px-2 **:[[cmdk-group-heading]]:py-1.5 **:[[cmdk-group-heading]]:text-xs **:[[cmdk-group-heading]]:font-medium",
        className
      )}
      {...props}
    />
  )
}

function CommandSeparator({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("bg-border -mx-1 h-px", className)}
      {...props}
    />
  )
}

function CommandItem({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "data-[selected=true]:bg-accent data-[selected=true]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-md px-2 py-1.5 text-sm outline-hidden select-none data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function CommandShortcut({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        className
      )}
      {...props}
    />
  )
}

export {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandShortcut,
  CommandSeparator,
}
