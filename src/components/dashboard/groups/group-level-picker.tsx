"use client";

import { LEVEL_LABELS, LEVELS, levelsOf, type AreaLevel, type Level, type PermissionArea } from "@/lib/auth/permission-areas";
import { cn } from "@/lib/utils";

interface LevelPickerProps {
    area: PermissionArea;
    value: AreaLevel;
    onChange: (level: Level) => void;
    disabled?: boolean;
    className?: string;
}

/**
 * The level of one area as a row of five buttons, None to Full. A level the area does not have
 * stays in its place as a hyphen, so the levels line up from area to area. The picked one takes the
 * tone of the dialog, and none is picked while the permissions match no level.
 */
export function LevelPicker({ area, value, onChange, disabled = false, className }: LevelPickerProps) {
    const offered = levelsOf(area);
    return (
        <div role="radiogroup" aria-label={`Level of ${area.label}`} className={cn("inline-flex shrink-0 rounded-lg bg-muted p-0.5", className)}>
            {LEVELS.map((level) => {
                const available = offered.includes(level);
                const on = level === value;
                return (
                    <button
                        key={level}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={available ? LEVEL_LABELS[level] : `${LEVEL_LABELS[level]}, which ${area.label} does not have`}
                        disabled={disabled || !available}
                        onClick={() => onChange(level)}
                        className={cn(
                            "h-7 min-w-11 flex-1 rounded-md px-2 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-tone-ring/50 sm:min-w-14 sm:flex-none",
                            on ? "bg-tone-control text-tone-control-foreground shadow-xs" : "text-muted-foreground hover:text-foreground",
                            !available && "cursor-default text-muted-foreground/40 hover:text-muted-foreground/40",
                        )}
                    >
                        {available ? LEVEL_LABELS[level] : "-"}
                    </button>
                );
            })}
        </div>
    );
}
