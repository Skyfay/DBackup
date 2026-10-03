"use client";

import { useState } from "react";
import { CircleCheck, Loader2, Pencil, RefreshCw } from "lucide-react";
import { checkSsoConnection } from "@/app/actions/auth/oidc";
import { FactList, Section } from "@/components/adapter/connection-details-sections";
import { Notice } from "@/components/dashboard/storage/restore/restore-parts";
import type { BackupActionGroup } from "@/components/dashboard/storage/explorer/backup-actions";
import { BackupRowMenu } from "@/components/dashboard/storage/explorer/backup-menus";
import { RelativeTime } from "@/components/dashboard/widgets/relative-time";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { listWords } from "@/lib/auth/access-summary";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { callbackUrl, type SsoEndpoints, type SsoProviderRow, type SsoProvidersModel } from "@/services/sso/sso-providers-types";
import { adapterCopy, SSO_SCOPES } from "./sign-in-adapters";
import { NewPeopleCell, placeLine, ProviderStateBadge } from "./sign-in-cells";
import { CopyFrame, CopyLine, LinkedPersonRow } from "./sign-in-parts";

const log = logger.child({ component: "sign-in-details" });

const ENDPOINTS: { key: keyof SsoEndpoints; label: string }[] = [
    { key: "issuer", label: "Issuer" },
    { key: "authorization", label: "Authorization" },
    { key: "token", label: "Token" },
    { key: "userInfo", label: "User info" },
    { key: "jwks", label: "JWKS" },
];

type Check = { kind: "idle" } | { kind: "checking" } | { kind: "done"; endpoints: SsoEndpoints } | { kind: "failed"; error: string };

interface SignInDetailsProps {
    open: boolean;
    /** Stays set while the panel slides out, so its content does not vanish halfway. */
    provider: SsoProviderRow | null;
    model: SsoProvidersModel;
    onClose: () => void;
    onEdit?: (provider: SsoProviderRow) => void;
    /** Enable, Disable and Delete, as the menu of its row shows them. */
    menu: BackupActionGroup[];
    /** May check the connection, which reaches out to the provider. */
    canManage: boolean;
}

/** Everything about one provider in a panel from the right: what it needs, what happens to new people, who is linked and its endpoints. */
export function SignInDetails(props: SignInDetailsProps) {
    const { open, provider, onClose } = props;
    return (
        <Sheet open={open && provider !== null} onOpenChange={(next) => !next && onClose()}>
            <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-xl">
                {provider && <Content key={provider.id} {...props} provider={provider} />}
            </SheetContent>
        </Sheet>
    );
}

