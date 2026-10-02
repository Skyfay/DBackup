import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { FirstStart } from "@/components/auth/first-start";
import { LoginForm } from "@/components/auth/login-form";
import { LoginLayout } from "@/components/auth/login-panel";
import { getLoginPageModel } from "@/services/auth/login-page-service";

interface HomeProps {
    searchParams: Promise<{ error?: string }>;
}

/** The login page, and the first start while nobody has an account. */
export default async function Home({ searchParams }: HomeProps) {
    const params = await searchParams;
    let session = null;
    try {
        session = await auth.api.getSession({ headers: await headers() });
    } catch {
        // A failed session check shows the login page.
    }
    if (session) redirect("/dashboard");

    const model = await getLoginPageModel();
    return (
        <LoginLayout instanceName={model.instanceName} picture={model.picture} adapters={model.adapters}>
            {model.firstStart ? (
                <FirstStart allowSignUp={model.emailLogin} passwordRules={model.passwordRules} />
            ) : (
                <LoginForm
                    instance={model.instanceName ?? "DBackup"}
                    providers={model.providers}
                    emailLogin={model.emailLogin}
                    passkeyLogin={model.passkeyLogin}
                    autoRedirectProviderId={model.autoRedirectProviderId}
                    errorCode={params.error}
                />
            )}
        </LoginLayout>
    );
}
