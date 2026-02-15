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
import { DatabasePicker } from "./database-picker";
import { FileBrowserDialog } from "@/components/system/file-browser-dialog";
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

    const isBoolean = unwrappedShape instanceof z.ZodBoolean || (unwrappedShape as any)._def?.typeName === "ZodBoolean";
    const isEnum = unwrappedShape instanceof z.ZodEnum || (unwrappedShape as any)._def?.typeName === "ZodEnum";
    const isPassword = fieldKey.toLowerCase().includes("password") || fieldKey.toLowerCase().includes("secret");
    const isTextArea = fieldKey.toLowerCase().includes("privatekey") || fieldKey.toLowerCase().includes("certificate") || fieldKey.toLowerCase().includes("options");
    const description = (schemaShape as any).description;

    const placeholder = PLACEHOLDERS[`${adapterId}.${fieldKey}`] || PLACEHOLDERS[fieldKey];

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

    // Determine default selection type for file browser
    const selectionType = fieldKey === 'basePath' ? 'directory' : 'all';

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
                           {description && (
                               <TooltipProvider>
                                   <Tooltip delayDuration={300}>
                                       <TooltipTrigger asChild>
                                           <Info className="h-3.5 w-3.5 text-muted-foreground/70 hover:text-foreground transition-colors cursor-help" />
                                       </TooltipTrigger>
                                       <TooltipContent side="right">
                                           <p className="max-w-75 text-xs">{description}</p>
                                       </TooltipContent>
                                   </Tooltip>
                               </TooltipProvider>
                           )}
                       </div>
                   )}
                   <FormControl>
                        {isBoolean ? (
                            <Switch
                                checked={field.value}
                                onCheckedChange={field.onChange}
                            />
                        ) : isDatabaseField && onLoadDbs && setIsDbListOpen ? (
                            <DatabasePicker
                                value={field.value}
                                onChange={field.onChange}
                                availableDatabases={availableDatabases}
                                isLoading={isLoadingDbs}
                                onLoad={onLoadDbs}
                                isOpen={isDbListOpen}
                                setIsOpen={setIsDbListOpen}
                            />
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
                                            {val === "none" ? "None (Insecure)" : val === "ssl" ? "SSL / TLS" : val === "starttls" ? "STARTTLS" : val === "ssh" ? "SSH" : val}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        ) : isTextArea ? (
                            <Textarea
                                {...field}
                                placeholder={placeholder}
                                value={field.value || ""}
                                className="font-mono text-xs min-h-25"
                                onChange={(e) => field.onChange(e.target.value)}
                            />
                        ) : (
                             <div className="flex gap-2">
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
                                {isPathField && (
                                    <>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="icon"
                                            onClick={() => setIsFileBrowserOpen(true)}
                                            title="Browse Server Files"
                                        >
                                            <FolderOpen className="h-4 w-4" />
                                        </Button>
                                        <FileBrowserDialog
                                            open={isFileBrowserOpen}
                                            onOpenChange={setIsFileBrowserOpen}
                                            onSelect={(path) => field.onChange(path)}
                                            initialPath={field.value && field.value.startsWith('/') ? field.value : '/'}
                                            selectionType={selectionType}
                                            title={remoteConfig ? `Select Remote ${label}` : `Select Local ${label}`}
                                            remoteConfig={remoteConfig}
                                        />
                                    </>
                                )}
                             </div>
                        )}
                   </FormControl>
                   <FormMessage />
                </FormItem>
            )}
        />
    );
}
