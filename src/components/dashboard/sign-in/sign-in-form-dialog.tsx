"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { checkSsoConnection, createSsoProvider, updateSsoProvider } from "@/app/actions/auth/oidc";
import { SwitchList, SwitchRow } from "@/components/adapter/setting-switches";
import { NO_GROUP } from "@/components/dashboard/users/user-columns";
import { GroupPicker } from "@/components/dashboard/users/user-group-picker";
import { Button } from "@/components/ui/button";
import { DIALOG_FOOTER, DIALOG_SURFACE, DialogHead, dialogNoteClass } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { cn } from "@/lib/utils";
import { callbackUrl, type SsoProvidersModel } from "@/services/sso/sso-providers-types";
import { adapterCopy, GENERIC_ADAPTER } from "./sign-in-adapters";
import { FoundMark, OptionalMark, ProviderField, SavedSecretField } from "./sign-in-fields";
import { changedFrom, configOf, groupIdOf, initialValues, problemOf, type SignInFormMode, type SignInProblem, type SignInValues } from "./sign-in-form-values";
import { SetupBox } from "./sign-in-parts";
import { SignInStart } from "./sign-in-start";

const log = logger.child({ component: "sign-in-form-dialog" });

interface SignInFormDialogProps {
    open: boolean;
    mode: SignInFormMode;
    model: SsoProvidersModel;
    onOpenChange: (open: boolean) => void;
    onSaved: () => void;
}

/**
 * New provider and Edit. New provider starts with the choice of the provider as step 1 of 2, and
 * both end in the same form: its fields on the left, what happens to new people and what to set up
 * in the provider on the right. Edit never shows the client secret, only Replace.
 */
export function SignInFormDialog({ open, mode, model, onOpenChange, onSaved }: SignInFormDialogProps) {
    const [adapterId, setAdapterId] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) setAdapterId(null);
    }, [open]);

    const editing = mode.kind === "edit";
    const picked = editing ? mode.provider.adapterId : adapterId;

    return (
        <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
            <DialogContent tone={editing ? "edit" : "create"} showCloseButton={false} className={cn(DIALOG_SURFACE, picked ? "sm:max-w-4xl" : "sm:max-w-2xl")}>
                {picked ? (
                    <Editor
                        key={editing ? `edit-${mode.provider.id}` : `new-${picked}`}
                        mode={mode}
                        adapterId={picked}
                        model={model}
                        onBack={editing ? undefined : () => setAdapterId(null)}
                        onClose={() => onOpenChange(false)}
                        onSavingChange={setSaving}
                        onSaved={onSaved}
                    />
                ) : (
                    <SignInStart adapters={model.adapters} onPick={setAdapterId} />
                )}
            </DialogContent>
        </Dialog>
    );
}

interface EditorProps {
    mode: SignInFormMode;
    adapterId: string;
    model: SsoProvidersModel;
    onBack?: () => void;
    onClose: () => void;
    onSavingChange: (saving: boolean) => void;
    onSaved: () => void;
}

type UrlCheck = { key: string; state: "checking" | "found" | "failed"; error?: string } | null;

