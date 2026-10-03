import type { SettingEntry } from "@/components/dashboard/settings/settings-index";
import { PROFILE_PARTS, type ProfilePartId } from "./profile-parts";

/**
 * Every setting the search of the Profile page finds, in the words of its part. A result opens its
 * part and marks the row whose `data-setting` is its id.
 */
const SETTINGS: SettingEntry<ProfilePartId>[] = [
    { part: "account", id: "profile.picture", label: "Picture", text: "Shown in the sidebar and beside your name." },
    { part: "account", id: "profile.name", label: "Name", text: "Shown in the audit log and as who started a run." },
    { part: "account", id: "profile.email", label: "Email", text: "You sign in with it." },
    { part: "account", id: "profile.access", label: "Your access", text: "What your group lets you do." },
    { part: "security", id: "profile.password", label: "Password", text: "Change the password you sign in with." },
    { part: "security", id: "profile.authenticator", label: "Authenticator app", text: "A code from an app as the second factor, with backup codes." },
    { part: "security", id: "profile.passkey-factor", label: "A passkey counts as the second factor", text: "The password and a passkey instead of a code from the app." },
    { part: "security", id: "profile.passkeys", label: "Passkeys", text: "Sign in with a fingerprint, a face or a security key." },
    { part: "security", id: "profile.providers", label: "Sign-in providers", text: "Single sign-on accounts linked to you, like Authentik or Keycloak." },
    { part: "appearance", id: "profile.theme", label: "Theme", text: "Light, dark or the one of your system." },
    { part: "colors", id: "profile.colors", label: "Colors of the tasks", text: "Add, Edit, Pick, Filter, Warning, Delete and Success, also colorblind friendly." },
    { part: "dates", id: "profile.timezone", label: "Time zone", text: "The clock every date and time follows for you." },
    { part: "dates", id: "profile.date", label: "Date format", text: "How a date reads, like 30.09.2026." },
    { part: "dates", id: "profile.time", label: "Time format", text: "How a time reads, like 14:05." },
    { part: "tables", id: "profile.rows", label: "Rows per page", text: "How many rows a table shows before its next page." },
    { part: "tables", id: "profile.density", label: "Row height", text: "Compact fits more rows on the screen." },
    { part: "runs", id: "profile.open-run", label: "Open the run", text: "Shows its live log right away after Run now." },
];

/** The settings of the profile and its parts. */
export function profileIndex(): SettingEntry<ProfilePartId>[] {
    return [...PROFILE_PARTS.map((part): SettingEntry<ProfilePartId> => ({ part: part.id, id: part.id, label: part.label, text: part.description })), ...SETTINGS];
}
