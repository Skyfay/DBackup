import { useFormContext } from "react-hook-form";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { transferConcurrencyRange } from "@/lib/adapters/transfer-concurrency";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { STORAGE_ROLES, type StorageRole } from "@/lib/core/storage-roles";
import { sshManagedKeys } from "@/lib/adapters/ssh-key-convention";
import { cn } from "@/lib/utils";
import { AlertTriangle, Check, ChevronDown, Loader2 } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { SchemaField } from "./schema-field";
import { EmailTagField } from "./email-tag-field";
import { FirebirdAliasFields } from "./firebird-alias-fields";
import { RedisDatabaseSelect } from "./redis-database-select";
import { STORAGE_ADVANCED_KEYS, STORAGE_CONFIG_KEYS, STORAGE_CONNECTION_KEYS, NOTIFICATION_CONNECTION_KEYS, NOTIFICATION_CONFIG_KEYS } from "./form-constants";
import { OAuthAuthorization } from "./oauth-authorization";
import { CloudFolderField } from "./cloud-folder-field";
import { ParallelTransfersField, ParallelUploadFields } from "./storage-speed-fields";
import { SnapshotSwitch } from "./snapshot-switch";
import { CredentialPicker } from "./credential-picker";
import type { CredentialProfileSummary } from "@/components/settings/credential-profile-dialog";
import { AdapterConfig } from "./types";

interface CredentialPickerHostProps {
    primaryCredentialId?: string | null;
    sshCredentialId?: string | null;
    onPrimaryChange?: (id: string | null) => void;
    onSshChange?: (id: string | null) => void;
}

interface SectionProps extends CredentialPickerHostProps {
    adapter: AdapterDefinition;
    detectedVersion?: string | null;
    healthNotificationsDisabled?: boolean;
    onHealthNotificationsDisabledChange?: (disabled: boolean) => void;
    isRestoreExcluded?: boolean;
    onIsRestoreExcludedChange?: (excluded: boolean) => void;
}

/**
 * Renders the primary credential picker if the adapter declares a primary
 * credential slot. Returns null otherwise.
 */
function PrimaryCredentialPickerSlot({
    adapter,
    primaryCredentialId,
    onPrimaryChange,
    onSelectedProfile,
    refreshKey,
}: { adapter: AdapterDefinition; onSelectedProfile?: (p: CredentialProfileSummary | null) => void; refreshKey?: number } & CredentialPickerHostProps) {
    const required = adapter.credentials?.primary;
    if (!required || !onPrimaryChange) return null;
    return (
        <CredentialPicker
            slot="primary"
            requiredType={required}
            value={primaryCredentialId ?? null}
            onChange={onPrimaryChange}
            label="Credential Profile"
            onSelectedProfile={onSelectedProfile}
            refreshKey={refreshKey}
        />
    );
}

/**
 * Renders the SSH credential picker if the adapter declares an SSH slot.
 * Returns null otherwise.
 */
function SshCredentialPickerSlot({
    adapter,
    sshCredentialId,
    onSshChange,
}: { adapter: AdapterDefinition } & CredentialPickerHostProps) {
    const required = adapter.credentials?.ssh;
    if (!required || !onSshChange) return null;
    return (
        <CredentialPicker
            slot="ssh"
            requiredType={required}
            value={sshCredentialId ?? null}
            onChange={onSshChange}
            label="SSH Credential Profile"
            description="Reusable SSH credential used for the tunnel or remote command execution."
        />
    );
}

/**
 * Stands in for the form until a mode has been picked.
 *
 * Every adapter with more than one connection mode deliberately shows nothing until one is
 * chosen, because the modes ask for different things and guessing would present the wrong
 * form. Rendering nothing at all left a blank panel that reads like a broken dialog, so it
 * says what it is waiting for instead.
 */
function ChooseConnectionModeHint({ label = "connection mode" }: { label?: string }) {
    return (
        <p className="text-sm text-muted-foreground pt-4">
            Choose a {label} above to continue.
        </p>
    );
}

/**
 * Settings that are correct out of the box and exist only for the case that is not.
 *
 * Collapsed by default, so the common path is not asked a question it has no way to answer.
 * Everything in here must have a working default, or hiding it would turn a required field
 * into an invisible one.
 */
function AdvancedSettings({ adapter, keys }: { adapter: AdapterDefinition; keys: string[] }) {
    const [open, setOpen] = useState(false);

    return (
        <Collapsible open={open} onOpenChange={setOpen} className="rounded-lg border">
            <CollapsibleTrigger asChild>
                <Button
                    type="button"
                    variant="ghost"
                    className="w-full justify-between px-4 py-3 h-auto font-normal"
                >
                    <span className="text-sm font-medium">Advanced</span>
                    <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
                </Button>
            </CollapsibleTrigger>
            <CollapsibleContent>
                <div className="space-y-4 border-t p-4">
                    <FieldList keys={keys} adapter={adapter} />
                </div>
            </CollapsibleContent>
        </Collapsible>
    );
}

