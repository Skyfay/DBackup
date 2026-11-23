/** The query of a page as Next.js hands it over, every key with one value or several. */
export type PageSearchParams = Record<string, string | string[] | undefined>;

/** The query of a page as it stood in the address, without the question mark. */
export function queryOf(searchParams: PageSearchParams): string {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
        for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) params.append(key, entry);
    }
    return params.toString();
}

/** The first value of a key of the query, null without one. */
export function firstOf(searchParams: PageSearchParams, key: string): string | null {
    const value = searchParams[key];
    return (Array.isArray(value) ? value[0] : value) ?? null;
}
