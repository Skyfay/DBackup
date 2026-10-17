"use client";

import { Sheet, SheetContent } from "@/components/ui/sheet";
import type { AdapterConfig } from "./types";
import { ConnectionDetailsContent, type ConnectionDetailsProps } from "./connection-details-content";

interface ConnectionDetailsSheetProps extends Omit<ConnectionDetailsProps, "config"> {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    config: AdapterConfig | null;
    onClose: () => void;
    /** The details of a server of another tenant with databases of this one, which has a panel of its own. */
    renderShared?: (config: AdapterConfig) => React.ReactNode;
}

/** The details of one connection in a panel from the right, for the table and the cards. */
export function ConnectionDetailsSheet({ open, config, onClose, renderShared, ...props }: ConnectionDetailsSheetProps) {
    return (
        <Sheet open={open && config !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {config && (config.sharedServer && renderShared
                    ? renderShared(config)
                    : <ConnectionDetailsContent variant="sheet" config={config} {...props} />)}
            </SheetContent>
        </Sheet>
    );
}