function HealthCheckNotificationSwitch({
    type,
    disabled,
    onChange,
}: {
    type: "database" | "storage";
    disabled: boolean;
    onChange: (disabled: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="health-notifications-disabled">Disable Health Check Notifications</Label>
                <p className="text-sm text-muted-foreground">
                    Suppress offline and recovery alerts for this {type === "database" ? "source" : "destination"}. Health checks still run.
                </p>
            </div>
            <Switch
                id="health-notifications-disabled"
                checked={disabled}
                onCheckedChange={onChange}
            />
        </div>
    );
}

function DisableVerificationSwitch({
    disabled,
    onChange,
}: {
    disabled: boolean;
    onChange: (disabled: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="skip-verification">Disable Verification</Label>
                <p className="text-sm text-muted-foreground">
                    Exclude this destination from scheduled integrity checks.
                </p>
            </div>
            <Switch
                id="skip-verification"
                checked={disabled}
                onCheckedChange={onChange}
            />
        </div>
    );
}

/**
 * Picks the adapter's single role.
 *
 * Exclusive on purpose: a destination owns its configured root - the runner writes
 * `<root>/<jobName>/` into it and incremental jobs add chain folders - while a source
 * reads folders out of that same root. One config doing both would let a job collect its
 * own archives, so there is no "both" and no "neither".
 */
const ROLE_CHOICES = [
    {
        value: STORAGE_ROLES.DESTINATION,
        id: "role-destination",
        title: "Backup Destination",
        description: "Backups are written into this adapter's configured path, one folder per job.",
    },
    {
        value: STORAGE_ROLES.SOURCE,
        id: "role-source",
        title: "Directory Source",
        description: "Folders below this adapter's configured path can be picked as backup sources.",
    },
] as const;

function AdapterRolePicker({
    storageRole,
    onStorageRoleChange,
    supportedRoles,
}: {
    storageRole: StorageRole;
    onStorageRoleChange: (role: StorageRole) => void;
    /** Both roles when the adapter does not restrict them, which is the usual case. */
    supportedRoles?: readonly StorageRole[];
}) {
    const choices = supportedRoles
        ? ROLE_CHOICES.filter((choice) => supportedRoles.includes(choice.value))
        : ROLE_CHOICES;

    // An adapter that only works one way round is told, not asked. The API rejects the other
    // role anyway, so a control offering it would only produce a rejected save.
    if (choices.length === 1) {
        const only = choices[0];
        return (
            <div className="rounded-lg border p-4 space-y-0.5">
                <Label>Role</Label>
                <p className="text-sm font-medium">{only.title}</p>
                <p className="text-sm text-muted-foreground">{only.description}</p>
            </div>
        );
    }

    return (
        <div className="rounded-lg border p-4 space-y-3">
            <div className="space-y-0.5">
                <Label>Role</Label>
                <p className="text-sm text-muted-foreground">
                    What this storage adapter is used for. An adapter is one or the other, never both.
                </p>
            </div>
            <RadioGroup
                value={storageRole}
                onValueChange={(value) => onStorageRoleChange(value as StorageRole)}
                className="gap-3"
            >
                {choices.map((choice) => (
                    <div key={choice.value} className="flex items-start space-x-2">
                        <RadioGroupItem value={choice.value} id={choice.id} className="mt-1" />
                        <Label htmlFor={choice.id} className="font-normal cursor-pointer">
                            <span className="font-medium">{choice.title}</span>
                            <span className="block text-sm text-muted-foreground">{choice.description}</span>
                        </Label>
                    </div>
                ))}
            </RadioGroup>
        </div>
    );
}

function RestoreExcludedSwitch({
    excluded,
    onChange,
}: {
    excluded: boolean;
    onChange: (excluded: boolean) => void;
}) {
    return (
        <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
                <Label htmlFor="restore-excluded">Exclude from Restore</Label>
                <p className="text-sm text-muted-foreground">
                    This source will not appear as a restore target when recovering backups.
                </p>
            </div>
            <Switch
                id="restore-excluded"
                checked={excluded}
                onCheckedChange={onChange}
            />
        </div>
    );
}

export function DatabaseFormContent({
    adapter,
    detectedVersion,
    healthNotificationsDisabled,
    onHealthNotificationsDisabledChange,
    isRestoreExcluded,
    onIsRestoreExcludedChange,
    primaryCredentialId,
    sshCredentialId,
    onPrimaryChange,
    onSshChange,
}: SectionProps) {
    const { watch, getValues } = useFormContext();
    const mode = watch("config.mode");
    const authType = watch("config.authType");
    const [isTestingSqliteSsh, setIsTestingSqliteSsh] = useState(false);

    const testSqliteSshConnection = async () => {
        setIsTestingSqliteSsh(true);
        const toastId = toast.loading("Testing SSH connection...");
        try {
            const config = getValues("config");
            const res = await fetch("/api/adapters/test-ssh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    config,
                    adapterId: adapter.id,
                    sshCredentialId: sshCredentialId ?? null,
                }),
            });
            const result = await res.json();
            toast.dismiss(toastId);
            if (result.success) {
                toast.success(result.message || "SSH connection successful");
            } else {
                toast.error(result.message || "SSH connection failed");
            }
        } catch {
            toast.dismiss(toastId);
            toast.error("Failed to test SSH connection");
        } finally {
            setIsTestingSqliteSsh(false);
        }
    };

    if (adapter.id === "sqlite") {
        // SQLite calls it "Mode" rather than "Connection Mode", so the hint follows the
        // label the user is actually looking at.
        if (!mode) return <ChooseConnectionModeHint label="mode" />;

        return (
            <div className="space-y-4 pt-2">
                 {detectedVersion && (
                    <div className="flex justify-start mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                 )}

                 {mode === 'local' ? (
                     <div className="space-y-4">
                         <div className="space-y-4 border p-4 rounded-md bg-muted/10">
                             <div className="space-y-4">
                                <FieldList keys={['path']} adapter={adapter} />
                                {/* sqliteBinaryPath hidden for local mode as requested */}
                             </div>
                         </div>
                         {onHealthNotificationsDisabledChange && (
                             <HealthCheckNotificationSwitch
                                 type="database"
                                 disabled={healthNotificationsDisabled ?? false}
                                 onChange={onHealthNotificationsDisabledChange}
                             />
                         )}
                         {onIsRestoreExcludedChange && (
                             <RestoreExcludedSwitch
                                 excluded={isRestoreExcluded ?? false}
                                 onChange={onIsRestoreExcludedChange}
                             />
                         )}
                     </div>
                 ) : (
                    <Tabs defaultValue="connection" className="w-full pt-2">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="connection">SSH Connection</TabsTrigger>
                            <TabsTrigger value="configuration">Configuration</TabsTrigger>
                        </TabsList>

                        <TabsContent value="connection" className="space-y-4 pt-4 border p-4 rounded-md bg-muted/10 mt-2">
                             <SshCredentialPickerSlot
                                 adapter={adapter}
                                 sshCredentialId={sshCredentialId}
                                 onSshChange={onSshChange}
                             />
                             <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                                <div className="md:col-span-3">
                                    <FieldList keys={['host']} adapter={adapter} />
                                </div>
                                <div className="md:col-span-1">
                                    <FieldList keys={['port']} adapter={adapter} />
                                </div>
                            </div>

                            <FieldList keys={['username', 'authType']} adapter={adapter} />

                            {authType === 'password' && (
                                <FieldList keys={['password']} adapter={adapter} />
                            )}

                            {authType === 'privateKey' && (
                                 <FieldList keys={['privateKey', 'passphrase']} adapter={adapter} />
                            )}
                            <div className="flex justify-end pt-2">
                                <Button
                                    type="button"
                                    variant="secondary"
                                    size="sm"
                                    onClick={testSqliteSshConnection}
                                    disabled={isTestingSqliteSsh}
                                >
                                    {isTestingSqliteSsh && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                                    Test SSH Connection
                                </Button>
                            </div>
                        </TabsContent>

                        <TabsContent value="configuration" className="space-y-4 pt-4 mt-2">
                            <div className="space-y-4">
                                <FieldList keys={['path']} adapter={adapter} sshCredentialId={sshCredentialId} />
                                <FieldList keys={['sqliteBinaryPath']} adapter={adapter} sshCredentialId={sshCredentialId} />
                            </div>
                            {onHealthNotificationsDisabledChange && (
                                <HealthCheckNotificationSwitch
                                    type="database"
                                    disabled={healthNotificationsDisabled ?? false}
                                    onChange={onHealthNotificationsDisabledChange}
                                />
                            )}
                            {onIsRestoreExcludedChange && (
                                <RestoreExcludedSwitch
                                    excluded={isRestoreExcluded ?? false}
                                    onChange={onIsRestoreExcludedChange}
                                />
                            )}
                        </TabsContent>
                    </Tabs>
                 )}
            </div>
        );
    }

    const isMSSQL = adapter.id === "mssql";
    const fileTransferMode = watch("config.fileTransferMode");
    const sshAuthType = watch("config.sshAuthType");
    const connectionMode = watch("config.connectionMode");

    // Every database adapter except SQLite, which returned above with its own
    // `mode` field, carries `connectionMode`. It decides the whole layout, so
    // nothing is shown until a mode is picked - the two modes ask for
    // different things and guessing one would present the wrong form.
    const hasConnectionMode = Boolean(
        adapter.configSchema.shape && "connectionMode" in adapter.configSchema.shape
    );
    if (hasConnectionMode && !connectionMode) {
        return <ChooseConnectionModeHint />;
    }

    const isSSH = connectionMode === "ssh";

    return (
        <SshAwareTabLayout
            key={connectionMode ?? "direct"}
            isSSH={isSSH}
            defaultTab={isSSH ? "ssh" : "connection"}
            adapter={adapter}
            isMSSQL={isMSSQL}
            fileTransferMode={fileTransferMode}
            sshAuthType={sshAuthType}
            detectedVersion={detectedVersion}
            healthNotificationsDisabled={healthNotificationsDisabled}
            onHealthNotificationsDisabledChange={onHealthNotificationsDisabledChange}
            isRestoreExcluded={isRestoreExcluded}
            onIsRestoreExcludedChange={onIsRestoreExcludedChange}
            primaryCredentialId={primaryCredentialId}
            sshCredentialId={sshCredentialId}
            onPrimaryChange={onPrimaryChange}
            onSshChange={onSshChange}
        />
    );
}

/**
 * Tab layout for every database adapter that picks a connection mode.
 *
 * Uses key={connectionMode} to force a remount on mode change, so the active
 * tab resets to the first one rather than landing on a tab the new mode does
 * not have.
 */
function SshAwareTabLayout({
    isSSH,
    defaultTab,
    adapter,
    isMSSQL,
    fileTransferMode,
    sshAuthType,
    detectedVersion,
    healthNotificationsDisabled,
    onHealthNotificationsDisabledChange,
    isRestoreExcluded,
    onIsRestoreExcludedChange,
    primaryCredentialId,
    sshCredentialId,
    onPrimaryChange,
    onSshChange,
}: {
    isSSH: boolean;
    defaultTab: string;
    adapter: AdapterDefinition;
    /** SQL Server is the only adapter whose backup file needs its own transfer settings. */
    isMSSQL?: boolean;
    fileTransferMode?: string;
    sshAuthType: string;
    detectedVersion?: string | null;
    healthNotificationsDisabled?: boolean;
    onHealthNotificationsDisabledChange?: (disabled: boolean) => void;
    isRestoreExcluded?: boolean;
    onIsRestoreExcludedChange?: (excluded: boolean) => void;
} & CredentialPickerHostProps) {
    return (
        <div className="space-y-4 pt-2">
            {detectedVersion && (
                <div className="flex justify-start">
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        <Check className="w-3 h-3 mr-1" />
                        Detected: {detectedVersion}
                    </Badge>
                </div>
            )}

            {isSSH ? (
                <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="ssh">SSH Connection</TabsTrigger>
                        <TabsTrigger value="connection">Database</TabsTrigger>
                        <TabsTrigger value="configuration">Configuration</TabsTrigger>
                    </TabsList>

                    <TabsContent value="ssh" className="space-y-4 pt-4">
                        <SshCredentialPickerSlot
                            adapter={adapter}
                            sshCredentialId={sshCredentialId}
                            onSshChange={onSshChange}
                        />
                        <SshConfigSection adapter={adapter} sshAuthType={sshAuthType} sshCredentialId={sshCredentialId} description="SSH credentials to execute database commands on the remote server." />
                    </TabsContent>

                    <TabsContent value="connection" className="space-y-4 pt-4">
                        <p className="text-sm text-muted-foreground">
                            Database connection as seen from the SSH host (e.g. 127.0.0.1 if the database runs on the same server).
                        </p>
                        <PrimaryCredentialPickerSlot
                            adapter={adapter}
                            primaryCredentialId={primaryCredentialId}
                            onPrimaryChange={onPrimaryChange}
                        />
                        <FieldList
                            keys={['host', 'port', 'user', 'username', 'password']}
                            adapter={adapter}
                        />
                    </TabsContent>

                    <TabsContent value="configuration" className="space-y-4 pt-4">
                        {(adapter.id === 'redis' || adapter.id === 'valkey') && <RedisDatabaseSelect />}
                        {adapter.id === 'firebird' && <FirebirdAliasFields />}
                        <FieldList
                            keys={[
                                'authenticationDatabase', 'options', 'disableSsl',
                                'mode', 'tls', 'sentinelMasterName', 'sentinelNodes',
                                'firebirdBinaryPath',
                                // SQL Server. `backupPath` lives here rather than
                                // under File Transfer, because SSH mode has no
                                // transfer to configure - the file comes back over
                                // the connection that is already set up.
                                'encrypt', 'trustServerCertificate', 'requestTimeout', 'backupPath',
                            ]}
                            adapter={adapter}
                        />
                        {isMSSQL && (
                            <p className="text-sm text-muted-foreground">
                                SQL Server writes the backup file to this path, and it travels back over
                                the same SSH connection. The SQL Server port does not need to be
                                reachable from DBackup.
                            </p>
                        )}
                        {onHealthNotificationsDisabledChange && (
                            <HealthCheckNotificationSwitch
                                type="database"
                                disabled={healthNotificationsDisabled ?? false}
                                onChange={onHealthNotificationsDisabledChange}
                            />
                        )}
                        {onIsRestoreExcludedChange && (
                            <RestoreExcludedSwitch
                                excluded={isRestoreExcluded ?? false}
                                onChange={onIsRestoreExcludedChange}
                            />
                        )}
                    </TabsContent>
                </Tabs>
            ) : (
                <Tabs defaultValue={defaultTab} className="w-full">
                    <TabsList className={cn("grid w-full", isMSSQL ? "grid-cols-3" : "grid-cols-2")}>
                        <TabsTrigger value="connection">Connection</TabsTrigger>
                        <TabsTrigger value="configuration">Configuration</TabsTrigger>
                        {isMSSQL && <TabsTrigger value="filetransfer">File Transfer</TabsTrigger>}
                    </TabsList>

                    <TabsContent value="connection" className="space-y-4 pt-4">
                        <PrimaryCredentialPickerSlot
                            adapter={adapter}
                            primaryCredentialId={primaryCredentialId}
                            onPrimaryChange={onPrimaryChange}
                        />
                        <FieldList
                            keys={['host', 'port', 'user', 'username', 'password']}
                            adapter={adapter}
                        />
                    </TabsContent>

                    <TabsContent value="configuration" className="space-y-4 pt-4">
                        {(adapter.id === 'redis' || adapter.id === 'valkey') && <RedisDatabaseSelect />}
                        {adapter.id === 'firebird' && <FirebirdAliasFields />}
                        <FieldList
                            keys={[
                                'authenticationDatabase', 'options', 'disableSsl',
                                'mode', 'tls', 'sentinelMasterName', 'sentinelNodes',
                                'firebirdBinaryPath',
                                'encrypt', 'trustServerCertificate', 'requestTimeout',
                            ]}
                            adapter={adapter}
                        />
                        {onHealthNotificationsDisabledChange && (
                            <HealthCheckNotificationSwitch
                                type="database"
                                disabled={healthNotificationsDisabled ?? false}
                                onChange={onHealthNotificationsDisabledChange}
                            />
                        )}
                        {onIsRestoreExcludedChange && (
                            <RestoreExcludedSwitch
                                excluded={isRestoreExcluded ?? false}
                                onChange={onIsRestoreExcludedChange}
                            />
                        )}
                    </TabsContent>

                    {isMSSQL && (
                        <TabsContent value="filetransfer" className="space-y-4 pt-4">
                            <FieldList keys={['backupPath', 'fileTransferMode']} adapter={adapter} />

                            {fileTransferMode === "ssh" && (
                                <>
                                    <SshCredentialPickerSlot
                                        adapter={adapter}
                                        sshCredentialId={sshCredentialId}
                                        onSshChange={onSshChange}
                                    />
                                    <SshConfigSection adapter={adapter} sshAuthType={sshAuthType} sshCredentialId={sshCredentialId} />
                                </>
                            )}
                            {fileTransferMode === "local" && (
                                <div className="space-y-4">
                                    <FieldList keys={['localBackupPath']} adapter={adapter} />
                                    <p className="text-sm text-muted-foreground">
                                        The local path must point to the same directory as the server backup path (e.g. Docker volume mount or NFS share).
                                    </p>
                                </div>
                            )}
                        </TabsContent>
                    )}
                </Tabs>
            )}
        </div>
    );
}

/**
 * SSH configuration section with integrated test button.
 * Used by MSSQL (file transfer) and other database adapters (SSH exec).
 */
function SshConfigSection({ adapter, sshAuthType, sshCredentialId, description }: { adapter: AdapterDefinition; sshAuthType: string; sshCredentialId?: string | null; description?: string }) {
    const { getValues } = useFormContext();
    const [isTestingSsh, setIsTestingSsh] = useState(false);

    const testSshConnection = async () => {
        setIsTestingSsh(true);
        const toastId = toast.loading("Testing SSH connection...");
        try {
            const config = getValues("config");
            const res = await fetch("/api/adapters/test-ssh", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ config, adapterId: adapter.id, sshCredentialId: sshCredentialId ?? null }),
            });
            const result = await res.json();
            toast.dismiss(toastId);

            if (result.success) {
                toast.success(result.message || "SSH connection successful");
            } else {
                toast.error(result.message || "SSH connection failed");
            }
        } catch {
            toast.dismiss(toastId);
            toast.error("Failed to test SSH connection");
        } finally {
            setIsTestingSsh(false);
        }
    };

    return (
        <div className="space-y-4 border p-4 rounded-md bg-muted/10">
            <p className="text-sm text-muted-foreground">
                {description || "SSH credentials to download/upload .bak files from the SQL Server host."}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="md:col-span-3">
                    <FieldList keys={['sshHost']} adapter={adapter} />
                </div>
                <div className="md:col-span-1">
                    <FieldList keys={['sshPort']} adapter={adapter} />
                </div>
            </div>
            <FieldList keys={['sshUsername', 'sshAuthType']} adapter={adapter} />
            {sshAuthType === 'password' && (
                <FieldList keys={['sshPassword']} adapter={adapter} />
            )}
            {sshAuthType === 'privateKey' && (
                <FieldList keys={['sshPrivateKey', 'sshPassphrase']} adapter={adapter} />
            )}
            <div className="flex justify-end pt-2">
                <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={testSshConnection}
                    disabled={isTestingSsh}
                >
                    {isTestingSsh && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Test SSH Connection
                </Button>
            </div>
        </div>
    );
}

