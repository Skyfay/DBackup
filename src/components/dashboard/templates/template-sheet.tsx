"use client";

import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { KindTile, type TemplateKind } from "./template-cells";

interface TemplateSheetProps {
    open: boolean;
    onClose: () => void;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    children: React.ReactNode;
}

/** A template in a panel from the right, like a connection or a key. */
export function TemplateSheet({ open, onClose, children }: TemplateSheetProps) {
    return (
        <Sheet open={open} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {children}
            </SheetContent>
        </Sheet>
    );
}

interface SheetHeadProps {
    kind: TemplateKind;
    name: string;
    description: string;
    /** The buttons of its main tasks, like Edit. */
    buttons?: React.ReactNode;
    /** The rest of what it can do, as the menu of its row shows it. */
    groups: BackupActionGroup[];
}

/** The tile, the name and one line about the template, with its buttons under them. */
export function TemplateSheetHead({ kind, name, description, buttons, groups }: SheetHeadProps) {
    return (
        <SheetHeader className="gap-4 border-b p-5 pr-12">
            <div className="flex min-w-0 items-start gap-3">
                <KindTile kind={kind} size="lg" />
                <div className="min-w-0">
                    <SheetTitle className="truncate text-lg font-semibold">{name}</SheetTitle>
                    <SheetDescription className="truncate text-sm text-muted-foreground">{description}</SheetDescription>
                </div>
            </div>
            {(buttons || groups.length > 0) && (
                <div className="flex flex-wrap items-center gap-2">
                    {buttons}
                    <BackupRowMenu name={name} groups={groups} variant="outline" align="start" />
                </div>
            )}
        </SheetHeader>
    );
}

/** The sections of the panel, scrolling under its head. */
export function TemplateSheetBody({ children }: { children: React.ReactNode }) {
    return (
        <ScrollArea className="min-h-0 flex-1">
            <div className="space-y-6 p-5">{children}</div>
        </ScrollArea>
    );
}
