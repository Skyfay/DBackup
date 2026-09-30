"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Link2, Loader2, Unlink } from "lucide-react";
import { toast } from "sonner";
import { getMySsoConnections, initiateSsoConnect, unlinkMySsoAccount, type ConnectableProvider, type SsoConnection } from "@/app/actions/auth/sso-connections";
import { ProviderTile } from "@/components/oidc/provider-logo";
import { DateDisplay } from "@/components/utils/date-display";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { authClient } from "@/lib/auth/client";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";

const log = logger.child({ component: "sign-in-providers" });

/**
 * The single sign-on accounts linked to the viewer, each to unlink, and the providers they can link
 * besides. Linking goes through the provider and comes back with `?connected=1`.
 */
export function SignInProviders({ canManage }: { canManage: boolean }) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [connections, setConnections] = useState<SsoConnection[] | null>(null);
    const [connectable, setConnectable] = useState<ConnectableProvider[]>([]);
    const [accounts, setAccounts] = useState(0);
    const [unlinking, setUnlinking] = useState<SsoConnection | null>(null);
    const [busy, setBusy] = useState(false);
    const [linking, setLinking] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const result = await getMySsoConnections();
            setConnections(result.connections);
            setConnectable(result.connectableProviders);
            setAccounts(result.totalAccountCount);
        } catch (error) {
            log.warn("Loading the linked providers failed", {}, wrapError(error));
            setConnections([]);
        }
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    // Back from linking a provider: one message, and the address without the marker.
    useEffect(() => {
        if (searchParams.get("connected") !== "1") return;
        toast.success("Provider linked");
        const params = new URLSearchParams(searchParams.toString());
        params.delete("connected");
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
        // Only the address it came back with counts.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const unlink = async () => {
        if (!unlinking) return;
        setBusy(true);
        try {
            const result = await unlinkMySsoAccount(unlinking.providerId, unlinking.accountId);
            if (!result.success) {
                toast.error(result.error || "The provider could not be unlinked.");
                return;
            }
            toast.success(`${unlinking.providerName} unlinked`);
            await load();
        } catch (error) {
            log.warn("Unlinking a provider failed", {}, wrapError(error));
            toast.error("The provider could not be unlinked.");
        } finally {
            setBusy(false);
            setUnlinking(null);
        }
    };

    const link = async (providerId: string) => {
        setLinking(providerId);
        try {
            const result = await initiateSsoConnect(providerId);
            if (!result.success) {
                toast.error(result.error);
                setLinking(null);
                return;
            }
            // The browser goes to the provider, so the spinner stays until it leaves.
            await authClient.signIn.sso({ providerId, callbackURL: result.callbackURL, requestSignUp: false });
        } catch (error) {
            log.warn("Linking a provider failed", { providerId }, wrapError(error));
            toast.error("The provider could not be linked.");
            setLinking(null);
        }
    };

    const lastWayIn = accounts <= 1;

    return (
        <div data-setting="profile.providers" className="grid gap-2">
            <p className="text-xs font-medium text-muted-foreground">Sign-in providers</p>
            <div className="overflow-hidden rounded-lg border">
                {connections === null ? (
                    <div className="px-4 py-3">
                        <Skeleton className="h-9 w-full" />
                    </div>
                ) : (
                    <ul className="divide-y">
                        {connections.length === 0 && connectable.length === 0 && <li className="px-4 py-3 text-sm text-muted-foreground">No provider is linked to you.</li>}
                        {connections.map((connection) => (
                            <li key={connection.id} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                                <ProviderTile adapterId={connection.adapterId} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{connection.providerName}</p>
                                    <p className="truncate text-xs text-muted-foreground">
                                        {connection.providerAvailable ? "Linked" : "The provider is gone"} since <DateDisplay date={connection.createdAt} format="P" />
                                    </p>
                                </div>
                                {canManage && (
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={lastWayIn}
                                        title={lastWayIn ? "It is your only way in. Set a password or add a passkey first." : undefined}
                                        onClick={() => setUnlinking(connection)}
                                    >
                                        <Unlink />
                                        Unlink
                                    </Button>
                                )}
                            </li>
                        ))}
                        {connectable.map((provider) => (
                            <li key={provider.providerId} className="flex min-w-0 items-center gap-3 px-4 py-2.5">
                                <ProviderTile adapterId={provider.adapterId} />
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-sm font-medium">{provider.name}</p>
                                    <p className="truncate text-xs text-muted-foreground">Not linked, signs you in with one click once it is</p>
                                </div>
                                {canManage && (
                                    <Button type="button" variant="outline" size="sm" disabled={linking !== null} onClick={() => void link(provider.providerId)}>
                                        {linking === provider.providerId ? <Loader2 className="animate-spin" /> : <Link2 />}
                                        Link
                                    </Button>
                                )}
                            </li>
                        ))}
                    </ul>
                )}
            </div>

            <ConfirmDialog
                open={unlinking !== null}
                onOpenChange={(open) => !open && setUnlinking(null)}
                icon={Unlink}
                destructive
                title={`Unlink ${unlinking?.providerName ?? "the provider"}?`}
                note="It no longer signs you in"
                description="Signing in through it again links it again, as long as it lets you in."
                confirmLabel="Unlink"
                isPending={busy}
                onConfirm={() => void unlink()}
            />
        </div>
    );
}
