import { Plus, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { JOIN_END } from "@/components/ui/page-head";
import { cn } from "@/lib/utils";

interface ListEmptyProps {
    /** The icon of the list, the same as on its tab. */
    icon: LucideIcon;
    title: string;
    /** One sentence on what the list holds. */
    description: string;
    /** The New button, left out for someone who may not add one. */
    action?: { label: string; onClick: () => void };
    /** A second way to add, like Import key, outline beside it. */
    secondary?: { label: string; icon: LucideIcon; onClick: () => void };
}

/**
 * A list that holds nothing yet, in place of its numbers and its table: what belongs in it and
 * a way to add the first one. From md up it joins the tabs above it like the table it stands for.
 */
export function ListEmpty({ icon: Icon, title, description, action, secondary }: ListEmptyProps) {
    return (
        <div className={cn("flex flex-col items-center gap-3 rounded-xl border border-dashed px-4 py-14 text-center md:border-solid md:bg-card", JOIN_END)}>
            <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
                <Icon className="size-5 text-muted-foreground" />
            </span>
            <div className="space-y-1">
                <p className="font-medium">{title}</p>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">{description}</p>
            </div>
            {(action || secondary) && (
                <div className="flex flex-wrap justify-center gap-2">
                    {action && (
                        <Button tone="create" onClick={action.onClick}>
                            <Plus />
                            {action.label}
                        </Button>
                    )}
                    {secondary && (
                        <Button variant="outline" onClick={secondary.onClick}>
                            <secondary.icon />
                            {secondary.label}
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}
