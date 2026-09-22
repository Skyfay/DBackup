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

interface FilterOption {
  label: string
  value: string
  icon?: React.ComponentType<{ className?: string }>
  count?: number
}

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title?: string
  options: FilterOption[]
}

/** A multi-select filter on one column, with the number of rows per value. */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title,
  options,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues()
  const selectedValues = new Set(column?.getFilterValue() as string[])
  // Fixed when the list opens: selected first, then by count, then by name. Re-sorting on
  // every click would pull the entry away from under the pointer.
  const [order, setOrder] = React.useState<string[]>([])

  const countOf = (option: FilterOption) =>
    typeof option.count === "number" ? option.count : facets?.get(option.value) || 0

  const sortedValues = () =>
    [...options]
      .sort((a, b) => {
        const selected = Number(selectedValues.has(b.value)) - Number(selectedValues.has(a.value))
        if (selected !== 0) return selected
        const counts = countOf(b) - countOf(a)
        return counts !== 0 ? counts : a.label.localeCompare(b.label)
      })
      .map((option) => option.value)

  const byValue = new Map(options.map((option) => [option.value, option]))
  // Options that appeared while the list was open go at the end.
  const listed = [...order.filter((value) => byValue.has(value)), ...options.map((option) => option.value).filter((value) => !order.includes(value))]

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
      <PopoverContent className="w-60 p-0" align="start">
        <Command>
          <CommandInput placeholder={title ? `Search ${title.toLowerCase()}` : "Search"} />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup>
              {listed.map((value) => {
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
                    {option.icon && <option.icon className="size-4 shrink-0 text-muted-foreground" />}
                    <span className="min-w-0 flex-1 truncate">
                      {option.label}
                      {isSelected && <span className="sr-only">, selected</span>}
                    </span>
                    <span className="text-xs text-muted-foreground tabular-nums">{count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
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
