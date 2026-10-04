import { describe, expect, it } from "vitest";
import { searchSettings } from "@/components/dashboard/settings/settings-index";
import { profileIndex } from "@/components/dashboard/profile/profile-index";
import { PROFILE_PARTS, profilePartFromAddress } from "@/components/dashboard/profile/profile-parts";
import { profileStates } from "@/components/dashboard/profile/profile-states";
import { policyOf } from "@/lib/auth/password-policy";
import { DEFAULT_TASK_COLORS } from "@/lib/core/task-colors";
import type { ProfileModel } from "@/services/user/profile-model";

function model(overrides: Partial<ProfileModel["user"]> = {}, rest: Partial<ProfileModel> = {}): ProfileModel {
    return {
        user: { id: "u1", name: "Lena Graf", email: "lena@example.ch", image: null, timezone: "Europe/Zurich", dateFormat: "P", timeFormat: "p", autoRedirectOnJobStart: true, twoFactorEnabled: false, passkeyTwoFactor: false, ...overrides },
        group: { id: "g1", name: "Operators" },
        access: ["Sees everything.", "Changes nothing."],
        hasPassword: true,
        passwordPolicy: policyOf("standard"),
        showSignInProviders: false,
        sessions: 2,
        colors: DEFAULT_TASK_COLORS,
        can: { updateName: true, updateEmail: true, updatePassword: true, manage2FA: true, managePasskeys: true, manageSso: true, seeGroups: false },
        ...rest,
    };
}

const TABLES = { pageSize: 20, density: "comfortable" } as const;

describe("the address of the Profile page", () => {
    it("opens the part it names, and the tabs of old links and of the sign-in provider coming back", () => {
        expect(profilePartFromAddress("colors", null)).toBe("colors");
        expect(profilePartFromAddress(null, "sso")).toBe("security");
        expect(profilePartFromAddress(null, "preferences")).toBe("tables");
        expect(profilePartFromAddress("nothing", "nothing")).toBeNull();
    });
});

describe("the states beside the parts of the profile", () => {
    it("asks for a look at a password without a second factor, and says nothing without a password", () => {
        expect(profileStates(model(), { colors: DEFAULT_TASK_COLORS, tables: TABLES }).security).toEqual({ text: "2FA off", tone: "warning" });
        expect(profileStates(model({ passkeyTwoFactor: true }), { colors: DEFAULT_TASK_COLORS, tables: TABLES }).security).toEqual({ text: "2FA on" });
        expect(profileStates(model({}, { hasPassword: false }), { colors: DEFAULT_TASK_COLORS, tables: TABLES }).security).toBeUndefined();
    });

    it("names the sessions, the theme, the colors, the zone and the rows per page", () => {
        const states = profileStates(model({ timezone: "" }), { theme: "dark", colors: { ...DEFAULT_TASK_COLORS, success: "#123456" }, tables: TABLES });

        expect(states).toMatchObject({
            sessions: { text: "2" },
            appearance: { text: "Dark" },
            colors: { text: "Yours" },
            dates: { text: "This browser" },
            tables: { text: "20 rows" },
        });
        expect(profileStates(model(), { colors: DEFAULT_TASK_COLORS, tables: TABLES }).colors).toEqual({ text: "Default" });
        expect(profileStates(model(), { colors: DEFAULT_TASK_COLORS, tables: TABLES }).dates).toEqual({ text: "Zurich" });
    });
});

describe("the search of the Profile page", () => {
    it("finds a setting by the start of its words, in the order of the parts", () => {
        const search = searchSettings(profileIndex(), "passk", PROFILE_PARTS.map((part) => part.id));

        // The part itself names the passkeys in its line.
        expect(search.hits.map((hit) => hit.id)).toEqual(["security", "profile.passkey-factor", "profile.passkeys"]);
        expect(search.counts).toEqual({ security: 3 });
        expect(searchSettings(profileIndex(), "colorblind", PROFILE_PARTS.map((part) => part.id)).hits.map((hit) => hit.part)).toEqual(["colors"]);
    });
});