export function StorageFormContent({
    adapter,
    initialData: _initialData,
    healthNotificationsDisabled,
    onHealthNotificationsDisabledChange,
    skipVerification,
    onSkipVerificationChange,
    storageRole,
    onStorageRoleChange,
    primaryCredentialId,
    sshCredentialId,
    onPrimaryChange,
    onSshChange,
}: { adapter: AdapterDefinition; initialData?: AdapterConfig; healthNotificationsDisabled?: boolean; onHealthNotificationsDisabledChange?: (disabled: boolean) => void; skipVerification?: boolean; onSkipVerificationChange?: (disabled: boolean) => void; storageRole?: StorageRole; onStorageRoleChange?: (role: StorageRole) => void } & CredentialPickerHostProps) {
    const { watch, setValue, getValues } = useFormContext();
    const authType = watch("config.authType");
    const storageClass = watch("config.storageClass");
    const isArchivedStorageClass = storageClass === "GLACIER" || storageClass === "DEEP_ARCHIVE";
    // SMB is the only adapter that can snapshot today (via MS-FSRVP).
    const supportsSnapshots = adapter.id === 'smb';
    const hasRealConfigKeys = hasFields(adapter, STORAGE_CONFIG_KEYS);
    const hasAdvancedKeys = hasFields(adapter, STORAGE_ADVANCED_KEYS);
    // Always show Configuration tab for storage adapters (health check, verification and the role picker live there)
    const hasConfigKeys = hasRealConfigKeys || hasAdvancedKeys || !!onHealthNotificationsDisabledChange || !!onSkipVerificationChange || !!onStorageRoleChange || supportsSnapshots;
    const isCloudDrive = adapter.id === 'google-drive' || adapter.id === 'dropbox' || adapter.id === 'onedrive';

    // Storage reached over SSH is new - every other storage adapter either talks to its
    // service directly or brings its own SSH client. Read from the schema, never from an
    // adapter id, so the next one to need it works without touching this file.
    const connectionMode = watch("config.connectionMode");
    const sshAuthType = watch("config.sshAuthType");
    const hasConnectionMode = "connectionMode" in ((adapter.configSchema as unknown as { shape: Record<string, unknown> }).shape ?? {});
    const isSSH = connectionMode === "ssh";

    const connectionKeys = STORAGE_CONNECTION_KEYS;
    const configKeys = STORAGE_CONFIG_KEYS;

    // OAuth authorization now lives on the credential profile: the refresh token
    // is stored there, not on the adapter. We read the selected profile's
    // `secretStatus` to know whether it's authorized - so it reflects reality
    // even before the destination itself is saved.
    const [selectedProfile, setSelectedProfile] = useState<CredentialProfileSummary | null>(null);
    const authorized = selectedProfile?.secretStatus?.refreshToken === true;

    // Incremented after a successful popup OAuth to trigger a credential re-fetch.
    const [credentialRefreshKey, setCredentialRefreshKey] = useState(0);
    const handleOAuthAuthorized = useCallback(() => setCredentialRefreshKey((k) => k + 1), []);

    // Nothing is shown until a mode is picked. The two modes ask for different things, and
    // guessing one would present a form that is wrong rather than merely empty. Same rule
    // the database form has always applied.
    if (hasConnectionMode && !connectionMode) {
        return <ChooseConnectionModeHint />;
    }

    return (
        // Keyed on the mode so switching it lands on the first tab rather than on one the
        // new mode does not populate.
        <Tabs defaultValue={isSSH ? "ssh" : "connection"} className="w-full" key={connectionMode ?? "default"}>
            {/* SSH gets its own tab rather than a block on top of the connection fields, so
                the two halves of the question stay separate: how to reach the machine, and
                what to talk to once there. Same three-tab shape as a database source. */}
            <TabsList className={cn("grid w-full", isSSH ? "grid-cols-3" : (hasConfigKeys ? "grid-cols-2" : "grid-cols-1"))}>
                {isSSH && <TabsTrigger value="ssh">SSH Connection</TabsTrigger>}
                <TabsTrigger value="connection">Connection</TabsTrigger>
                {hasConfigKeys && (
                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                )}
            </TabsList>

            {isSSH && (
                <TabsContent value="ssh" className="space-y-4 pt-4">
                    <SshCredentialPickerSlot
                        adapter={adapter}
                        sshCredentialId={sshCredentialId}
                        onSshChange={onSshChange}
                    />
                    <SshConfigSection
                        adapter={adapter}
                        sshAuthType={sshAuthType}
                        sshCredentialId={sshCredentialId}
                        description="SSH access to the machine this storage lives on."
                    />
                </TabsContent>
            )}

            <TabsContent value="connection" className="space-y-4 pt-4">
                {isSSH && (
                    <p className="text-sm text-muted-foreground">
                        The storage as seen from the SSH host, not from DBackup.
                    </p>
                )}
                <PrimaryCredentialPickerSlot
                    adapter={adapter}
                    primaryCredentialId={primaryCredentialId}
                    onPrimaryChange={onPrimaryChange}
                    onSelectedProfile={setSelectedProfile}
                    refreshKey={credentialRefreshKey}
                />
                {(adapter.id === 'sftp' || adapter.id === 'rsync') ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="md:col-span-3">
                                <FieldList keys={['host']} adapter={adapter} />
                            </div>
                            <div className="md:col-span-1">
                                <FieldList keys={['port']} adapter={adapter} />
                            </div>
                        </div>

                        <FieldList keys={['username', 'authType']} adapter={adapter} />

                        {(!authType || authType === 'password') && (
                             <FieldList keys={['password']} adapter={adapter} />
                        )}

                        {authType === 'privateKey' && (
                             <FieldList keys={['privateKey', 'passphrase']} adapter={adapter} />
                        )}
                    </div>
                ) : isCloudDrive ? (
                    <OAuthAuthorization
                        adapterId={adapter.id}
                        credentialId={primaryCredentialId ?? undefined}
                        authorized={authorized}
                        onAuthorized={handleOAuthAuthorized}
                    />
                ) : (
                    <FieldList keys={connectionKeys} adapter={adapter} />
                )}
            </TabsContent>

            {hasConfigKeys && (
                <TabsContent value="configuration" className="space-y-4 pt-4">
                    {isCloudDrive ? (
                        <CloudFolderField
                            adapterId={adapter.id}
                            authorized={authorized}
                            credentialId={primaryCredentialId ?? undefined}
                        />
                    ) : hasRealConfigKeys ? (
                        <>
                            <FieldList keys={configKeys} adapter={adapter} />
                            {isArchivedStorageClass && (
                                <Alert className="border-orange-200 bg-orange-50 dark:bg-orange-950/30 dark:border-orange-900">
                                    <AlertTriangle className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                                    <AlertDescription className="text-orange-700 dark:text-orange-300 text-sm">
                                        <strong>{storageClass === "DEEP_ARCHIVE" ? "Deep Archive" : "Glacier"}</strong> is an archived storage class.
                                        Backups stored with this class cannot be downloaded or restored directly through DBackup.
                                        You must first restore the object via the AWS Console (S3 - select object - Actions - Initiate restore) before accessing it.
                                    </AlertDescription>
                                </Alert>
                            )}
                        </>
                    ) : null}
                    {onHealthNotificationsDisabledChange && (
                        <HealthCheckNotificationSwitch
                            type="storage"
                            disabled={healthNotificationsDisabled ?? false}
                            onChange={onHealthNotificationsDisabledChange}
                        />
                    )}
                    {/* Only for a backup destination. `metadata.skipVerification` has exactly
                        one consumer - the weekly integrity sweep over destinations - so on a
                        directory source it is a switch that controls nothing. The stored value
                        is left alone, so flipping a config's role and back does not lose it. */}
                    {onSkipVerificationChange && storageRole !== STORAGE_ROLES.SOURCE && (
                        <DisableVerificationSwitch
                            disabled={skipVerification ?? false}
                            onChange={onSkipVerificationChange}
                        />
                    )}
                    {onStorageRoleChange && (
                        <AdapterRolePicker
                            storageRole={storageRole ?? STORAGE_ROLES.DESTINATION}
                            onStorageRoleChange={onStorageRoleChange}
                            supportedRoles={adapter.supportedRoles}
                        />
                    )}
                    {/* Only for a directory source. A backup destination receives one archive
                        plus two small sidecars per run, so there is nothing to parallelise.
                        And only where there is a choice: an adapter that reads its source as
                        a single stream would otherwise show a disabled 1 next to an
                        explanation about rate limits that does not apply to it. */}
                    {storageRole === STORAGE_ROLES.SOURCE && transferConcurrencyRange(adapter.id).max > 1 && (
                        <ParallelTransfersField
                            adapterId={adapter.id}
                            value={watch("config.maxConcurrentFiles")}
                            onChange={(v) => setValue("config.maxConcurrentFiles", v, { shouldDirty: true })}
                        />
                    )}
                    {/* The mirror image of the field above, and the reason each is limited to one
                        role. Reading a directory means many files and one connection each, so
                        what matters there is how many files run at once. Writing a backup means
                        one archive, so the only parallelism left is inside that upload. */}
                    {storageRole !== STORAGE_ROLES.SOURCE && (
                        <ParallelUploadFields
                            adapterId={adapter.id}
                            concurrency={watch("config.uploadConcurrency")}
                            partSizeMb={watch("config.uploadPartSizeMb")}
                            onConcurrencyChange={(v) => setValue("config.uploadConcurrency", v, { shouldDirty: true })}
                            onPartSizeChange={(v) => setValue("config.uploadPartSizeMb", v, { shouldDirty: true })}
                        />
                    )}
                    {/* Only for a directory source: a snapshot of the place backups are
                        written to serves no purpose. */}
                    {supportsSnapshots && storageRole === STORAGE_ROLES.SOURCE && (
                        <SnapshotSwitch
                            enabled={!!watch("config.useVss")}
                            onChange={(on) => setValue("config.useVss", on, { shouldDirty: true })}
                            adapterId={adapter.id}
                            getConfig={() => ({
                                config: (getValues("config") ?? {}) as Record<string, unknown>,
                                primaryCredentialId: primaryCredentialId ?? null,
                                sshCredentialId: sshCredentialId ?? null,
                            })}
                        />
                    )}
                    {hasAdvancedKeys && <AdvancedSettings adapter={adapter} keys={STORAGE_ADVANCED_KEYS} />}
                </TabsContent>
            )}
        </Tabs>
    );
}

