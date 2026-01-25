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
        return (
            <div className="space-y-4 pt-4">
                 {detectedVersion && (
                    <div className="mb-4">
                        <Badge variant="outline" className="bg-green-500/10 text-green-600 border-green-500/20">
                            <Check className="w-3 h-3 mr-1" />
                            Detected: {detectedVersion}
                        </Badge>
                    </div>
                )}

                <div className="border p-4 rounded-md bg-muted/30 mb-4">
                    <h4 className="text-sm font-medium mb-3">Connection Mode</h4>
                    <FieldList keys={['mode']} adapter={adapter} />
                </div>

                <div className="space-y-4">
                    <FieldList keys={['path', 'sqliteBinaryPath']} adapter={adapter} />
                </div>

                {mode === 'ssh' && (
                    <div className="border-t pt-4 mt-4 space-y-4">
                         <h4 className="text-sm font-medium">SSH Connection</h4>
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
}: { adapter: AdapterDefinition }) {
    const hasConfigKeys = hasFields(adapter, STORAGE_CONFIG_KEYS);

    return (
        <Tabs defaultValue="connection" className="w-full">
            <TabsList className={cn("grid w-full", hasConfigKeys ? "grid-cols-2" : "grid-cols-1")}>
                <TabsTrigger value="connection">Connection</TabsTrigger>
                {hasConfigKeys && (
                    <TabsTrigger value="configuration">Configuration</TabsTrigger>
                )}
            </TabsList>

            <TabsContent value="connection" className="space-y-4 pt-4">
                {adapter.id === 'sftp' ? (
                    <div className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                            <div className="md:col-span-3">
                                <FieldList keys={['host']} adapter={adapter} />
                            </div>
                            <div className="md:col-span-1">
                                <FieldList keys={['port']} adapter={adapter} />
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <FieldList keys={['username']} adapter={adapter} />
                            <FieldList keys={['password']} adapter={adapter} />
                        </div>

                        <FieldList keys={['privateKey', 'passphrase']} adapter={adapter} />
                    </div>
                ) : (
                    <FieldList keys={STORAGE_CONNECTION_KEYS} adapter={adapter} />
                )}
            </TabsContent>

            {hasConfigKeys && (
                <TabsContent value="configuration" className="space-y-4 pt-4">
                    <FieldList keys={STORAGE_CONFIG_KEYS} adapter={adapter} />
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
