"use client";

import { useFormContext } from "react-hook-form";
import { z } from "zod";
import { Info } from "lucide-react";
import {
    FormControl,
    FormDescription,
    FormField,
    FormItem,
    FormLabel,
    FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { FolderOpen } from "lucide-react";
import { PLACEHOLDERS } from "./form-constants";
import { useSecretStatus } from "./secret-status-context";
import { DatabasePicker } from "./database-picker";
import { FileBrowserDialog } from "@/components/system/file-browser-dialog";
import { SQLITE_FILES } from "@/components/system/file-browser-model";
import { nounOf } from "@/lib/utils";
import { useState } from "react";

interface SchemaFieldProps {
    name: string;
    fieldKey: string;
    schemaShape: z.ZodTypeAny;
    adapterId: string;
    isDatabaseField?: boolean;
    availableDatabases?: string[];
    isLoadingDbs?: boolean;
    onLoadDbs?: () => void;
    isDbListOpen?: boolean;
    setIsDbListOpen?: (open: boolean) => void;
    sshCredentialId?: string | null;
    /** Replaces the label made from the key, for a form that names the field better. */
    label?: string;
    /** Replaces the schema's own description. */
    description?: string;
    /** Shows the description under the field instead of behind an info icon. */
    descriptionBelow?: boolean;
}

export function SchemaField({
    name,
    fieldKey,
    schemaShape,
    adapterId,
    isDatabaseField,
    availableDatabases = [],
    isLoadingDbs = false,
    onLoadDbs,
    isDbListOpen = false,
    setIsDbListOpen,
    sshCredentialId,
    label: labelOverride,
    description: descriptionOverride,
    descriptionBelow = false,
}: SchemaFieldProps) {
    const { control } = useFormContext();

    let unwrappedShape = schemaShape;
    while (
       unwrappedShape instanceof z.ZodOptional ||
       unwrappedShape instanceof z.ZodNullable ||
       unwrappedShape instanceof z.ZodDefault ||
       (unwrappedShape as any)._def?.typeName === "ZodDefault" ||
       (unwrappedShape as any)._def?.typeName === "ZodOptional"
    ) {
        unwrappedShape = (unwrappedShape as any)._def.innerType;
    }

    let label = fieldKey.charAt(0).toUpperCase() + fieldKey.slice(1);
    label = label.replace(/([A-Z])/g, ' $1').trim();
    if (fieldKey === 'disableSsl') label = "Disable SSL";
    if (fieldKey === 'uri') label = "URI";
    if (fieldKey === 'tls') label = "Encryption";
    if (fieldKey === 'trustServerCertificate') label = "Trust Server Certificate";
    if (fieldKey === 'backupPath') label = "Backup Path (Server)";
    if (fieldKey === 'localBackupPath') label = "Backup Path (Local)";
    if (fieldKey === 'fileTransferMode') label = "File Transfer Mode";
    if (fieldKey === 'requestTimeout') label = "Request Timeout (ms)";
    if (fieldKey === 'sshHost') label = "SSH Host";
    if (fieldKey === 'sshPort') label = "SSH Port";
    if (fieldKey === 'sshUsername') label = "SSH Username";
    if (fieldKey === 'sshAuthType') label = "SSH Auth Method";
    if (fieldKey === 'sshPassword') label = "SSH Password";
    if (fieldKey === 'sshPrivateKey') label = "SSH Private Key";
    if (fieldKey === 'sshPassphrase') label = "SSH Key Passphrase";
    if (fieldKey === 'jurisdiction') label = "Bucket Jurisdiction";
    if (labelOverride) label = labelOverride;

    const isBoolean = unwrappedShape instanceof z.ZodBoolean || (unwrappedShape as any)._def?.typeName === "ZodBoolean";
    const isEnum = unwrappedShape instanceof z.ZodEnum || (unwrappedShape as any)._def?.typeName === "ZodEnum";
    const isPassword = fieldKey.toLowerCase().includes("password") || fieldKey.toLowerCase().includes("secret");
    const isTextArea = fieldKey.toLowerCase().includes("privatekey") || fieldKey.toLowerCase().includes("certificate") || fieldKey.toLowerCase().includes("options") || fieldKey === "customHeaders" || fieldKey === "payloadTemplate";
    const schemaDescription: string | undefined = descriptionOverride ?? (schemaShape as any).description;
    // A description that only repeats the label, like "SSH host", says nothing new.
    const description = schemaDescription && schemaDescription.toLowerCase() !== label.toLowerCase() ? schemaDescription : undefined;
    const tooltip = description && !descriptionBelow ? description : undefined;

    const rawPlaceholder = PLACEHOLDERS[`${adapterId}.${fieldKey}`] || PLACEHOLDERS[fieldKey];

    // When editing, the API redacts stored secrets (the value is never sent).
    // `secretStatus[fieldKey]` tells us a value IS stored, so show a "leave blank
    // to keep" hint instead of an empty-looking field. Submitting it blank keeps
    // the existing secret (server-side mergeSecrets); typing replaces it.
    const secretStatus = useSecretStatus();
    const hasStoredSecret = secretStatus[fieldKey] === true;
    const placeholder = hasStoredSecret ? "•••••••• saved, leave blank to keep" : rawPlaceholder;

    const isPathField = fieldKey === 'path' || fieldKey === 'sqliteBinaryPath' || fieldKey === 'basePath';
    const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);

    // Get current form values for checking remote mode
    const { watch } = useFormContext();
    const currentMode = watch("config.mode");

    // Prepare remote config if needed
    let remoteConfig = null;
    if (adapterId === "sqlite" && currentMode === "ssh") {
        remoteConfig = watch("config");
    }
    // Future: Add SFTP check here if consistent pattern used

    // A backup folder is a directory, the SQLite database and its binary are files.
    const selectionType = fieldKey === 'basePath' ? 'directory' : 'file';
    const browseNoun = nounOf(label);

    return (
        <FormField
            control={control}
            name={name}
            render={({ field }) => (
                <FormItem className={isBoolean ? "flex flex-row items-center justify-between rounded-lg border p-3 shadow-sm" : ""}>
                   {isBoolean ? (
                       <div className="space-y-0.5">
                           <FormLabel>{label}</FormLabel>
                           {description && <FormDescription>{description}</FormDescription>}
                       </div>
                   ) : (
                       <div className="flex items-center gap-1.5">
                           <FormLabel>{label}</FormLabel>
                           {tooltip && (
                               <TooltipProvider>
                                   <Tooltip delayDuration={300}>
                                       <TooltipTrigger asChild>
                                           <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-foreground transition-colors cursor-help" />
                                       </TooltipTrigger>
                                       <TooltipContent side="right">
                                           <p className="max-w-75 text-xs">{tooltip}</p>
                                       </TooltipContent>
                                   </Tooltip>
                               </TooltipProvider>
                           )}
                       </div>
                   )}
                   {/* FormControl sits on the control itself, never on a wrapper around it. It hands
                       over the id the label points at, and a label pointing at a div names nothing. */}
                        {isBoolean ? (
                            <FormControl>
                                <Switch
                                    checked={field.value}
                                    onCheckedChange={field.onChange}
                                />
                            </FormControl>
                        ) : isDatabaseField && onLoadDbs && setIsDbListOpen ? (
                            <FormControl>
                                <DatabasePicker
                                    value={field.value}
                                    onChange={field.onChange}
                                    availableDatabases={availableDatabases}
                                    isLoading={isLoadingDbs}
                                    onLoad={onLoadDbs}
                                    isOpen={isDbListOpen}
                                    setIsOpen={setIsDbListOpen}
                                />
                            </FormControl>
                        ) : isEnum ? (
                            <Select
                                onValueChange={field.onChange}
                                defaultValue={field.value}
                                value={field.value}
                            >
                                <FormControl>
                                    <SelectTrigger>
                                        <SelectValue placeholder="Select..." />
                                    </SelectTrigger>
                                </FormControl>
                                <SelectContent>
                                    {((unwrappedShape as any).options || (unwrappedShape as any)._def?.values || []).map((val: string) => (
                                        <SelectItem key={val} value={val} className="capitalize">
                                            {val === "none" ? "None (Insecure)" : val === "ssl" ? "SSL / TLS" : val === "starttls" ? "STARTTLS" : val === "ssh" ? (
                                                <span className="inline-flex items-center gap-2">SSH <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold leading-none text-primary">Beta</span></span>
                                            ) : val}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : isTextArea ? (
                            <FormControl>
                                <Textarea
                                    {...field}
                                    placeholder={placeholder}
                                    value={field.value || ""}
                                    className="font-mono text-xs min-h-25"
                                    onChange={(e) => field.onChange(e.target.value)}
                                />
                            </FormControl>
                        ) : (
                             <div className="flex gap-2">
                                <FormControl>
                                    <Input
                                        type={isPassword ? "password" : "text"}
                                        {...field}
                                        placeholder={placeholder}
                                        value={field.value || ""}
                                        onChange={(e) => {
                                            const val = e.target.value;
                                            if (unwrappedShape instanceof z.ZodNumber || (unwrappedShape as any)._def?.typeName === "ZodNumber") {
                                                field.onChange(Number(val));
                                            } else {
                                                field.onChange(val);
                                            }
                                        }}
                                    />
                                </FormControl>
                                {isPathField && (
                                    <>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setIsFileBrowserOpen(true)}
                                            title={`Pick the ${browseNoun}`}
                                            aria-label={`Pick the ${browseNoun}`}
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                        </Button>
                                        <FileBrowserDialog
                                            open={isFileBrowserOpen}
                                            onOpenChange={setIsFileBrowserOpen}
                                            onSelect={(path) => field.onChange(path)}
                                            initialPath={field.value && field.value.startsWith('/') ? field.value : '/'}
                                            selectionType={selectionType}
                                            title={`Pick the ${browseNoun}`}
                                            accept={adapterId === "sqlite" && fieldKey === "path" ? SQLITE_FILES : undefined}
                                            remoteConfig={remoteConfig}
                                            remoteAdapterId={remoteConfig ? adapterId : undefined}
                                            remoteSshCredentialId={remoteConfig ? sshCredentialId : undefined}
                                        />
                                    </>
                                )}
                             </div>
                        )}
                   {!isBoolean && description && descriptionBelow && (
                       <FormDescription className="text-xs">{description}</FormDescription>
                   )}
                   <FormMessage />
                </FormItem>
            )}
        />
    );
}
