import { auth } from "@/lib/auth";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginForm } from "@/components/auth/login-form";

export default async function Home() {
    const session = await auth.api.getSession({
        headers: await headers()
    });

    if (session) {
        redirect("/dashboard");
    }

    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-muted/50">
             <div className="mb-8 font-bold text-2xl tracking-tight">
                Database Backup Manager
             </div>
            <LoginForm />
        </div>
    );
}