function Content({ provider, model, onEdit, menu, canManage }: SignInDetailsProps & { provider: SsoProviderRow }) {
    const [check, setCheck] = useState<Check>({ kind: "idle" });
    const copy = adapterCopy(provider.adapterId);
    const place = provider.adapterId === "generic" ? "the provider" : copy.name;

    const runCheck = async () => {
        setCheck({ kind: "checking" });
        try {
            const result = await checkSsoConnection({ adapterId: provider.adapterId, adapterConfig: provider.config });
            setCheck(result.success && result.data ? { kind: "done", endpoints: result.data } : { kind: "failed", error: result.error || "The provider could not be reached." });
        } catch (error) {
            // Without the right to change the settings the action throws instead of answering.
            log.warn("Checking a sign-in provider failed", { providerId: provider.providerId }, wrapError(error));
            setCheck({ kind: "failed", error: "The provider could not be checked." });
        }
    };

    const shown = check.kind === "done" ? check.endpoints : provider.endpoints;
    const changed = check.kind === "done" ? ENDPOINTS.filter(({ key }) => (check.endpoints[key] ?? null) !== (provider.endpoints[key] ?? null)).map(({ label }) => label) : [];
    const redirected = model.autoRedirect === provider.providerId;

    return (
        <>
            <SheetHeader className="gap-4 border-b p-5 pr-12">
                <div className="flex min-w-0 items-start gap-3">
                    <ProviderTile adapterId={provider.adapterId} size="lg" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <SheetTitle className="truncate text-lg font-semibold">{provider.name}</SheetTitle>
                            <ProviderStateBadge provider={provider} />
                        </div>
                        <SheetDescription className="truncate text-sm text-muted-foreground">
                            <span className="font-mono text-xs">{provider.providerId}</span>
                            {` · ${placeLine(provider)}`}
                        </SheetDescription>
                    </div>
                </div>
                {(onEdit || canManage || menu.length > 0) && (
                    <div className="flex flex-wrap items-center gap-2">
                        {onEdit && (
                            <Button variant="outline" size="sm" onClick={() => onEdit(provider)}>
                                <Pencil />
                                Edit
                            </Button>
                        )}
                        {canManage && (
                            <Button variant="outline" size="sm" onClick={() => void runCheck()} disabled={check.kind === "checking"}>
                                {check.kind === "checking" ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                                Check connection
                            </Button>
                        )}
                        {menu.length > 0 && <BackupRowMenu name={provider.name} groups={menu} variant="outline" align="start" />}
                    </div>
                )}
            </SheetHeader>

            <ScrollArea className="min-h-0 flex-1">
                <div className="space-y-6 p-5">
                    <Section title={`In ${place}`} aside="what the provider needs">
                        <CopyFrame>
                            <CopyLine label="Redirect URI" value={callbackUrl(model.callbackBase, provider.providerId)} />
                            <CopyLine label="Scopes" value={SSO_SCOPES} />
                            {provider.clientId ? <CopyLine label="Client ID" value={provider.clientId} /> : <CopyLine label="Client ID" note="-" />}
                            <CopyLine label="Client secret" note="Saved, never shown again" />
                        </CopyFrame>
                    </Section>

                    <Section title="New people" aside={onEdit ? "Edit to change" : undefined}>
                        {provider.allowProvisioning ? (
                            provider.group ? (
                                <div className="flex flex-wrap items-center gap-2 text-sm">
                                    <span>{provider.name} adds someone on their first sign-in.</span>
                                    <NewPeopleCell provider={provider} />
                                </div>
                            ) : (
                                <Notice tone="warning" title="Added without a group">
                                    {provider.name} adds someone on their first sign-in. They sign in, but see and do nothing until someone picks a group for them.
                                </Notice>
                            )
                        ) : (
                            <p className="text-sm">Only people with an account in DBackup of the same email sign in through it. Someone new is turned away.</p>
                        )}
                        {(provider.domain || redirected) && (
                            <p className="text-xs text-muted-foreground">
                                {provider.domain && `An email of ${provider.domain} goes straight to it from the login page.`}
                                {provider.domain && redirected && " "}
                                {redirected && "The login page sends everyone straight to it, since OIDC_AUTO_REDIRECT names it."}
                            </p>
                        )}
                    </Section>

                    <Section title="Linked people" aside={provider.linked.length > 0 ? provider.linked.length.toLocaleString() : undefined}>
                        {provider.linked.length === 0 ? (
                            <p className="text-sm text-muted-foreground">Nobody has signed in through it yet.</p>
                        ) : (
                            <ul className="divide-y border-y">
                                {provider.linked.map((person) => <LinkedPersonRow key={person.id} person={person} />)}
                            </ul>
                        )}
                    </Section>

                    <Section
                        title="Endpoints"
                        aside={check.kind === "done" ? "read just now" : <>saved <RelativeTime date={provider.updatedAt} /></>}
                    >
                        {check.kind === "failed" && <Notice tone="destructive" title="Not reached">{check.error}</Notice>}
                        {check.kind === "done" && changed.length > 0 && (
                            <Notice tone="warning" title="Other endpoints now">
                                It answers with another {listWords(changed)} endpoint than the saved one. Open Edit and save it to use the new {changed.length === 1 ? "one" : "ones"}.
                            </Notice>
                        )}
                        {check.kind === "done" && changed.length === 0 && (
                            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                                <CircleCheck className="size-3.5 text-success" aria-hidden="true" />
                                It answers with the saved endpoints.
                            </p>
                        )}
                        <FactList
                            columns={1}
                            facts={ENDPOINTS.filter(({ key }) => shown[key] || key !== "jwks").map(({ key, label }) => ({
                                label,
                                value: shown[key] ? <span className="font-mono text-xs" title={shown[key] ?? undefined}>{shown[key]}</span> : "-",
                            }))}
                        />
                    </Section>
                </div>
            </ScrollArea>
        </>
    );
}
