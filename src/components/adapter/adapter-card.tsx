
"use client";

import { createElement } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Edit, Trash2 } from "lucide-react";
import { AdapterConfig } from "./types";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { getAdapterIcon } from "./utils";

interface AdapterCardProps {
    config: AdapterConfig;
    definition: AdapterDefinition;
    onDelete: () => void;
    onEdit: () => void;
    canManage: boolean;
}

export function AdapterCard({ config, definition, onDelete, onEdit, canManage }: AdapterCardProps) {
    const parsedConfig = JSON.parse(config.config);
    const Icon = getAdapterIcon(definition?.id || config.adapterId);

    // Helper to format config values for display
    const getDisplayValue = (key: string, value: any) => {
        if (key.toLowerCase().includes('password') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token') || key.toLowerCase().includes('key')) {
            return '••••••••';
        }
        if (typeof value === 'object') return JSON.stringify(value);
        return String(value);
    };

    // Filter out complex or empty keys for the preview
    const displayEntries = Object.entries(parsedConfig)
        .filter(([key, val]) => val !== "" && val !== null && val !== undefined && !['options'].includes(key))
        .slice(0, 4);

    return (
        <Card className="group relative overflow-hidden transition-all hover:shadow-md border-muted-foreground/20">
            {canManage && (
                <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-background/50 backdrop-blur-sm rounded-md p-0.5">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onEdit}>
                        <Edit className="h-3.5 w-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={onDelete}>
                        <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                </div>
            )}

            <CardHeader className="flex flex-row items-center gap-4 pb-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    {createElement(Icon, { className: "h-5 w-5" })}
                </div>
                <div className="grid gap-1">
                    <CardTitle className="text-base font-semibold leading-none tracking-tight">
                         {config.name}
                    </CardTitle>
                    <CardDescription className="text-xs">
                        {definition?.name || config.adapterId}
                    </CardDescription>
                </div>
            </CardHeader>
            <CardContent>
                <div className="grid gap-1.5 text-xs text-muted-foreground mt-2">
                    {displayEntries.length > 0 ? (
                        displayEntries.map(([key, value]) => (
                             <div key={key} className="flex items-center justify-between gap-2">
                                <span className="capitalize">{key}:</span>
                                <span className="font-mono truncate max-w-[120px]" title={String(value)}>{getDisplayValue(key, value)}</span>
                            </div>
                        ))
                    ) : (
                        <div className="text-xs text-muted-foreground italic">No specific configuration</div>
                    )}
                </div>
            </CardContent>
        </Card>
    )
}
