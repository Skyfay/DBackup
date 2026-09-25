import * as React from "react"
import { Check, ChevronDown } from "lucide-react"
import { Column } from "@tanstack/react-table"

import { cn } from "@/lib/utils"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import type { DataTableFilterOption } from "./data-table-types"

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title?: string
  options: DataTableFilterOption[]
  contentClassName?: string
  unavailableLabel?: string
}

/**
 * A filter on one column that looks and opens like the other selects of the app, where several
 * values can be picked. Each option shows how many rows it would leave. Options with a group are
 * listed under its heading, and the ones no row has under the other filters wait at the end,
 * where they cannot be picked.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title = "Filter",
  options,
  contentClassName,
  unavailableLabel = "No matches with the other filters",
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues()
  const selectedValues = new Set((column?.getFilterValue() as string[] | undefined) ?? [])
  const grouped = options.some((option) => option.group)
  // Fixed when the list opens: selected first, then by count, then by name. Grouped options keep
  // the order they were given within their group. Re-sorting on every click would pull the entry
  // away from under the pointer.
  const [order, setOrder] = React.useState<string[]>([])

  const countOf = (option: DataTableFilterOption) =>
    typeof option.count === "number" ? option.count : facets?.get(option.value) || 0
  // While no option has a count, like before the counts have loaded, nothing is set aside.
  const anyCounted = options.some((option) => countOf(option) > 0)
  const isUnavailable = (option: DataTableFilterOption) => anyCounted && countOf(option) === 0 && !selectedValues.has(option.value)

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
  const available = listed.filter((value) => !isUnavailable(byValue.get(value)!))
  const unavailable = listed.filter((value) => isUnavailable(byValue.get(value)!))
  // Groups in the order of their first option, each with its options in the order listed.
  const groups = grouped
    ? [...new Set(options.map((option) => option.group ?? ""))].map((heading) => ({
        heading,
        values: available.filter((value) => (byValue.get(value)!.group ?? "") === heading),
      }))
    : [{ heading: "", values: available }]

  const toggle = (value: string) => {
    const next = new Set(selectedValues)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    column?.setFilterValue(next.size ? Array.from(next) : undefined)
  }

  const picked = options.filter((option) => selectedValues.has(option.value))
  const first = picked[0]

  const item = (value: string, disabled: boolean) => {
    const option = byValue.get(value)!
    const isSelected = selectedValues.has(value)
    return (
      <CommandItem
        key={value}
        // The search matches the name and the id, never the count beside them.
        value={`${option.label} ${value}`}
        onSelect={() => toggle(value)}
        disabled={disabled}
        className="pr-8"
      >
        {option.lead ?? (option.icon && <option.icon className="size-4 shrink-0 text-muted-foreground" />)}
        <span className="min-w-0 flex-1 truncate">
          {option.label}
          {isSelected && <span className="sr-only">, selected</span>}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{countOf(option)}</span>
        <span className="absolute right-2 flex size-3.5 items-center justify-center" aria-hidden="true">
          {isSelected && <Check className="size-4 text-foreground" />}
        </span>
      </CommandItem>
    )
  }

  return (
    <Popover onOpenChange={(open) => open && setOrder(sortedValues())}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-8 max-w-72 min-w-0 shrink-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none",
            "focus-visible:border-tone-ring focus-visible:ring-2 focus-visible:ring-tone-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
            picked.length > 0 && "border-foreground/25"
          )}
        >
          <span className="shrink-0 text-muted-foreground">{title}</span>
          {first && (
            <span className="flex min-w-0 items-center gap-1.5">
              {first.lead ?? (first.icon && <first.icon className="size-4 shrink-0 text-muted-foreground" />)}
              <span className="truncate font-medium">{first.label}</span>
              {picked.length > 1 && <span className="shrink-0 text-muted-foreground tabular-nums">+{picked.length - 1}</span>}
            </span>
          )}
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent className={cn("w-64 overflow-hidden p-0", contentClassName)} align="start">
        <Command>
          <CommandInput placeholder={`Search ${title.toLowerCase()}`} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            {groups.map((group) => group.values.length > 0 && (
              <CommandGroup key={group.heading} heading={group.heading || undefined}>
                {group.values.map((value) => item(value, false))}
              </CommandGroup>
            ))}
            {unavailable.length > 0 && (
              <CommandGroup heading={unavailableLabel} className="border-t">
                {unavailable.map((value) => item(value, true))}
              </CommandGroup>
            )}
          </CommandList>
          {picked.length > 0 && (
            <div className="border-t p-1">
              <button
                type="button"
                onClick={() => column?.setFilterValue(undefined)}
                className="w-full rounded-sm px-2 py-1.5 text-sm text-muted-foreground outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent"
              >
                Clear filter
              </button>
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  )
}
