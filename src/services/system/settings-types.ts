import type { AdapterListItemDTO } from "@/lib/adapters/dto";
import type { DataRetentionId } from "@/lib/core/data-retention";
import type { RateLimitConfig } from "@/lib/rate-limit";
import type { ConfigBackupSettings } from "@/services/config/config-backup-settings";
import type { NotificationsModel } from "@/services/notifications/notification-settings-service";
import type { CertificateInfo } from "./certificate-service";
import type { DatabaseInfo } from "./database-service";
import type { TrashRow } from "@/services/trash/trash-types";
import type { TaskRunRecord } from "./system-task-service";
import type { IntegritySettings, SystemTaskRow } from "./system-task-settings";
import type { GeneralSettings, PrivacySettings, SignInSettings } from "./system-settings-service";
import type { LoginImageInfo } from "./login-image-service";

export type { ConfigBackupSettings, CertificateInfo, DatabaseInfo, GeneralSettings, IntegritySettings, PrivacySettings, RateLimitConfig, SignInSettings, SystemTaskRow, TaskRunRecord, TrashRow };

/** A sign-in provider as the Sign-in part names it. */
export interface SettingsProvider {
    name: string;
    adapterId: string;
    enabled: boolean;
}

/** An encryption key the configuration backup can use. */
export interface SettingsKey {
    id: string;
    name: string;
    description: string | null;
    jobCount: number;
}

/** Everything the Settings page shows, read once on the server. */
export interface SettingsModel {
    canManage: boolean;
    isSuperAdmin: boolean;
    general: GeneralSettings;
    signIn: SignInSettings & {
        /** DISABLE_EMAIL_LOGIN on the container. */
        emailLoginDisabledByEnv: boolean;
        providers: SettingsProvider[];
        /** Turning the passkey button off would leave nobody a way to sign in. */
        passkeyIsLastWayIn: boolean;
        /** The picture of the login page, kept while the logos show too. */
        loginImage: LoginImageInfo | null;
    };
    privacy: PrivacySettings;
    retention: {
        values: Record<DataRetentionId, number>;
        counts: Record<DataRetentionId, number>;
    };
    /** Null when the file system could not tell. */
    database: DatabaseInfo | null;
    configBackup: {
        settings: ConfigBackupSettings;
        destinations: AdapterListItemDTO[];
        keys: SettingsKey[];
        lastRun: TaskRunRecord | null;
        running: boolean;
    };
    rateLimits: RateLimitConfig;
    /** Null when the certificate could not be read at all. */
    certificate: CertificateInfo | null;
    tasks: SystemTaskRow[];
    integrity: IntegritySettings;
    /** Every notification event with where it goes, and the default channels. */
    notifications: NotificationsModel;
    /** What Recently deleted holds that the viewer may restore, newest first. */
    trash: TrashRow[];
}
