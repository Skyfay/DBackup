import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FirstStart } from "@/components/auth/first-start";
import { LoginForm } from "@/components/auth/login-form";
import { LoginLayout } from "@/components/auth/login-panel";
import { safeNextPath } from "@/lib/auth/sign-in-target";
import { getLoginPageModel } from "@/services/auth/login-page-service";

interface HomeProps {
    searchParams: Promise<{ error?: string; next?: string | string[] }>;
}

/**
 * The login page, and the first start while nobody has an account. `next` names the page to go to
 * after signing in, like an invitation, and only a path of this site counts.
 */
export default async function Home({ searchParams }: HomeProps) {
    const params = await searchParams;
    const next = safeNextPath(params.next);
    let session = null;
    try {
        session = await auth.api.getSession({ headers: await headers() });
    } catch {
        // A failed session check shows the login page.
    }
    if (session) redirect(next ?? "/dashboard");

    const model = await getLoginPageModel();
    return (
        <LoginLayout instanceName={model.instanceName} picture={model.picture} adapters={model.adapters}>
            {model.firstStart ? (
                <FirstStart allowSignUp={model.emailLogin} passwordRules={model.passwordRules} />
            ) : (
                <LoginForm
                    instance={model.instanceName ?? "DBackup"}
                    providers={model.providers}
                    domainRouting={model.domainRouting}
                    emailLogin={model.emailLogin}
                    passkeyLogin={model.passkeyLogin}
                    autoRedirectProviderId={model.autoRedirectProviderId}
                    errorCode={params.error}
                    next={next}
                />
            )}
        </LoginLayout>
    );
}
