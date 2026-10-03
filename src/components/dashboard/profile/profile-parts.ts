import { Clock3, MonitorSmartphone, Palette, Play, Rows3, ShieldCheck, Sun, UserRound, type LucideIcon } from "lucide-react";

/**
 * The parts of the Profile page as plain data: where each sits in the navigation and what its head
 * says. The page is built like Settings, see `settings-frame.tsx`.
 */

export type ProfilePartId = "account" | "security" | "sessions" | "appearance" | "colors" | "dates" | "tables" | "runs";

export interface ProfilePart {
    id: ProfilePartId;
    label: string;
    /** The line under the title of the part. */
    description: string;
    icon: LucideIcon;
}

export const PROFILE_GROUPS: { label: string; parts: ProfilePart[] }[] = [
    {
        label: "You",
        parts: [
            { id: "account", label: "Account", icon: UserRound, description: "Who you are in DBackup: your picture, your name, your email and what your group lets you do." },
            { id: "security", label: "Security", icon: ShieldCheck, description: "How you sign in: your password, the second factor, your passkeys and the providers linked to you." },
            { id: "sessions", label: "Sessions", icon: MonitorSmartphone, description: "Every browser you are signed in with. Sign out one you do not know, and change your password." },
        ],
    },
    {
        label: "Look",
        parts: [
            { id: "appearance", label: "Appearance", icon: Sun, description: "Light, dark, or whatever your system uses right now." },
            { id: "colors", label: "Colors", icon: Palette, description: "The color of each task in both themes: what adds, edits, picks, filters, warns and deletes. Only you see your choice." },
            { id: "dates", label: "Dates and times", icon: Clock3, description: "How every date and time reads for you. The schedules follow the time zone under Settings, General." },
            { id: "tables", label: "Tables", icon: Rows3, description: "What every table starts with. A table you changed keeps its own until Reset in its Columns menu." },
        ],
    },
    {
        label: "Behavior",
        parts: [{ id: "runs", label: "Runs", icon: Play, description: "What happens after Run now." }],
    },
];

export const PROFILE_PARTS: ProfilePart[] = PROFILE_GROUPS.flatMap((group) => group.parts);

export function profilePartOf(id: string): ProfilePart {
    return PROFILE_PARTS.find((part) => part.id === id) ?? PROFILE_PARTS[0];
}

/** The tabs of the page before its parts, which old links and bookmarks still open. */
const OLD_TABS: Record<string, ProfilePartId> = {
    profile: "account",
    appearance: "appearance",
    preferences: "tables",
    security: "security",
    sessions: "sessions",
    sso: "security",
};

/** The part an address opens, from `?part=` or an old `?tab=`, none when it names neither. */
export function profilePartFromAddress(part: string | null, tab: string | null): ProfilePartId | null {
    if (part && PROFILE_PARTS.some((entry) => entry.id === part)) return part as ProfilePartId;
    if (tab && tab in OLD_TABS) return OLD_TABS[tab];
    return null;
}
