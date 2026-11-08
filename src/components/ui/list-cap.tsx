/**
 * A line over a view that draws the rows of a list at once instead of a page, like a timeline,
 * while it holds only the first of many. Nothing while it holds them all.
 */
export function ListCap({ shown, total, noun }: { shown: number; total: number; noun: string }) {
    if (total <= shown) return null;
    return (
        <p className="border-b px-5 py-2.5 text-sm text-muted-foreground">
            Shows the first {shown.toLocaleString()} of {total.toLocaleString()} {noun}. The search and the filters narrow them.
        </p>
    );
}
