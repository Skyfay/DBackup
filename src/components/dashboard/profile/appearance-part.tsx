"use client";

import { useSyncExternalStore } from "react";
import { useTheme } from "next-themes";
import { Monitor, Moon, Sun } from "lucide-react";
import { PartFrame } from "@/components/dashboard/settings/settings-frame";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const THEMES = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Monitor },
] as const;

/** A small picture of the app in a theme: the sidebar and a card on the page. */
function ThemePicture({ theme }: { theme: (typeof THEMES)[number]["value"] }) {
    const light = <span className="flex flex-1 gap-1.5 bg-[#f4f4f5] p-2"><span className="w-6 rounded-sm border border-[#e4e4e7] bg-white" /><span className="flex-1 rounded-sm border border-[#e4e4e7] bg-white" /></span>;
    const dark = <span className="flex flex-1 gap-1.5 bg-[#0f0f11] p-2"><span className="w-6 rounded-sm border border-[#2a2a2e] bg-[#1a1a1c]" /><span className="flex-1 rounded-sm border border-[#2a2a2e] bg-[#1a1a1c]" /></span>;
    return (
        <span className="flex h-20 overflow-hidden rounded-md border" aria-hidden="true">
            {theme === "light" ? light : theme === "dark" ? dark : <>{light}{dark}</>}
        </span>
    );
}

const subscribeNever = () => () => {};

/** Light, dark or the theme of the system, which applies at once and stays in this browser. */
export function AppearancePart() {
    const { theme, setTheme } = useTheme();
    // The theme is known only in the browser, so the cards wait for it rather than showing a wrong pick.
    const mounted = useSyncExternalStore(subscribeNever, () => true, () => false);

    return (
        <PartFrame part="appearance">
            <div data-setting="profile.theme" className="rounded-lg">
                {mounted ? (
                    <div role="radiogroup" aria-label="Theme" className="grid max-w-xl gap-3 sm:grid-cols-3">
                        {THEMES.map((option) => {
                            const picked = theme === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    role="radio"
                                    aria-checked={picked}
                                    onClick={() => setTheme(option.value)}
                                    className={cn(
                                        "grid gap-2.5 rounded-xl border p-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring/50",
                                        picked && "border-foreground ring-1 ring-foreground"
                                    )}
                                >
                                    <ThemePicture theme={option.value} />
                                    <span className="flex items-center gap-2 px-0.5 text-sm font-medium">
                                        <option.icon className="size-4" aria-hidden="true" />
                                        {option.label}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                ) : (
                    <div className="grid max-w-xl gap-3 sm:grid-cols-3">
                        {THEMES.map((option) => <Skeleton key={option.value} className="h-32 rounded-xl" />)}
                    </div>
                )}
                <p className="mt-3 text-xs text-muted-foreground">It applies at once and stays in this browser. The colors of the tasks follow it, see Colors.</p>
            </div>
        </PartFrame>
    );
}
