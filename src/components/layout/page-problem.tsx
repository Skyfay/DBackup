import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface PageProblemProps {
    icon: LucideIcon;
    title: string;
    children: React.ReactNode;
    /** The ways on, like Try again and a link to the overview. */
    actions?: React.ReactNode;
    /** A line to find the problem by, like the id of an error in the log. */
    detail?: string;
    className?: string;
}

/**
 * A page that cannot show what was asked for, like an error or an address that does not exist:
 * what happened in one sentence and the ways on, in the look of an empty list.
 */
export function PageProblem({ icon: Icon, title, children, actions, detail, className }: PageProblemProps) {
    return (
        <div className={cn("rounded-xl border bg-card px-4 py-16 text-center shadow-sm", className)}>
            <Icon className="mx-auto mb-4 size-10 text-muted-foreground/40" aria-hidden="true" />
            <h1 className="font-medium">{title}</h1>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{children}</p>
            {actions && <div className="mt-6 flex flex-wrap justify-center gap-2">{actions}</div>}
            {detail && <p className="mt-4 text-xs text-muted-foreground select-all">{detail}</p>}
        </div>
    );
}

/** Centers a problem on a page of its own, outside the dashboard. */
export function PageProblemScreen({ children }: { children: React.ReactNode }) {
    return <main className="flex min-h-svh items-center justify-center bg-page px-4 py-10">{children}</main>;
}
