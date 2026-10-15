import type { PasswordPolicy } from "@/lib/auth/password-policy";
import type { DeviceKind, UserAgentInfo } from "@/lib/core/user-agent";

/**
 * What the Users tab of the Users & Groups page shows: every user with how they sign in and what
 * their group lets them do, and a panel with the details of one. Plain data, so the browser can
 * import it without the services behind it.
 */

/** A way a user proves who they are. The second factor is apart, see `SecondFactor`. */
export type SignInMethod =
    | { kind: "password" }
    | { kind: "passkey"; count: number }
    | { kind: "sso"; providerId: string; name: string; adapterId: string | null };

/**
 * What protects a sign-in besides the password: a passkey or an app DBackup asks for, the
 * provider of a user who only signs in with SSO, nothing, or no password to protect at all.
 */
export type SecondFactor = "passkey" | "app" | "sso" | "none" | "no-password";

/** Where and when a user last signed in, from the audit log or their newest session. */
export interface UserSignIn {
    at: string;
    agent: UserAgentInfo | null;
    ip: string | null;
}

export interface UserGroupRef {
    id: string;
    name: string;
}

/** The group an account holds in one tenant, for the list of every account in All tenants. */
export interface UserTenantRole {
    tenantId: string;
    group: UserGroupRef;
}

export interface UserRow {
    id: string;
    name: string;
    email: string;
    image: string | null;
    createdAt: string;
    /** Their group in the tenant the list is for. Null in All tenants, where `tenants` says it per tenant. */
    group: UserGroupRef | null;
    /** In All tenants: every tenant the account works in with its group there. Absent inside a tenant. */
    tenants?: UserTenantRole[];
    /** A platform admin, who sees every tenant. Only a platform admin changes their account. */
    superAdmin: boolean;
    /** On the list of every account: the platform group, none for a platform admin or someone without one. Absent inside a tenant. */
    platformGroup?: UserGroupRef | null;
    /**
     * Works in another tenant as well. Their account belongs to all of them, so only a platform
     * admin changes it, while their group here stays the admins' of this tenant to change.
     */
    elsewhere: boolean;
    methods: SignInMethod[];
    secondFactor: SecondFactor;
    lastSignIn: UserSignIn | null;
    /** Sessions that have not run out. */
    sessions: number;
    apiKeys: number;
    /** The signed-in viewer. */
    isYou: boolean;
}

/** A group a user can be in, with the permissions to say what it lets them do. */
export interface UsersGroup {
    id: string;
    name: string;
    /** The tenant it belongs to, on the list of every account, where each tenant offers its own groups. */
    tenantId?: string;
    /** Its members in the tenant the list is for. */
    members: number;
    permissions: string[];
    /** The group with every permission (`fullAccess`). */
    superAdmin: boolean;
}

export interface UsersStats {
    users: number;
    /** In a group of the tenant, or in All tenants in some tenant. */
    inGroup: number;
    /** Names, for the numbers above the list. In All tenants the accounts of no tenant. */
    withoutGroup: string[];
    /** Users with a password and no second factor. */
    passwordOnly: string[];
    /** Users whose sign-in has more than a password. */
    protected: number;
    /** Users who signed in within the last 30 days. */
    signedIn: number;
    never: string[];
    sessions: number;
    /** The browsers those sessions run in, one per user and kind of browser and system. */
    devices: number;
}

export interface UsersModel {
    users: UserRow[];
    groups: UsersGroup[];
    stats: UsersStats;
    /** The viewer is a platform admin, who may give every group and change every account. */
    viewerPlatformAdmin: boolean;
    /** The rules of Settings > Passwords, which Generate and the ticks under a new password follow. */
    passwordPolicy: PasswordPolicy;
    /** The home tenant, the only one where an account may stay without a group. */
    homeTenant: boolean;
    /**
     * Every account of the instance once, for Users & Groups of the Platform. Each row names its
     * tenants with the group in each, and none has a group of its own. The groups are the ones of
     * every tenant, each with its tenant.
     */
    allTenants: boolean;
}

export interface UserSession {
    id: string;
    createdAt: string;
    expiresAt: string;
    agent: UserAgentInfo;
    device: DeviceKind;
    ip: string | null;
    /** The session of the viewer who looks at it. */
    current: boolean;
}

export interface UserPasskey {
    id: string;
    name: string | null;
    createdAt: string | null;
    /** "singleDevice" or "multiDevice", as WebAuthn names it. */
    deviceType: string;
}

export interface UserSsoLink {
    providerId: string;
    name: string;
    adapterId: string | null;
    linkedAt: string;
}

export interface UserApiKey {
    id: string;
    name: string;
    prefix: string;
    enabled: boolean;
    expiresAt: string | null;
    lastUsedAt: string | null;
}

export interface UserActivity {
    id: string;
    at: string;
    action: string;
    text: string;
}

/** Everything the panel of one user shows beyond its row. */
export interface UserDetails {
    id: string;
    /** When the password was last set, null without a password. */
    password: { changedAt: string } | null;
    /** An authenticator app is set up as the second factor. */
    app: boolean;
    passkeys: UserPasskey[];
    sso: UserSsoLink[];
    sessions: UserSession[];
    apiKeys: UserApiKey[];
    /** The newest entries of the audit log written by the user. */
    activity: UserActivity[];
    /** How many days the audit log keeps. */
    auditDays: number;
}
