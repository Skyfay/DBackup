"use client";

import { ArrowRight, SearchX, type LucideIcon } from "lucide-react";
import { wordsOf, type SettingEntry, type SettingsSearch } from "./settings-index";
import { partOf, type SettingsPartId } from "./settings-parts";

interface SettingsResultsProps<Id extends string> {
    term: string;
    search: SettingsSearch<Id>;
    onPick: (entry: SettingEntry<Id>) => void;
    /** The name and icon of a part, those of the Settings page when left out. */
    describe?: (part: Id) => { label: string; icon: LucideIcon };
    /** What holds nothing, like "the settings" or "your profile". */
    where?: string;
}

/** A text with each word of the search marked where it starts a word, the way the search found it. */
function Marked({ text, term }: { text: string; term: string }) {
    const words = wordsOf(term);
    if (words.length === 0) return <>{text}</>;
    // The words hold letters and digits only, so they go into the pattern as they are.
    const pattern = new RegExp(`(^|[^a-z0-9])(${words.join("|")})`, "gi");
    const parts: React.ReactNode[] = [];
    let last = 0;
    for (const match of text.matchAll(pattern)) {
        const start = (match.index ?? 0) + match[1].length;
        parts.push(text.slice(last, start), <mark key={start} className="rounded-sm bg-foreground/10 font-semibold text-foreground">{match[2]}</mark>);
        last = start + match[2].length;
    }
    parts.push(text.slice(last));
    return <>{parts}</>;
}

/** What the search found, a row per setting with its part above it. A click opens the part and marks the setting. */
export function SettingsResults<Id extends string = SettingsPartId>({ term, search, onPick, describe, where = "the settings" }: SettingsResultsProps<Id>) {
    const parts = Object.keys(search.counts).length;
    const count = search.hits.length;
    return (
        <section aria-live="polite" className="min-w-0 flex-1">
            <div className="border-b px-4 py-4 md:px-6 md:py-5">
                <h2 className="font-semibold">
                    {count === 0 ? "No setting" : count === 1 ? "1 setting" : `${count} settings`} with {term.trim()}
                </h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                    {count === 0 ? "Try another word, like a part of its name." : `In ${parts === 1 ? "1 part" : `${parts} parts`}. A click opens the part and marks the setting.`}
                </p>
            </div>
            {count === 0 ? (
                <div className="flex flex-col items-center gap-2 px-6 py-12 text-center text-sm text-muted-foreground">
                    <SearchX className="size-6" aria-hidden="true" />
                    Nothing in {where} holds these words.
                </div>
            ) : (
                <ul className="m-4 max-w-3xl divide-y overflow-hidden rounded-xl border md:m-6">
                    {search.hits.map((entry) => {
                        const part = describe ? describe(entry.part) : partOf(entry.part as SettingsPartId);
                        return (
                            <li key={entry.id}>
                                <button type="button" onClick={() => onPick(entry)} className="flex w-full min-w-0 items-center gap-3 px-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50">
                                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border bg-muted/50" aria-hidden="true">
                                        <part.icon className="size-4 text-muted-foreground" />
                                    </span>
                                    <span className="grid min-w-0 flex-1 gap-0.5">
                                        {entry.id !== entry.part && <span className="truncate text-xs text-muted-foreground">{part.label}</span>}
                                        <span className="truncate text-sm font-medium"><Marked text={entry.label} term={term} /></span>
                                        <span className="truncate text-xs text-muted-foreground"><Marked text={entry.text} term={term} /></span>
                                    </span>
                                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                </button>
                            </li>
                        );
                    })}
                </ul>
            )}
        </section>
    );
}
