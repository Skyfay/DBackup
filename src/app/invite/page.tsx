import type { Metadata } from "next";
import { previewInvitation } from "@/app/actions/tenant/invitation";
import { InviteStep } from "@/components/auth/invite-step";
import { LoginLayout } from "@/components/auth/login-panel";
import { getPasswordPolicy } from "@/services/auth/password-policy-service";
import { loginAdapters } from "@/services/auth/login-page-service";
import { getLoginPicture } from "@/services/system/login-image-service";
import { getInstanceName } from "@/services/system/system-settings-service";

/** The name of the browser tab, which the root layout ends with the name of the instance. */
export const metadata: Metadata = { title: "Invitation" };

interface InvitePageProps {
    searchParams: Promise<{ token?: string | string[] }>;
}

/**
 * The page of an invitation link, in the look of the login page. Public on purpose: whoever opens
 * the link may not have an account yet, and the link itself is what lets them see where it leads.
 */
export default async function InvitePage({ searchParams }: InvitePageProps) {
    const { token } = await searchParams;
    const value = typeof token === "string" ? token : "";
    const [preview, instanceName, picture] = await Promise.all([previewInvitation(value), getInstanceName(), getLoginPicture()]);
    // The rules of a new password, only for someone with a working link who may make an account.
    const rules = preview.invitation && !preview.signedIn && preview.passwordSignUp ? await getPasswordPolicy() : null;

    return (
        <LoginLayout instanceName={instanceName || null} picture={picture} adapters={loginAdapters()}>
            <InviteStep token={value} invitation={preview.invitation} signedIn={preview.signedIn} passwordSignUp={preview.passwordSignUp} rules={rules} />
        </LoginLayout>
    );
}
