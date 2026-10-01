"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Command as CommandPrimitive } from "cmdk";
import { ArrowDown, ArrowUp, CornerDownLeft, Loader2, Search } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { startRun } from "@/components/dashboard/history/run-actions";
import { useViewerPermissions } from "@/components/permissions/permissions-context";
import { Command, CommandEmpty, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { toneAttribute } from "@/components/ui/tone";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { MIN_QUERY_LENGTH, type SearchHit } from "@/services/search/search-types";
import { GROUP_LABELS, GROUP_ORDER, hitItems, iconOf, mayOpen, subLine, visibleChips, type SearchChip, type SearchItem } from "./search-items";
import { actionItems, pageItems, settingItems } from "./search-offers";
import { Kbd, SearchShortcut, useRecentSearches } from "./search-parts";

const log = logger.child({ component: "global-search" });

/** The part of a text the search matched, marked. */
function Marked({ text, query }: { text: string; query: string }) {
    const term = query.trim().toLowerCase();
    const start = term.length >= MIN_QUERY_LENGTH ? text.toLowerCase().indexOf(term) : -1;
    if (start < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, start)}
            <mark {...toneAttribute("pick")} className="rounded-[3px] bg-tone/15 font-semibold text-foreground">{text.slice(start, start + term.length)}</mark>
            {text.slice(start + term.length)}
        </>
    );
}

function ItemTile({ item }: { item: SearchItem }) {
    const Icon = iconOf(item) ?? Search;
    return (
        <span
            {...toneAttribute(item.action === "run" ? "create" : undefined)}
            className={cn("flex size-7 shrink-0 items-center justify-center rounded-md border bg-muted/50", item.action === "run" && "border-transparent bg-tone/14 text-tone")}
            aria-hidden="true"
        >
            {item.adapterId ? <AdapterIcon adapterId={item.adapterId} className="size-4" /> : <Icon className="size-3.5" />}
        </span>
    );
}

interface SearchDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** Whose recent entries show, so someone else in the same browser never sees them. */
    userId?: string;
}

/**
 * The search over the whole of DBackup, from the field in the header or Cmd K anywhere. Empty, it
 * offers what was opened last, the pages and the actions. Typing finds jobs and their backups,
 * connections, databases, runs, people, templates and the Vault on the server, and settings and
 * pages at once. Every row, a recent one too, shows only while the viewer may open its page.
 */
