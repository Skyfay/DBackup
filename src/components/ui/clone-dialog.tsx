"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Copy } from "lucide-react";

interface CloneDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    defaultName: string;
    existingNames: string[];
    onConfirm: (name: string) => Promise<void>;
    isLoading?: boolean;
}

export function CloneDialog({ open, onOpenChange, defaultName, existingNames, onConfirm, isLoading }: CloneDialogProps) {
    const [name, setName] = useState("");
    const [prevOpen, setPrevOpen] = useState(open);

    if (prevOpen !== open) {
        setPrevOpen(open);
        if (open) {
            setName(`${defaultName} (Copy)`);
        }
    }

    const trimmed = name.trim();
    const isDuplicate = existingNames.some((n) => n.toLowerCase() === trimmed.toLowerCase());
    const isInvalid = !trimmed || isDuplicate;

    const handleConfirm = async () => {
        if (isInvalid) return;
        await onConfirm(trimmed);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleConfirm();
        }
    };

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent tone="create" className="max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <Copy className="h-4 w-4" />
                        Clone
                    </DialogTitle>
                    <DialogDescription>
                        Enter a name for the cloned entry. You can change it later.
                    </DialogDescription>
                </DialogHeader>

                <div className="space-y-2 py-2">
                    <Label htmlFor="clone-name">Name</Label>
                    <Input
                        id="clone-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="Enter a name..."
                        disabled={isLoading}
                        autoFocus
                        className={isDuplicate ? "border-destructive focus-visible:ring-destructive" : ""}
                    />
                    {isDuplicate && (
                        <p className="text-sm text-destructive">A entry with this name already exists.</p>
                    )}
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isLoading}>
                        Cancel
                    </Button>
                    <Button onClick={handleConfirm} disabled={isLoading || isInvalid}>
                        {isLoading ? "Cloning..." : "Clone"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