export function NotificationFormContent({
    adapter,
    primaryCredentialId,
    onPrimaryChange,
}: { adapter: AdapterDefinition } & CredentialPickerHostProps) {
    const hasConfigKeys = hasFields(adapter, NOTIFICATION_CONFIG_KEYS);
    const isEmail = adapter.id === "email";
    // Filter out 'to' from config keys for email - rendered separately as TagInput
    const configKeys = isEmail
        ? NOTIFICATION_CONFIG_KEYS.filter((k) => k !== "to")
        : NOTIFICATION_CONFIG_KEYS;

    return (
        <Tabs defaultValue="connection" className="w-full">
            <TabsList className={cn("grid w-full", hasConfigKeys ? "grid-cols-2" : "grid-cols-1")}>
                <TabsTrigger value="connection">Connection</TabsTrigger>
                {hasConfigKeys && (
                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                )}
            </TabsList>

            <TabsContent value="connection" className="space-y-4 pt-4">
                <PrimaryCredentialPickerSlot
                    adapter={adapter}
                    primaryCredentialId={primaryCredentialId}
                    onPrimaryChange={onPrimaryChange}
                />
                <FieldList keys={NOTIFICATION_CONNECTION_KEYS} adapter={adapter} />
            </TabsContent>

            {hasConfigKeys && (
                <TabsContent value="configuration" className="space-y-4 pt-4">
                    <FieldList keys={configKeys} adapter={adapter} />
                    {isEmail && <EmailTagField />}
                </TabsContent>
            )}
        </Tabs>
    );
}

