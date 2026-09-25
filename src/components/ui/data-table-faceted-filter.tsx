import * as React from "react"
import { Check, ChevronDown, ListFilter, X } from "lucide-react"
import { Column } from "@tanstack/react-table"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { toneAttribute } from "@/components/ui/tone"
import type { DataTableFilterOption } from "./data-table-types"

interface DataTableFacetedFilterProps<TData, TValue> {
  column?: Column<TData, TValue>
  title?: string
  options: DataTableFilterOption[]
  contentClassName?: string
  unavailableLabel?: string
  heading?: string
  note?: string
  resultLabel?: string
  hint?: React.ReactNode
}

// The box before a value, drawn like a Checkbox. The value itself is the control, so the box only
// shows its state and takes the color of filtering from the popover.
const BOX =
  "flex size-4 shrink-0 items-center justify-center rounded-[4px] border border-input shadow-xs dark:bg-input/30 data-[state=checked]:border-tone-control data-[state=checked]:bg-tone-control data-[state=checked]:text-tone-control-foreground dark:data-[state=checked]:bg-tone-control"

/**
 * A filter on one column, in the color of filtering: a field that is framed in it once it holds
 * something, and a list under a head with a checkbox per value, like the databases of a job. A box
 * beside the search picks or drops every value it shows, and the foot says how many are picked.
 * Each value shows how many rows it would leave. Values with a group are listed under its heading,
 * and the ones no row has under the other filters wait at the end, where they cannot be picked.
 */
