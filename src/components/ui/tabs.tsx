"use client"

import * as React from "react"
import * as TabsPrimitive from "@radix-ui/react-tabs"

import { cn } from "@/lib/utils"

function Tabs({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      className={cn("flex flex-col gap-2", className)}
      {...props}
    />
  )
}

/**
 * "segmented" is the switch of a view or a range. "page" switches the lists of a page from md up,
 * where it heads the card of the list in a `PageHead`: text with the open tab on a filled pill, like
 * the open entry of the sidebar. A phone picks the list from a `Select` instead, see `PageTabs`.
 */
type TabsVariant = "segmented" | "page"

const TabsVariantContext = React.createContext<TabsVariant>("segmented")

function TabsList({
  className,
  variant = "segmented",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & { variant?: TabsVariant }) {
  return (
    <TabsVariantContext.Provider value={variant}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        className={cn(
          "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-0.75",
          variant === "page" && "md:h-auto md:gap-1 md:rounded-none md:bg-transparent md:p-0",
          className
        )}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

function TabsTrigger({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext)
  // Inactive tabs are muted in both themes and the active tab is a solid pill: white in light mode,
  // a lighter gray in dark mode. Upstream's dark pill (input/30) barely differs from the track.
  // The page tabs drop the track from md up, and the open one sits on a filled pill without a shadow.
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm dark:data-[state=active]:bg-foreground/12 focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:outline-ring inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:outline-1 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        variant === "page" &&
          "md:h-8.5 md:flex-none md:rounded-lg md:border-0 md:px-3 md:py-0 md:hover:bg-muted/50 md:data-[state=active]:bg-muted md:data-[state=active]:shadow-none md:dark:data-[state=active]:bg-muted",
        className
      )}
      {...props}
    />
  )
}

function TabsContent({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1 outline-none", className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
