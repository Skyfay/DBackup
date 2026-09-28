import { cn } from "@/lib/utils";

/**
 * The parts of a card whose head is a `PageHead`, from md up. Each part below the head drops its
 * top line and the corners it shares, so head, numbers and list read as one card.
 */
export const JOIN_MIDDLE = "md:rounded-none md:border-t-0";
export const JOIN_END = "md:rounded-t-none md:border-t-0";

/**
 * The row on top of a page with lists: its tabs on the left, what belongs to the open list on the
 * right. On a phone it stays a row above the list. From md up it is the head of the card of the
 * list, with the line under the open tab on its rule, and the part after it joins it without a
 * gap, see `JOIN_MIDDLE` and `JOIN_END`. Its tabs take `variant="page"`.
 */
export function PageHead({ className, children }: { className?: string; children: React.ReactNode }) {
    return (
        <div
            className={cn(
                "flex items-center gap-2 md:h-13 md:flex-nowrap md:gap-3 md:rounded-t-xl md:border md:border-b-0 md:bg-card md:px-4 md:text-card-foreground md:shadow-[inset_0_-1px_0_var(--border)]",
                className
            )}
        >
            {children}
        </div>
    );
}