// --- Helpers ---

function FieldList({
    keys,
    adapter,
    isDatabase = false,
    availableDatabases = [],
    isLoadingDbs = false,
    onLoadDbs,
    isDbListOpen,
    setIsDbListOpen,
    sshCredentialId,
}: {
    keys: string[];
    adapter: AdapterDefinition;
    isDatabase?: boolean;
    availableDatabases?: string[];
    isLoadingDbs?: boolean;
    onLoadDbs?: () => void;
    isDbListOpen?: boolean;
    setIsDbListOpen?: (open: boolean) => void;
    sshCredentialId?: string | null;
}) {
    // Hide fields whose values are now sourced from a referenced credential profile.
    const hidden = getCredentialManagedKeys(adapter);

    return (
        <>
            {keys.map((key) => {
                if (hidden.has(key)) return null;
                if (!((adapter.configSchema as any).shape[key])) return null;
                const shape = (adapter.configSchema as any).shape[key];

                return (
                    <SchemaField
                        key={key}
                        name={`config.${key}`}
                        fieldKey={key}
                        schemaShape={shape}
                        adapterId={adapter.id}
                        isDatabaseField={key === 'database' && isDatabase}
                        availableDatabases={availableDatabases}
                        isLoadingDbs={isLoadingDbs}
                        onLoadDbs={onLoadDbs}
                        isDbListOpen={isDbListOpen}
                        setIsDbListOpen={setIsDbListOpen}
                        sshCredentialId={sshCredentialId}
                    />
                );
            })}
        </>
    );
}

