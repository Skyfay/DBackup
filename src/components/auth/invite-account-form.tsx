"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { acceptInvitationWithNewAccount } from "@/app/actions/tenant/invitation";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { MAX_PASSWORD_LENGTH, passwordProblem, type PasswordRules } from "@/lib/auth/password-policy";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { refusalField } from "./invite-model";
import { LoginNote, PasswordInput } from "./login-parts";
import { PasswordChecklist } from "./password-checklist";

const log = logger.child({ component: "invite-account-form" });

/** The fields of a new account, whose password follows the rules of Settings > Passwords like every other. */
function schemaFor(rules: PasswordRules | null) {
    return z
        .object({
            name: z.string().trim().min(2, "Enter your name, at least 2 characters.").max(100),
            email: z.string().trim().email("Enter an email address."),
            password: z.string().min(1, "Enter a password.").max(MAX_PASSWORD_LENGTH, `A password can have at most ${MAX_PASSWORD_LENGTH} characters.`),
        })
        .superRefine((values, ctx) => {
            const problem = rules ? passwordProblem(values.password, rules, values) : null;
            if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
        });
}

type Values = z.infer<ReturnType<typeof schemaFor>>;

interface InviteAccountFormProps {
    token: string;
    tenantName: string;
    /** The rules of Settings > Passwords, checked here and again on the server. */
    rules: PasswordRules | null;
}

/**
 * Creates an account from an invitation, which joins the tenant at once. Nobody is signed in by
 * it: the login page follows, with a note to sign in with the new account.
 */
export function InviteAccountForm({ token, tenantName, rules }: InviteAccountFormProps) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    // A refusal about the link rather than a field, like one that ran out meanwhile.
    const [problem, setProblem] = useState<string | null>(null);
    const form = useForm<Values>({ resolver: zodResolver(schemaFor(rules)), defaultValues: { name: "", email: "", password: "" } });
    const [name, email, password] = useWatch({ control: form.control, name: ["name", "email", "password"] });

    const submit = form.handleSubmit(async (values) => {
        setBusy(true);
        setProblem(null);
        try {
            const result = await acceptInvitationWithNewAccount(token, values);
            if (!result.success) {
                const field = refusalField(result.error);
                if (field) form.setError(field, { message: result.error }, { shouldFocus: true });
                else setProblem(result.error);
                setBusy(false);
                return;
            }
            toast.success("Your account is ready", { description: `Sign in with ${result.data.email} to open ${result.data.tenantName}.`, duration: 15_000 });
            router.push("/");
        } catch (error: unknown) {
            log.error("Creating an account from an invitation failed", {}, wrapError(error));
            setProblem("The account could not be created. Try again.");
            setBusy(false);
        }
    });

    return (
        <Form {...form}>
            <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
                {problem && <LoginNote title="No account was created">{problem}</LoginNote>}
                <FormField
                    control={form.control}
                    name="name"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Name</FormLabel>
                            <FormControl>
                                <Input autoComplete="name" className="h-10" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="email"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Email</FormLabel>
                            <FormControl>
                                <Input type="email" autoComplete="email" placeholder="name@example.com" className="h-10" {...field} />
                            </FormControl>
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <FormField
                    control={form.control}
                    name="password"
                    render={({ field }) => (
                        <FormItem>
                            <FormLabel>Password</FormLabel>
                            <FormControl>
                                <PasswordInput autoComplete="new-password" {...field} />
                            </FormControl>
                            {rules && <PasswordChecklist rules={rules} password={password} owner={{ name, email }} />}
                            <FormMessage />
                        </FormItem>
                    )}
                />
                <Button type="submit" tone="create" size="lg" className="w-full" disabled={busy}>
                    {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                    Create account and join {tenantName}
                </Button>
            </form>
        </Form>
    );
}
