import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { SetupRestore } from "@/components/auth/setup-restore";
import { getPublicSsoProviders } from "@/app/actions/auth/oidc";
import { getOidcAutoRedirectProviderId, isEmailLoginDisabled } from "@/lib/auth/env-flags";
import Image from "next/image";

interface HomeProps {
    searchParams: Promise<{ error?: string }>;
}

export default async function Home({ searchParams }: HomeProps) {
    const headersList = await headers();
    const params = await searchParams;
    let session = null;
    try {
        session = await auth.api.getSession({
            headers: headersList
        });
    } catch (_error) {
        // Silently fail if session check fails on home, just show login
    }

    if (session) {
        redirect("/dashboard");
    }

    const userCount = await prisma.user.count();
    const ssoProviders = await getPublicSsoProviders();

    // Check if passkey login is disabled
    const disablePasskeySetting = await prisma.systemSetting.findUnique({ where: { key: "auth.disablePasskeyLogin" } });
    const disablePasskeyLogin = disablePasskeySetting?.value === 'true';

    const disableEmailLogin = isEmailLoginDisabled();

    // Resolve OIDC_AUTO_REDIRECT against the providers we already loaded. A value that
    // matches no enabled provider simply means no redirect - startup-checks.ts is what
    // reports it, so a provider deleted after boot degrades instead of breaking.
    const autoRedirectEnvValue = getOidcAutoRedirectProviderId();
    const autoRedirectProvider = autoRedirectEnvValue
        ? ssoProviders.find(p => p.providerId === autoRedirectEnvValue) ?? null
        : null;

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50">
             <div className="mb-8 flex items-center gap-3">
                <Image
                    src="/logo.svg"
                    alt="DBackup Logo"
                    width={40}
                    height={40}
                    priority
                />
                <h1 className="font-bold text-2xl tracking-tight">DBackup</h1>
             </div>
            <LoginForm
                allowSignUp={userCount === 0 && !disableEmailLogin}
                ssoProviders={ssoProviders}
                errorCode={params.error}
                disablePasskeyLogin={disablePasskeyLogin}
                disableEmailLogin={disableEmailLogin}
                autoRedirectProviderId={autoRedirectProvider?.providerId}
            />
            {/* A new DBackup can take a backup of an old one instead of a first account. */}
            {userCount === 0 && (
                <>
                    <div className="my-4 flex w-87.5 items-center gap-3 text-xs text-muted-foreground">
                        <span className="h-px flex-1 bg-border" />
                        OR
                        <span className="h-px flex-1 bg-border" />
                    </div>
                    <SetupRestore />
                </>
            )}
        </div>
    );
}
