"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";

/** A page number, or a gap between two runs of them. Pages count from 0. */
export type PagerItem = { kind: "page"; page: number } | { kind: "gap"; key: string };

/**
 * The page buttons to show. Up to five pages all of them, else the first, the last
 * and the pages around the current one, with a gap where pages are left out.
 */
export function pagerItems(page: number, pageCount: number): PagerItem[] {
    if (pageCount <= 5) {
        return Array.from({ length: pageCount }, (_, i) => ({ kind: "page", page: i }));
    }
    const shown = [...new Set([0, page - 1, page, page + 1, pageCount - 1])]
        .filter((p) => p >= 0 && p < pageCount)
        .sort((a, b) => a - b);
    const items: PagerItem[] = [];
    shown.forEach((p, i) => {
        if (i > 0 && p - shown[i - 1] > 1) items.push({ kind: "gap", key: `gap-${p}` });
        items.push({ kind: "page", page: p });
    });
    return items;
}

interface ListPagerProps {
    /** The current page, counted from 0. */
    page: number;
    pageCount: number;
    pageSize: number;
    total: number;
    onPageChange: (page: number) => void;
    /** Names the list for screen readers, like "Destination pages". */
    label: string;
}

/** The footer of a paged list in a card: the range shown on the left, the pages on the right. */
export function ListPager({ page, pageCount, pageSize, total, onPageChange, label }: ListPagerProps) {
    const first = page * pageSize + 1;
    const last = Math.min(total, (page + 1) * pageSize);

    return (
        <nav aria-label={label} className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t pt-3">
            <span className="text-xs tabular-nums text-muted-foreground">
                {first}-{last} of {total.toLocaleString("en-US")}
            </span>
            <div className="flex items-center gap-1">
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Previous page"
                    disabled={page === 0}
                    onClick={() => onPageChange(page - 1)}
                >
                    <ChevronLeft />
                </Button>
                {pagerItems(page, pageCount).map((item) =>
                    item.kind === "gap" ? (
                        <span key={item.key} aria-hidden className="w-6 text-center text-sm text-muted-foreground">
                            ...
                        </span>
                    ) : (
                        <Button
                            key={item.page}
                            variant={item.page === page ? "outline" : "ghost"}
                            size="icon-sm"
                            aria-label={`Page ${item.page + 1}`}
                            aria-current={item.page === page ? "page" : undefined}
                            className="tabular-nums"
                            onClick={() => onPageChange(item.page)}
                        >
                            {item.page + 1}
                        </Button>
                    ),
                )}
                <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Next page"
                    disabled={page >= pageCount - 1}
                    onClick={() => onPageChange(page + 1)}
                >
                    <ChevronRight />
                </Button>
            </div>
        </nav>
    );
}
