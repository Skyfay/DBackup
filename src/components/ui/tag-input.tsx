"use client";

import * as React from "react";
import { X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface TagInputProps {
    value: string[];
    onChange: (value: string[]) => void;
    placeholder?: string;
    validate?: (input: string) => boolean;
    className?: string;
    disabled?: boolean;
}

/**
 * A tag/chip input component that allows users to enter multiple values.
 * Type a value and press Enter, Space, Tab, or comma to add it as a tag.
 * Click the X button on a tag to remove it.
 */
export function TagInput({
    value = [],
    onChange,
    placeholder = "Type and press Enter...",
    validate,
    className,
    disabled = false,
}: TagInputProps) {
    const [inputValue, setInputValue] = React.useState("");
    const inputRef = React.useRef<HTMLInputElement>(null);

    const tags = Array.isArray(value) ? value : value ? [value] : [];

    const addTag = (raw: string) => {
        const tag = raw.trim();
        if (!tag) return;
        if (tags.includes(tag)) {
            setInputValue("");
            return;
        }
        if (validate && !validate(tag)) return;
        onChange([...tags, tag]);
        setInputValue("");
    };

    const removeTag = (index: number) => {
        onChange(tags.filter((_, i) => i !== index));
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        const val = inputValue.trim();

        if (e.key === "Enter" || e.key === "Tab" || e.key === ",") {
            e.preventDefault();
            if (val) addTag(val);
        } else if (e.key === " ") {
            // Only add on Space if current input looks like a complete email
            if (val && validate && validate(val)) {
                e.preventDefault();
                addTag(val);
            }
        } else if (e.key === "Backspace" && !inputValue && tags.length > 0) {
            removeTag(tags.length - 1);
        }
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
        e.preventDefault();
        const pasteData = e.clipboardData.getData("text");
        // Split pasted content by comma, semicolon, space, or newline
        const items = pasteData.split(/[,;\s\n]+/).filter(Boolean);
        const newTags = items.filter(
            (item) => !tags.includes(item.trim()) && (!validate || validate(item.trim()))
        );
        if (newTags.length > 0) {
            onChange([...tags, ...newTags.map((t) => t.trim())]);
        }
        setInputValue("");
    };

    return (
        <div
            className={cn(
                "flex min-h-9 w-full flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-3 py-1.5 text-sm shadow-xs transition-colors",
                "focus-within:border-ring focus-within:ring-ring/50 focus-within:ring-[3px]",
                disabled && "cursor-not-allowed opacity-50",
                className,
            )}
            onClick={() => inputRef.current?.focus()}
        >
            {tags.map((tag, index) => (
                <Badge
                    key={`${tag}-${index}`}
                    variant="secondary"
                    className="gap-1 pr-1 text-xs font-normal"
                >
                    {tag}
                    {!disabled && (
                        <button
                            type="button"
                            className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
                            onClick={(e) => {
                                e.stopPropagation();
                                removeTag(index);
                            }}
                            aria-label={`Remove ${tag}`}
                        >
                            <X className="h-3 w-3" />
                        </button>
                    )}
                </Badge>
            ))}
            <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onPaste={handlePaste}
                onBlur={() => {
                    // Add current value on blur if valid
                    const val = inputValue.trim();
                    if (val && (!validate || validate(val))) {
                        addTag(val);
                    }
                }}
                placeholder={tags.length === 0 ? placeholder : ""}
                disabled={disabled}
                className="flex-1 min-w-30 bg-transparent outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
            />
        </div>
    );
}