export function DataTableFacetedFilter<TData, TValue>({
  column,
  title = "Filter",
  options,
  contentClassName,
  unavailableLabel = "No matches with the other filters",
  heading,
  note = "Pick one or more",
  resultLabel,
  hint,
}: DataTableFacetedFilterProps<TData, TValue>) {
  const facets = column?.getFacetedUniqueValues()
  const selectedValues = new Set((column?.getFilterValue() as string[] | undefined) ?? [])
  const grouped = options.some((option) => option.group)
  // Fixed when the list opens: selected first, then by count, then by name. Grouped options keep
  // the order they were given within their group. Re-sorting on every click would pull the entry
  // away from under the pointer.
  const [order, setOrder] = React.useState<string[]>([])
  const [term, setTerm] = React.useState("")

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
  // The search matches the name and the id, never the count beside them.
  const query = term.trim().toLowerCase()
  const matches = (value: string) => !query || byValue.get(value)!.label.toLowerCase().includes(query) || value.toLowerCase().includes(query)
  // Options that appeared while the list was open go at the end.
  const listed = [...order.filter((value) => byValue.has(value)), ...options.map((option) => option.value).filter((value) => !order.includes(value))].filter(matches)
  const available = listed.filter((value) => !isUnavailable(byValue.get(value)!))
  const unavailable = listed.filter((value) => isUnavailable(byValue.get(value)!))
  // Groups in the order of their first option, each with its options in the order listed.
  const groups = grouped
    ? [...new Set(options.map((option) => option.group ?? ""))].map((group) => ({
        heading: group,
        values: available.filter((value) => (byValue.get(value)!.group ?? "") === group),
      }))
    : [{ heading: "", values: available }]

  const setValues = (next: Set<string>) => column?.setFilterValue(next.size ? Array.from(next) : undefined)
  const toggle = (value: string) => {
    const next = new Set(selectedValues)
    if (next.has(value)) next.delete(value)
    else next.add(value)
    setValues(next)
  }
  // The box beside the search works on what the search shows, the rest stays as it is.
  const shownPicked = available.filter((value) => selectedValues.has(value)).length
  const shownState = available.length > 0 && shownPicked === available.length ? true : shownPicked > 0 ? "indeterminate" : false
  const setShown = (on: boolean) => {
    const next = new Set(selectedValues)
    for (const value of available) {
      if (on) next.add(value)
      else next.delete(value)
    }
    setValues(next)
  }

  const picked = options.filter((option) => selectedValues.has(option.value))
  const first = picked[0]

  const item = (value: string, disabled: boolean) => {
    const option = byValue.get(value)!
    const isSelected = selectedValues.has(value)
    return (
      <CommandItem key={value} value={value} onSelect={() => toggle(value)} disabled={disabled}>
        <span data-state={isSelected ? "checked" : "unchecked"} className={BOX} aria-hidden="true">
          {isSelected && <Check className="size-3.5 text-current" />}
        </span>
        {option.lead ?? (option.icon && <option.icon className="size-4 shrink-0 text-muted-foreground" />)}
        <span className="min-w-0 flex-1 truncate">
          {option.label}
          {isSelected && <span className="sr-only">, selected</span>}
        </span>
        <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{countOf(option)}</span>
      </CommandItem>
    )
  }

  return (
    <Popover
      onOpenChange={(open) => {
        if (!open) return
        setOrder(sortedValues())
        setTerm("")
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          {...toneAttribute("filter")}
          className={cn(
            "flex h-8 max-w-72 min-w-0 shrink-0 items-center gap-2 rounded-md border border-input bg-transparent px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none",
            "focus-visible:border-tone-ring focus-visible:ring-2 focus-visible:ring-tone-ring/50 dark:bg-input/30 dark:hover:bg-input/50",
            // Framed in the color of filtering like a picked card, so a filter that holds something shows from afar.
            picked.length > 0 && "border-tone/50 bg-tone/5 dark:bg-tone/10 dark:hover:bg-tone/15"
          )}
        >
          <span className="shrink-0 text-muted-foreground">{title}</span>
          {first ? (
            <span className="flex min-w-0 items-center gap-1.5">
              {first.lead ?? (first.icon && <first.icon className="size-4 shrink-0 text-muted-foreground" />)}
              <span className="truncate font-medium">{first.label}</span>
              {picked.length > 1 && <span className="shrink-0 text-muted-foreground tabular-nums">+{picked.length - 1}</span>}
            </span>
          ) : hint}
          <ChevronDown className="size-4 shrink-0 opacity-50" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent tone="filter" className={cn("w-80 overflow-hidden rounded-xl bg-raised p-0", contentClassName)} align="start">
        <DialogHead tone="filter" icon={ListFilter} className="px-4 py-3">
          <p className="truncate text-sm font-semibold">{heading ?? `Filter by ${title.toLowerCase()}`}</p>
          <p className={cn(dialogNoteClass("filter"), "truncate")}>{note}</p>
        </DialogHead>
        <Command shouldFilter={false} className="bg-transparent">
          <div className="flex items-center gap-2 border-b p-2">
            <Checkbox
              checked={shownState}
              onCheckedChange={() => setShown(shownState !== true)}
              disabled={available.length === 0}
              aria-label={query ? "Pick the shown" : "Pick all"}
              className="mx-1"
            />
            <CommandInput
              value={term}
              onValueChange={setTerm}
              placeholder={`Search ${title.toLowerCase()}`}
              wrapperClassName="h-8 min-w-0 flex-1 rounded-md border border-input px-2.5 shadow-xs focus-within:border-tone-ring focus-within:ring-2 focus-within:ring-tone-ring/50 dark:bg-input/30"
              className="h-8 py-0"
            />
          </div>
          <CommandList>
            {listed.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No results found.</p>}
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
        </Command>
        <div className="flex min-h-10 items-center gap-3 border-t bg-muted/30 px-3 py-1.5 text-xs text-muted-foreground">
          <span className="min-w-0 flex-1 truncate tabular-nums">
            {query ? (
              `${listed.length} shown · ${picked.length} picked`
            ) : (
              <>
                <span className="font-medium text-foreground">
                  {picked.length} of {options.length} picked
                </span>
                {resultLabel && ` · ${resultLabel}`}
              </>
            )}
          </span>
          {picked.length > 0 && (
            <Button variant="ghost" size="sm" className="-mr-1 h-7 px-2 text-xs" onClick={() => column?.setFilterValue(undefined)}>
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
