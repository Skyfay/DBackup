/** A text with the first place a search found in it marked. Matches regardless of case. */
export function Highlight({ text, term }: { text: string; term: string }) {
    const query = term.trim().toLowerCase();
    const at = query ? text.toLowerCase().indexOf(query) : -1;
    if (at < 0) return <>{text}</>;
    return (
        <>
            {text.slice(0, at)}
            <mark className="rounded-sm bg-foreground/10 font-semibold text-foreground">{text.slice(at, at + query.length)}</mark>
            {text.slice(at + query.length)}
        </>
    );
}
