/** A block of a job form part with its title and, on the right, a short hint like who does the work. */
export function PartSection({ title, hint, children }: { title: string; hint?: React.ReactNode; children: React.ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3">
                <p className="text-sm font-medium">{title}</p>
                {hint && <span className="min-w-0 truncate text-xs text-muted-foreground">{hint}</span>}
            </div>
            {children}
        </div>
    );
}
