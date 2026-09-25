import * as React from "react"
import { Check, PlusCircle } from "lucide-react"
import { Column } from "@tanstack/react-table"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Separator } from "@/components/ui/separator"
import type { DataTableFilterOption } from "./data-table-types"

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title?: string
  options: DataTableFilterOption[]
  contentClassName?: string
}

/**
 * A multi-select filter on one column, with the number of rows per value. Options with a group are
 * listed under its heading, like the jobs, deleted jobs and other entries of the Storage Explorer.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
  contentClassName,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues()
  const selectedValues = new Set(column?.getFilterValue() as string[])
  const grouped = options.some((option) => option.group)
  // Fixed when the list opens: selected first, then by count, then by name. Grouped options keep
  // the order they were given within their group. Re-sorting on every click would pull the entry
  // away from under the pointer.
  const [order, setOrder] = React.useState<string[]>([])

  const countOf = (option: DataTableFilterOption) =>
    typeof option.count === "number" ? option.count : facets?.get(option.value) || 0

  const sortedValues = () =>
    options
      .map((option, index) => ({ option, index }))
      .sort((a, b) => {
        const selected = Number(selectedValues.has(b.option.value)) - Number(selectedValues.has(a.option.value))
        if (selected !== 0) return selected
        if (grouped) return a.index - b.index
        const counts = countOf(b.option) - countOf(a.option)
        return counts !== 0 ? counts : a.option.label.localeCompare(b.option.label)
      })
      .map(({ option }) => option.value)

  const byValue = new Map(options.map((option) => [option.value, option]))
  // Options that appeared while the list was open go at the end.
  const listed = [...order.filter((value) => byValue.has(value)), ...options.map((option) => option.value).filter((value) => !order.includes(value))]
  // Groups in the order of their first option, each with its options in the order listed.
  const groups = grouped
    ? [...new Set(options.map((option) => option.group ?? ""))].map((heading) => ({
        heading,
        values: listed.filter((value) => (byValue.get(value)!.group ?? "") === heading),
      }))
    : [{ heading: "", values: listed }]

  const toggle = (value: string) => {
    const next = new Set(selectedValues)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    column?.setFilterValue(next.size ? Array.from(next) : undefined)
  }

  return (
    <Popover onOpenChange={(open) => open && setOrder(sortedValues())}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle />
          {title}
          {selectedValues.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <Badge variant="secondary" className="rounded-sm px-1.5 font-normal tabular-nums lg:hidden">
                {selectedValues.size}
              </Badge>
              <div className="hidden gap-1 lg:flex">
                {selectedValues.size > 2 ? (
                  <Badge variant="secondary" className="rounded-sm px-1.5 font-normal">
                    {selectedValues.size} selected
                  </Badge>
                ) : (
                  options
                    .filter((option) => selectedValues.has(option.value))
                    .map((option) => (
                      <Badge variant="secondary" key={option.value} className="rounded-sm px-1.5 font-normal">
                        {option.label}
                      </Badge>
                    ))
                )}
              </div>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-60 p-0", contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={title ? `Search ${title.toLowerCase()}` : "Search"} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {groups.map((group) => group.values.length > 0 && (
            <CommandGroup key={group.heading} heading={group.heading || undefined}>
              {group.values.map((value) => {
                const option = byValue.get(value)!
                const isSelected = selectedValues.has(value)
                const count = countOf(option)
                return (
                  <CommandItem
                    key={value}
                    // The search matches the name and the id, never the count beside them.
                    value={`${option.label} ${value}`}
                    onSelect={() => toggle(value)}
                    className={cn(!count && !isSelected && "opacity-50")}
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors",
                        isSelected ? "border-primary bg-primary text-primary-foreground" : "border-input"
                      )}
                      aria-hidden="true"
                    >
                      {isSelected && <Check className="size-3.5 text-current" />}
                    </span>
                    {option.lead ?? (option.icon && <option.icon className="size-4 shrink-0 text-muted-foreground" />)}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                      {isSelected && <span className="sr-only">, selected</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            ))}
            {selectedValues.size > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem
                    onSelect={() => column?.setFilterValue(undefined)}
                    className="justify-center text-muted-foreground"
                  >
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
