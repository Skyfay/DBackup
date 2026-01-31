import { auth } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";
import { getPublicSsoProviders } from "@/app/actions/oidc";

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

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50">
             <div className="mb-8 font-bold text-2xl tracking-tight">
                DBackup
             </div>
            <LoginForm
                allowSignUp={userCount === 0}
                ssoProviders={ssoProviders}
                errorCode={params.error}
                disablePasskeyLogin={disablePasskeyLogin}
            />
        </div>
    );
}
