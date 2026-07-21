"use client";

import { useRef, useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@/components/ui/popover";
import {
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
} from "@/components/ui/command";
import { ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { AdapterIcon } from "@/components/adapter/adapter-icon";
import { DirectoryTree, type DirectoryTreeHandle } from "./directory-tree";
import type { AdapterOption } from "./job-form";

export interface DirectorySourceEntry {
    configId: string;
    path: string;
    excludePatterns: string[];
}

interface DirectorySourcePickerDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    directorySourceOptions: AdapterOption[];
    onConfirm: (entries: DirectorySourceEntry[]) => void;
}

/**
 * Entry point for adding directory sources: pick a storage adapter, then either browse its
 * configured root as a checkbox tree (adapters with supportsBrowse) - which can add several
 * rows at once, one per top-level selected folder - or fall back to plain manual path +
 * exclude-pattern entry for adapters that don't support browsing.
 */
export function DirectorySourcePickerDialog({
    open,
    onOpenChange,
    directorySourceOptions,
    onConfirm,
}: DirectorySourcePickerDialogProps) {
    const [configId, setConfigId] = useState("");
    const [adapterOpen, setAdapterOpen] = useState(false);
    const [manualPath, setManualPath] = useState("");
    const [manualExcludeText, setManualExcludeText] = useState("");
    const [treeSelectionCount, setTreeSelectionCount] = useState(0);
    const treeRef = useRef<DirectoryTreeHandle>(null);

    const selectedAdapter = directorySourceOptions.find((d) => d.id === configId);

    const reset = () => {
        setConfigId("");
        setManualPath("");
        setManualExcludeText("");
        setTreeSelectionCount(0);
    };

    const handleOpenChange = (next: boolean) => {
        if (!next) reset();
        onOpenChange(next);
    };

    const handleConfirm = () => {
        if (!configId) return;
        if (selectedAdapter?.supportsBrowse) {
            const entries = treeRef.current?.getSelection() ?? [];
            if (entries.length === 0) return;
            onConfirm(entries.map((e) => ({ configId, ...e })));
        } else {
            const path = manualPath.trim();
            if (!path) return;
            const excludePatterns = manualExcludeText.split("\n").map((l) => l.trim()).filter(Boolean);
            onConfirm([{ configId, path, excludePatterns }]);
        }
        handleOpenChange(false);
    };

    const canConfirm = !!configId && (selectedAdapter?.supportsBrowse ? treeSelectionCount > 0 : manualPath.trim().length > 0);

    return (
        <Dialog open={open} onOpenChange={handleOpenChange}>
            <DialogContent className="max-w-2xl h-[80vh] flex flex-col p-0 gap-0">
                <DialogHeader className="p-4 pb-2 border-b">
                    <DialogTitle>Add Directory Source</DialogTitle>
                    <DialogDescription>
                        Pick a storage adapter, then select the folders you want to back up.
                    </DialogDescription>
                </DialogHeader>

                <div className="p-4 border-b space-y-2 shrink-0">
                    <label className="text-sm font-medium">Storage Adapter</label>
                    <Popover open={adapterOpen} onOpenChange={setAdapterOpen} modal={true}>
                        <PopoverTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                role="combobox"
                                aria-expanded={adapterOpen}
                                className={cn("w-full justify-between", !configId && "text-muted-foreground")}
                            >
                                {selectedAdapter ? (
                                    <span className="flex items-center gap-2 min-w-0">
                                        <AdapterIcon adapterId={selectedAdapter.adapterId} className="h-4 w-4 shrink-0" />
                                        <span className="truncate">{selectedAdapter.name}</span>
                                    </span>
                                ) : "Select Adapter"}
                                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                            </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-[--radix-popover-trigger-width] p-0">
                            <Command>
                                <CommandInput placeholder="Search adapter..." />
                                <CommandList>
                                    <CommandEmpty>No adapter found.</CommandEmpty>
                                    <CommandGroup>
                                        {directorySourceOptions.map((d) => (
                                            <CommandItem
                                                key={d.id}
                                                value={d.name}
                                                onSelect={() => {
                                                    if (d.id !== configId) {
                                                        setConfigId(d.id);
                                                        setTreeSelectionCount(0);
                                                    }
                                                    setAdapterOpen(false);
                                                }}
                                                className={cn(configId === d.id && "bg-accent")}
                                            >
                                                <AdapterIcon adapterId={d.adapterId} className="h-4 w-4" />
                                                {d.name}
                                            </CommandItem>
                                        ))}
                                    </CommandGroup>
                                </CommandList>
                            </Command>
                        </PopoverContent>
                    </Popover>
                </div>

                <div className="flex-1 min-h-0 flex flex-col">
                    {!configId && (
                        <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                            Select an adapter to continue.
                        </div>
                    )}
                    {configId && selectedAdapter?.supportsBrowse && (
                        <ScrollArea className="flex-1 min-h-0 p-3">
                            <DirectoryTree
                                key={configId}
                                ref={treeRef}
                                configId={configId}
                                onSelectionCountChange={setTreeSelectionCount}
                            />
                        </ScrollArea>
                    )}
                    {configId && !selectedAdapter?.supportsBrowse && (
                        <div className="flex-1 min-h-0 p-4 space-y-3 overflow-y-auto">
                            <div>
                                <label className="text-sm font-medium">Path</label>
                                <Input
                                    value={manualPath}
                                    onChange={(e) => setManualPath(e.target.value)}
                                    placeholder="/path/to/directory"
                                    className="mt-1"
                                />
                                <p className="text-xs text-muted-foreground mt-1">
                                    {selectedAdapter?.name} does not support folder browsing - enter the path manually.
                                </p>
                            </div>
                            <div>
                                <label className="text-sm font-medium">Exclude Patterns (optional)</label>
                                <Textarea
                                    rows={4}
                                    value={manualExcludeText}
                                    onChange={(e) => setManualExcludeText(e.target.value)}
                                    placeholder={"*.tmp\nnode_modules/**\n.cache/**"}
                                    className="mt-1"
                                />
                                <p className="text-xs text-muted-foreground mt-1">One glob pattern per line.</p>
                            </div>
                        </div>
                    )}
                </div>

                <DialogFooter className="p-4 border-t bg-muted/10">
                    <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
                        Cancel
                    </Button>
                    <Button type="button" onClick={handleConfirm} disabled={!canConfirm}>
                        {selectedAdapter?.supportsBrowse ? "Add Selected Folders" : "Add"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
