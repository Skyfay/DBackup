import type { PartState } from "@/components/dashboard/settings/settings-states";
import { zoneName } from "@/components/dashboard/settings/timezone-field";
import type { TableDefaults } from "@/lib/core/table-preferences";
import { presetOf, type TaskColors } from "@/lib/core/task-colors";
import type { ProfileModel } from "@/services/user/profile-model";
import type { ProfilePartId } from "./profile-parts";

const THEMES: Record<string, string> = { light: "Light", dark: "Dark", system: "System" };

/** The state of every part that has one, like how many sessions are open. */
export function profileStates(model: ProfileModel, extra: { theme?: string; colors: TaskColors; tables: TableDefaults }): Partial<Record<ProfilePartId, PartState>> {
    const { user } = model;
    const secondFactor = user.twoFactorEnabled || user.passkeyTwoFactor;
    const states: Partial<Record<ProfilePartId, PartState | null>> = {
        // A password alone lets anyone in who learns it, so it asks for a look.
        security: secondFactor ? { text: "2FA on" } : model.hasPassword ? { text: "2FA off", tone: "warning" } : null,
        sessions: { text: String(model.sessions) },
        appearance: extra.theme && THEMES[extra.theme] ? { text: THEMES[extra.theme] } : null,
        colors: { text: presetOf(extra.colors)?.name ?? "Yours" },
        dates: { text: user.timezone ? zoneName(user.timezone) : "This browser" },
        tables: { text: `${extra.tables.pageSize} rows` },
    };
    return Object.fromEntries(Object.entries(states).filter(([, state]) => state)) as Partial<Record<ProfilePartId, PartState>>;
}