export function SearchDialog({ open, onOpenChange, userId }: SearchDialogProps) {
    const router = useRouter();
    const permissions = useViewerPermissions();
    const { resolvedTheme, setTheme } = useTheme();
    const [query, setQuery] = useState("");
    const [chip, setChip] = useState<SearchChip>("all");
    const [hits, setHits] = useState<SearchHit[]>([]);
    const [loading, setLoading] = useState(false);
    const { recent, remember } = useRecentSearches(userId);

    const can = useMemo(() => (permission: string) => permissions?.includes(permission) ?? false, [permissions]);
    const chips = useMemo(() => visibleChips(can), [can]);

    useEffect(() => {
        const term = query.trim();
        if (term.length < MIN_QUERY_LENGTH) {
            setHits([]);
            setLoading(false);
            return;
        }
        const controller = new AbortController();
        // Waits a moment, so a word typed quickly asks once.
        const timer = setTimeout(() => {
            setLoading(true);
            fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: controller.signal })
                .then((response) => (response.ok ? response.json() : null))
                .then((body) => setHits(body?.success ? body.data.hits : []))
                .catch((error: unknown) => {
                    if (!controller.signal.aborted) log.warn("The search failed", {}, wrapError(error));
                })
                .finally(() => {
                    if (!controller.signal.aborted) setLoading(false);
                });
        }, 150);
        return () => {
            clearTimeout(timer);
            controller.abort();
        };
    }, [query]);

    const items = useMemo(() => {
        const typed = query.trim().length > 0;
        const all: SearchItem[] = typed
            ? [...hits.flatMap(hitItems), ...settingItems(query, can(PERMISSIONS.SETTINGS.READ)), ...pageItems(query, can), ...actionItems(query, hits, can)]
            : [...recent, ...pageItems("", can), ...actionItems("", [], can)];
        // The server searched only what the viewer may open, a recent entry is from before.
        const allowed = all.filter((item) => mayOpen(item, can));
        return chip === "all" ? allowed : allowed.filter((item) => item.group === chip);
    }, [query, hits, recent, chip, can]);

    const groups = GROUP_ORDER.map((group) => ({ group, items: items.filter((item) => item.group === group) })).filter((entry) => entry.items.length > 0);

    const choose = (item: SearchItem) => {
        if (item.action === "theme") {
            setTheme(resolvedTheme === "dark" ? "light" : "dark");
            return;
        }
        onOpenChange(false);
        if (item.action === "run" && item.jobId) {
            const job = hits.find((hit) => hit.kind === "job" && hit.id === item.jobId);
            void startRun(item.jobId, job?.name ?? item.title);
            return;
        }
        if (item.href) {
            // The pages show while the search is empty anyway.
            if (item.group !== "pages") remember(item);
            router.push(item.href);
        }
    };

    // Tab walks the chips, so a kind is one key away without leaving the field.
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.key !== "Tab") return;
        event.preventDefault();
        const index = chips.findIndex((entry) => entry.value === chip);
        const next = (index + (event.shiftKey ? -1 : 1) + chips.length) % chips.length;
        setChip(chips[next].value);
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent showCloseButton={false} className="top-[12vh] translate-y-0 gap-0 overflow-hidden bg-raised p-0 sm:max-w-2xl">
                <DialogTitle className="sr-only">Search</DialogTitle>
                <DialogDescription className="sr-only">Find jobs, connections, databases, backups, runs, people, templates, the Vault, settings and pages.</DialogDescription>
                <Command shouldFilter={false} loop onKeyDown={onKeyDown}>
                    <div className="flex h-13 items-center gap-2.5 border-b px-4">
                        <Search className="size-4.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        <CommandPrimitive.Input
                            value={query}
                            onValueChange={setQuery}
                            placeholder="Search jobs, connections, backups and settings"
                            className="h-12 min-w-0 flex-1 bg-transparent text-[15px] outline-none placeholder:text-muted-foreground"
                        />
                        {loading && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden="true" />}
                        <Kbd>esc</Kbd>
                    </div>
                    <div className="flex flex-wrap gap-1 px-2.5 pt-2" role="group" aria-label="Kind">
                        {chips.map((entry) => (
                            <button
                                key={entry.value}
                                type="button"
                                aria-pressed={chip === entry.value}
                                onClick={() => setChip(entry.value)}
                                className={cn(
                                    "h-6.5 rounded-full px-2 text-xs font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50",
                                    chip === entry.value && "bg-muted text-foreground"
                                )}
                            >
                                {entry.label}
                            </button>
                        ))}
                    </div>
                    <CommandList scrollClassName="max-h-[min(26rem,55vh)]">
                        <div className="px-1.5 pt-1 pb-2">
                            <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">
                                {query.trim().length < MIN_QUERY_LENGTH ? "Type two letters or more." : loading ? "Searching…" : `Nothing found for ${query.trim()}.`}
                            </CommandEmpty>
                            {groups.map(({ group, items: rows }) => (
                                <CommandGroup key={group} heading={GROUP_LABELS[group]} className="[&_[cmdk-group-heading]]:px-2.5 [&_[cmdk-group-heading]]:pt-2.5 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground">
                                    {rows.map((item) => (
                                        <CommandItem
                                            key={item.key}
                                            value={item.key}
                                            onSelect={() => choose(item)}
                                            className="group h-11 gap-2.5 rounded-lg border border-transparent px-2.5 data-[selected=true]:border-border data-[selected=true]:bg-muted"
                                        >
                                            <ItemTile item={item} />
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm text-foreground"><Marked text={item.title} query={query} /></div>
                                                <div className="truncate text-xs text-muted-foreground"><Marked text={subLine(item)} query={query} /></div>
                                            </div>
                                            <span className="text-xs text-muted-foreground group-data-[selected=true]:hidden">{item.kind}</span>
                                            <Kbd label="Enter" className="hidden group-data-[selected=true]:inline-flex"><CornerDownLeft aria-hidden="true" /></Kbd>
                                        </CommandItem>
                                    ))}
                                </CommandGroup>
                            ))}
                        </div>
                    </CommandList>
                    <div className="flex items-center gap-4 border-t bg-page/60 px-4 py-2.5 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Kbd label="Up"><ArrowUp aria-hidden="true" /></Kbd><Kbd label="Down"><ArrowDown aria-hidden="true" /></Kbd> to move</span>
                        <span className="flex items-center gap-1.5"><Kbd label="Enter"><CornerDownLeft aria-hidden="true" /></Kbd> to open</span>
                        <span className="hidden items-center gap-1.5 sm:flex"><Kbd>tab</Kbd> for the next kind</span>
                    </div>
                </Command>
            </DialogContent>
        </Dialog>
    );
}

interface GlobalSearchProps {
    /** Whether the browser runs on a Mac, iPhone or iPad, read from the request, so the keys show right from the first paint. */
    apple?: boolean;
    userId?: string;
}

/**
 * The search field in the middle of the header, a button on a phone, and Cmd K or Ctrl K anywhere.
 * Both open the search over the page.
 */
export function GlobalSearch({ apple = false, userId }: GlobalSearchProps) {
    const [open, setOpen] = useState(false);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
                event.preventDefault();
                setOpen((current) => !current);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="hidden h-9 w-full items-center gap-2.5 rounded-lg border bg-background px-3 text-sm text-muted-foreground outline-none transition-colors hover:border-foreground/20 focus-visible:ring-2 focus-visible:ring-ring/50 lg:flex"
            >
                <Search className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">Search jobs, connections, backups and settings</span>
                <SearchShortcut apple={apple} className="ml-auto" />
            </button>
            <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Search">
                <Search />
            </Button>
            {open && <SearchDialog open={open} onOpenChange={setOpen} userId={userId} />}
        </>
    );
}