/**
 * Returns the set of config keys that are now managed via a credential
 * profile reference and should therefore be hidden from the rendered form.
 *
 * Mirrors the overlay logic in `applyPrimaryOverlay` / `applySshOverlay`.
 */
function getCredentialManagedKeys(adapter: AdapterDefinition): Set<string> {
    const hidden = new Set<string>();
    const reqs = adapter.credentials;
    if (!reqs) return hidden;

    if (reqs.primary === "USERNAME_PASSWORD") {
        ["user", "username", "password"].forEach((k) => hidden.add(k));
    } else if (reqs.primary === "SSH_KEY") {
        // SFTP/Rsync: unprefixed identity fields
        ["username", "authType", "password", "privateKey", "passphrase"].forEach((k) =>
            hidden.add(k)
        );
    } else if (reqs.primary === "ACCESS_KEY") {
        ["accessKeyId", "secretAccessKey"].forEach((k) => hidden.add(k));
    } else if (reqs.primary === "TOKEN") {
        ["token", "appToken", "accessToken", "botToken", "authToken"].forEach((k) => hidden.add(k));
    } else if (reqs.primary === "SMTP") {
        ["user", "password"].forEach((k) => hidden.add(k));
    } else if (reqs.primary === "WEBHOOK") {
        ["webhookUrl", "url", "authHeader"].forEach((k) => hidden.add(k));
    } else if (reqs.primary === "OAUTH") {
        // The whole OAuth-app identity lives in the vault profile.
        ["clientId", "clientSecret", "refreshToken"].forEach((k) => hidden.add(k));
    }

    if (reqs.ssh === "SSH_KEY") {
        // Which names the profile owns is a property of the schema, not of whether the
        // adapter also has a primary slot. The same list drives the overlay that writes
        // them, so the form cannot hide one set while the resolver fills another.
        sshManagedKeys(adapter.configSchema as never).forEach((k) => hidden.add(k));
    }

    return hidden;
}

function hasFields(adapter: AdapterDefinition, keys: string[]) {
    const shape = (adapter.configSchema as any).shape;
    return keys.some(key => key in shape);
}
