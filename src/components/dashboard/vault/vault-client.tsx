"use client";

import { useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Download, Import, KeyRound, LockKeyhole, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { PageHead } from "@/components/ui/page-head";
import { PageTabs } from "@/components/ui/page-tabs";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { useIsMobileState } from "@/hooks/use-mobile";
import type { TablePreferences } from "@/lib/core/table-preferences";
import { CredentialsTab, type CredentialsAccess, type CredentialsTabHandle } from "./credentials-tab";
import { KeysTab, type KeysTabHandle } from "./keys-tab";
import type { VaultAttention } from "@/services/vault/vault-counts";
import { VAULT_TABLE_IDS, type VaultCounts } from "./vault-tables";

type VaultTab = "credentials" | "encryption";

export interface VaultAccess extends CredentialsAccess {
    /** May see the credential profiles at all. */
    canReadCredentials: boolean;
    /** May change the keys, download their kit and reveal them. */
    canManageKeys: boolean;
}

interface VaultClientProps {
    access: VaultAccess;
    counts: VaultCounts;
    attention: VaultAttention;
    layouts: Record<string, TablePreferences>;
}

/**
 * The Vault page: the credential profiles connections log in with, and the keys backups are
 * encrypted with. The tab lives in the address, the buttons beside the tabs belong to the open one,
 * and a phone gets cards.
 */
export function VaultClient({ access, counts, attention, layouts }: VaultClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const isMobile = useIsMobileState();
    const credentials = useRef<CredentialsTabHandle>(null);
    const keys = useRef<KeysTabHandle>(null);

    const tabs: VaultTab[] = [...(access.canReadCredentials ? ["credentials" as const] : []), "encryption"];
    const requested = searchParams.get("tab") as VaultTab | null;
    const active = requested && tabs.includes(requested) ? requested : tabs[0];

    const setTab = useCallback((value: string) => {
        const next = new URLSearchParams(searchParams.toString());
        next.set("tab", value);
        // Replace rather than push, switching tabs should not fill the back button.
        router.replace(`?${next.toString()}`, { scroll: false });
    }, [router, searchParams]);

    return (
        <Tabs value={active} onValueChange={setTab} className="w-full gap-4 md:gap-0">
            <PageHead>
                <PageTabs
                    tabs={[
                        ...(access.canReadCredentials ? [{ value: "credentials", label: "Credentials", icon: LockKeyhole, attention: attention.credentials }] : []),
                        { value: "encryption", label: "Encryption", icon: KeyRound, attention: attention.encryption },
                    ]}
                    value={active}
                    onValueChange={setTab}
                    label="Vault list"
                />

                <div className="ml-auto flex shrink-0 items-center gap-2">
                    {active === "credentials" && access.canWrite && (
                        <Button tone="create" onClick={() => credentials.current?.openCreate()} aria-label="New profile">
                            <Plus />
                            <span className="hidden sm:inline">New profile</span>
                        </Button>
                    )}
                    {active === "encryption" && access.canManageKeys && (
                        <>
                            {/* A phone has no room for three buttons beside the tabs, so two of them share a menu.
                                Both are hidden by CSS rather than by the measured screen, so neither pops in. */}
                            <div className="sm:hidden">
                                <DropdownMenu modal={false}>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="icon" aria-label="More key actions">
                                            <MoreHorizontal />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                        <DropdownMenuItem onSelect={() => keys.current?.openKit()} disabled={counts.keys === 0}>
                                            <Download /> Recovery kit
                                        </DropdownMenuItem>
                                        <DropdownMenuItem tone="create" onSelect={() => keys.current?.openImport()}>
                                            <Import /> Import key
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </div>
                            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => keys.current?.openKit()} disabled={counts.keys === 0}>
                                <Download />
                                Recovery kit
                            </Button>
                            <Button variant="outline" className="hidden sm:inline-flex" onClick={() => keys.current?.openImport()}>
                                <Import />
                                Import key
                            </Button>
                            <Button tone="create" onClick={() => keys.current?.openCreate()} aria-label="New key">
                                <Plus />
                                <span className="hidden sm:inline">New key</span>
                            </Button>
                        </>
                    )}
                </div>
            </PageHead>

            {/* Waits for the measured screen, so a phone never flashes the table before its cards. */}
            {isMobile !== undefined && (
                <>
                    {access.canReadCredentials && (
                        <TabsContent value="credentials">
                            <CredentialsTab
                                ref={credentials}
                                cards={isMobile}
                                access={access}
                                initialLayout={layouts[VAULT_TABLE_IDS.credentials] ?? null}
                            />
                        </TabsContent>
                    )}
                    <TabsContent value="encryption">
                        <KeysTab ref={keys} cards={isMobile} canManage={access.canManageKeys} initialLayout={layouts[VAULT_TABLE_IDS.keys] ?? null} />
                    </TabsContent>
                </>
            )}
        </Tabs>
    );
}
