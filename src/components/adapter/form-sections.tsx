import { useFormContext } from "react-hook-form";
import {
    Tabs,
    TabsContent,
    TabsList,
    TabsTrigger,
} from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Check } from "lucide-react";
import { AdapterDefinition } from "@/lib/adapters/definitions";
import { SchemaField } from "./schema-field";
import { STORAGE_CONFIG_KEYS, STORAGE_CONNECTION_KEYS } from "./form-constants";
import { GoogleDriveOAuthButton } from "./google-drive-oauth-button";
import { AdapterConfig } from "./types";

interface SectionProps {
    adapter: AdapterDefinition;
    detectedVersion?: string | null;
    availableDatabases: string[];
    isLoadingDbs: boolean;
    onLoadDbs: () => void;
    isDbListOpen: boolean;
    setIsDbListOpen: (open: boolean) => void;
}

export function DatabaseFormContent({
    adapter,
    detectedVersion,
    availableDatabases,
    isLoadingDbs,
    onLoadDbs,
    isDbListOpen,
    setIsDbListOpen
}: SectionProps) {
    const { watch } = useFormContext();
    const mode = watch("config.mode");
    const authType = watch("config.authType");

    if (adapter.id === "sqlite") {
        if (!mode) return null;

        return (
            <div className="space-y-4 pt-2">
                 {detectedVersion && (
                    <div className="flex justify-end mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                 )}

                 {mode === 'local' ? (
                     <div className="space-y-4 border p-4 rounded-md bg-muted/10">
                         <div className="space-y-4">
                            <FieldList keys={['path']} adapter={adapter} />
                            {/* sqliteBinaryPath hidden for local mode as requested */}
                         </div>
                     </div>
                 ) : (
                    <Tabs defaultValue="connection" className="w-full pt-2">
                        <TabsList className="grid w-full grid-cols-2">
                            <TabsTrigger value="connection">SSH Connection</TabsTrigger>
                            <TabsTrigger value="configuration">Configuration</TabsTrigger>
                        </TabsList>

                        <TabsContent value="connection" className="space-y-4 pt-4 border p-4 rounded-md bg-muted/10 mt-2">
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
                        </TabsContent>

                        <TabsContent value="configuration" className="space-y-4 pt-4 mt-2">
                             <div className="space-y-4">
                                <FieldList keys={['path']} adapter={adapter} />
                                <FieldList keys={['sqliteBinaryPath']} adapter={adapter} />
                             </div>
                        </TabsContent>
                    </Tabs>
                 )}
            </div>
        );
    }

    return (
        <Tabs defaultValue="connection" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="connection">Connection</TabsTrigger>
                <TabsTrigger value="configuration">Configuration</TabsTrigger>
            </TabsList>

            <TabsContent value="connection" className="space-y-4 pt-4">
                {detectedVersion && (
                    <div className="mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                )}
                <FieldList
                    keys={['uri', 'host', 'port', 'user', 'password']}
                    adapter={adapter}
                    isDatabase={true}
                    availableDatabases={availableDatabases}
                    isLoadingDbs={isLoadingDbs}
                    onLoadDbs={onLoadDbs}
                    isDbListOpen={isDbListOpen}
                    setIsDbListOpen={setIsDbListOpen}
                />
            </TabsContent>

            <TabsContent value="configuration" className="space-y-4 pt-4">
                {detectedVersion && (
                    <div className="mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                )}
                <FieldList
                    keys={['database', 'authenticationDatabase', 'options', 'disableSsl']}
                    adapter={adapter}
                    isDatabase={true}
                    availableDatabases={availableDatabases}
                    isLoadingDbs={isLoadingDbs}
                    onLoadDbs={onLoadDbs}
                    isDbListOpen={isDbListOpen}
                    setIsDbListOpen={setIsDbListOpen}
                />
            </TabsContent>
        </Tabs>
    );
}

export function StorageFormContent({
    adapter,
    initialData,
}: { adapter: AdapterDefinition; initialData?: AdapterConfig }) {
    const { watch } = useFormContext();
    const authType = watch("config.authType");
    const hasConfigKeys = hasFields(adapter, STORAGE_CONFIG_KEYS);
    const isGoogleDrive = adapter.id === 'google-drive';

    // For Google Drive: filter out refreshToken from connection keys (auto-managed via OAuth)
    const connectionKeys = isGoogleDrive
        ? STORAGE_CONNECTION_KEYS.filter(k => k !== 'refreshToken')
        : STORAGE_CONNECTION_KEYS;

    // For Google Drive: filter out refreshToken from config keys too
    const configKeys = isGoogleDrive
        ? STORAGE_CONFIG_KEYS.filter(k => k !== 'refreshToken')
        : STORAGE_CONFIG_KEYS;

    // Check if the config has a refresh token (for existing/authorized adapters)
    const hasRefreshToken = initialData ? (() => {
        try {
            const config = JSON.parse(initialData.config);
            return !!config.refreshToken;
        } catch {
            return false;
        }
    })() : false;

    return (
        <Tabs defaultValue="connection" className="w-full">
            <TabsList className={cn("grid w-full", hasConfigKeys ? "grid-cols-2" : "grid-cols-1")}>
                <TabsTrigger value="connection">Connection</TabsTrigger>
                {hasConfigKeys && (
                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                )}
            </TabsList>

            <TabsContent value="connection" className="space-y-4 pt-4">
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
                ) : isGoogleDrive ? (
                    <div className="space-y-4">
                        <FieldList keys={['clientId', 'clientSecret']} adapter={adapter} />
                        <GoogleDriveOAuthButton
                            adapterId={initialData?.id}
                            hasRefreshToken={hasRefreshToken}
                        />
                    </div>
                ) : (
                    <FieldList keys={connectionKeys} adapter={adapter} />
                )}
            </TabsContent>

            {hasConfigKeys && (
                <TabsContent value="configuration" className="space-y-4 pt-4">
                    <FieldList keys={configKeys} adapter={adapter} />
                </TabsContent>
            )}
        </Tabs>
    );
}

export function GenericFormContent({ adapter, detectedVersion }: { adapter: AdapterDefinition, detectedVersion?: string | null }) {
    return (
        <div className="space-y-4 border p-4 rounded-md bg-muted/30">
            <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium">Configuration</h4>
                {detectedVersion && (
                    <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                        <Check className="w-3 h-3 mr-1" />
                        Detected: {detectedVersion}
                    </Badge>
                )}
            </div>
            <FieldList keys={Object.keys((adapter.configSchema as any).shape)} adapter={adapter} />
        </div>
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
    setIsDbListOpen
}: {
    keys: string[];
    adapter: AdapterDefinition;
    isDatabase?: boolean;
    availableDatabases?: string[];
    isLoadingDbs?: boolean;
    onLoadDbs?: () => void;
    isDbListOpen?: boolean;
    setIsDbListOpen?: (open: boolean) => void;
}) {
    return (
        <>
            {keys.map((key) => {
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
                    />
                );
            })}
        </>
    );
}

function hasFields(adapter: AdapterDefinition, keys: string[]) {
    const shape = (adapter.configSchema as any).shape;
    return keys.some(key => key in shape);
}