/** The fields of a provider, what happens to new people, and what to set up in the provider. */
function Editor({ mode, adapterId, model, onBack, onClose, onSavingChange, onSaved }: EditorProps) {
    const provider = mode.kind === "edit" ? mode.provider : null;
    const copy = adapterCopy(adapterId);
    const inputs = useMemo(() => model.adapters.find((adapter) => adapter.id === adapterId)?.inputs ?? [], [model, adapterId]);
    const [initial] = useState(() => initialValues(mode, adapterId, inputs, model));
    const [values, setValues] = useState<SignInValues>(initial);
    const [problem, setProblem] = useState<SignInProblem | null>(null);
    const [check, setCheck] = useState<UrlCheck>(null);
    const [saving, setSaving] = useState(false);
    const latest = useRef("");
    const groupFieldId = useId();

    const takenIds = useMemo(() => model.providers.filter((entry) => entry.id !== provider?.id).map((entry) => entry.providerId), [model, provider]);
    const groups = model.manage?.groups ?? [];

    const set = <K extends keyof SignInValues>(key: K, value: SignInValues[K]) => {
        setValues((current) => ({ ...current, [key]: value }));
        setProblem(null);
    };
    const setConfig = (name: string, value: string) => {
        setValues((current) => ({ ...current, config: { ...current.config, [name]: value } }));
        setProblem(null);
    };
    const errorOf = (field: string) => (problem?.field === field ? problem.message : null);

    // A provider that is read from its URL is checked as soon as its fields are filled in.
    const checkUrl = async () => {
        if (adapterId === GENERIC_ADAPTER || inputs.some((input) => input.required && !values.config[input.name]?.trim())) return;
        const adapterConfig = configOf(values, inputs);
        const key = JSON.stringify(adapterConfig);
        if (check?.key === key) return;
        latest.current = key;
        setCheck({ key, state: "checking" });
        try {
            const result = await checkSsoConnection({ adapterId, adapterConfig });
            if (latest.current !== key) return;
            setCheck(result.success ? { key, state: "found" } : { key, state: "failed", error: result.error || "The provider could not be reached." });
        } catch (error) {
            log.warn("Checking the URL of a sign-in provider failed", { adapterId }, wrapError(error));
            if (latest.current === key) setCheck({ key, state: "failed", error: "The provider could not be checked." });
        }
    };

    const busy = (next: boolean) => {
        setSaving(next);
        onSavingChange(next);
    };

    const unchanged = provider !== null && !changedFrom(initial, values);
    const submit = async (event: React.FormEvent) => {
        event.preventDefault();
        const found = problemOf(values, mode, inputs, takenIds);
        if (found) return setProblem(found);
        if (unchanged) return onClose();

        const name = values.name.trim();
        const fields = {
            name,
            domain: values.domain.trim(),
            clientId: values.clientId.trim(),
            allowProvisioning: values.allowProvisioning,
            defaultGroupId: groupIdOf(values.groupId),
            adapterConfig: configOf(values, inputs),
        };
        busy(true);
        try {
            const result = provider
                ? await updateSsoProvider({ ...fields, id: provider.id, clientSecret: values.replaceSecret ? values.clientSecret : undefined })
                : await createSsoProvider({ ...fields, adapterId, providerId: values.providerId.trim(), clientSecret: values.clientSecret });
            busy(false);
            if (!result.success) {
                toast.error(result.error || "The provider could not be saved.");
                return;
            }
            toast.success(provider ? `${name} saved` : `${name} added`);
            onSaved();
            onClose();
        } catch (error) {
            // Without the right to change the settings the actions throw instead of answering.
            log.warn("Saving a sign-in provider failed", { adapterId }, wrapError(error));
            toast.error("The provider could not be saved.");
            busy(false);
        }
    };

    const tone = provider ? "edit" : "create";
    const firstUrl = inputs.find((input) => input.type === "url")?.name;
    const noGroup = values.groupId === NO_GROUP;

    return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
            <DialogHead
                tone={tone}
                icon={provider ? Pencil : Plus}
                action={onBack && (
                    <Button type="button" variant="outline" size="sm" onClick={onBack} disabled={saving}>
                        Change provider
                    </Button>
                )}
            >
                <DialogTitle className="truncate text-base">{provider ? `Edit ${provider.name}` : "New sign-in provider"}</DialogTitle>
                <DialogDescription className={dialogNoteClass(tone)}>
                    {provider ? "A change applies to the next sign-in" : `${copy.name}, the fields it needs and what to set up there`}
                </DialogDescription>
            </DialogHead>

            <ScrollArea className="min-h-0 flex-1 *:data-[slot=scroll-area-viewport]:max-h-[calc(95dvh-9.5rem)]">
                <div className="grid min-w-0 gap-6 p-5 md:grid-cols-2">
                    <div className="min-w-0 space-y-4">
                        <ProviderField label="Name" value={values.name} onChange={(value) => set("name", value)} error={errorOf("name")} placeholder="Like Company login" />
                        {!provider && (
                            <ProviderField
                                label="Provider ID"
                                value={values.providerId}
                                onChange={(value) => set("providerId", value.toLowerCase())}
                                error={errorOf("providerId")}
                                mono
                                description="The end of the callback URL, it stays once the provider is saved."
                            />
                        )}
                        {inputs.map((input) => (
                            <ProviderField
                                key={input.name}
                                label={input.label}
                                value={values.config[input.name] ?? ""}
                                onChange={(value) => setConfig(input.name, value)}
                                onBlur={() => void checkUrl()}
                                type={input.type === "url" ? "url" : "text"}
                                mono={input.type !== "url"}
                                secret={input.type === "password"}
                                placeholder={input.placeholder}
                                aside={input.name === firstUrl && adapterId !== GENERIC_ADAPTER ? <FoundMark state={check?.state ?? null} /> : !input.required ? <OptionalMark /> : undefined}
                                error={errorOf(`config.${input.name}`) ?? (input.name === firstUrl && check?.state === "failed" ? check.error : null)}
                                description={input.name === firstUrl && check?.state === "found" ? "Its OpenID configuration was read, the endpoints come from there." : input.description}
                            />
                        ))}
                        <ProviderField label="Client ID" value={values.clientId} onChange={(value) => set("clientId", value)} error={errorOf("clientId")} mono />
                        {provider ? (
                            <SavedSecretField
                                replacing={values.replaceSecret}
                                value={values.clientSecret}
                                onReplace={(replacing) => setValues((current) => ({ ...current, replaceSecret: replacing, clientSecret: "" }))}
                                onChange={(value) => set("clientSecret", value)}
                                error={errorOf("clientSecret")}
                            />
                        ) : (
                            <ProviderField label="Client secret" value={values.clientSecret} onChange={(value) => set("clientSecret", value)} error={errorOf("clientSecret")} secret />
                        )}
                        <ProviderField
                            label="Email domain"
                            value={values.domain}
                            onChange={(value) => set("domain", value)}
                            placeholder="example.com"
                            aside={<OptionalMark />}
                            description="Someone who types an email of this domain on the login page goes straight to this provider."
                        />
                    </div>

                    <div className="min-w-0 space-y-4">
                        <SwitchList>
                            <SwitchRow
                                title="Add new people on their first sign-in"
                                description={`Without it only people with an account in DBackup of the same email sign in through ${copy.name}.`}
                                checked={values.allowProvisioning}
                                onCheckedChange={(checked) => set("allowProvisioning", checked)}
                            />
                        </SwitchList>
                        {values.allowProvisioning && (
                            <div className="space-y-2">
                                <Label htmlFor={groupFieldId}>Group of new people</Label>
                                {/* Only a SuperAdmin changes providers, so every group can be picked. */}
                                <GroupPicker id={groupFieldId} groups={groups} viewerSuperAdmin value={values.groupId} onChange={(id) => set("groupId", id)} />
                                {errorOf("group") ? (
                                    <p className="text-xs text-destructive">{errorOf("group")}</p>
                                ) : (
                                    <p className={cn("text-xs", noGroup ? "text-warning" : "text-muted-foreground")}>
                                        {noGroup ? "They sign in, but see and do nothing until someone picks a group." : "They sign in at once and do what the group allows."}
                                    </p>
                                )}
                            </div>
                        )}
                        <SetupBox adapterId={adapterId} callbackUrl={callbackUrl(model.callbackBase, values.providerId.trim() || "...")} providerId={provider ? undefined : values.providerId.trim()} />
                    </div>
                </div>
            </ScrollArea>

            <div className={cn(DIALOG_FOOTER, "flex flex-col gap-2 sm:flex-row sm:items-center")}>
                <span className="min-w-0 truncate text-xs text-muted-foreground sm:mr-auto">
                    {provider ? (unchanged ? "No changes yet" : "") : `Step 2 of 2 · ${copy.name}`}
                </span>
                <div className="flex shrink-0 items-center justify-end gap-2">
                    <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button type="submit" disabled={saving || unchanged}>
                        {saving && <Loader2 className="animate-spin" />}
                        {provider ? "Save changes" : "Create provider"}
                    </Button>
                </div>
            </div>
        </form>
    );
}
