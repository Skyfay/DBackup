"use client";

import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, UserPlus } from "lucide-react";
import { signUp } from "@/lib/auth/client";
import { passwordProblem, type PasswordRules } from "@/lib/auth/password-policy";
import { PasswordChecklist } from "./password-checklist";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { wrapError } from "@/lib/logging/errors";
import { logger } from "@/lib/logging/logger";
import { BackHeading, PasswordInput } from "./login-parts";
import { AFTER_SIGN_IN } from "@/lib/auth/sign-in-target";

const log = logger.child({ component: "first-account-form" });

/** The fields of the first account, whose password follows the rules of Settings > Passwords like every other. */
function schemaFor(rules: PasswordRules | null) {
    return z
        .object({
            name: z.string().trim().max(100),
            email: z.string().trim().email("Enter an email address."),
            password: z.string().min(1, "Enter a password."),
        })
        .superRefine((values, ctx) => {
            const problem = rules ? passwordProblem(values.password, rules, values) : null;
            if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
        });
}

type Values = z.infer<ReturnType<typeof schemaFor>>;

/** The first account of a new DBackup, which becomes its SuperAdmin. */
export function FirstAccountForm({ rules, onBack }: { rules: PasswordRules | null; onBack: () => void }) {
    const router = useRouter();
    const [busy, setBusy] = useState(false);
    const form = useForm<Values>({ resolver: zodResolver(schemaFor(rules)), defaultValues: { name: "", email: "", password: "" } });
    const [name, email, password] = useWatch({ control: form.control, name: ["name", "email", "password"] });

    const submit = form.handleSubmit(async ({ name, email, password }) => {
        setBusy(true);
        try {
            await signUp.email({
                email,
                password,
                // An empty name takes the part of the email before the @, as the profile can change later.
                name: name || email.split("@")[0],
                callbackURL: AFTER_SIGN_IN,
                fetchOptions: {
                    onSuccess: () => router.push(AFTER_SIGN_IN),
                    onError: (context) => {
                        setBusy(false);
                        const field = /PASSWORD/.test(context.error.code ?? "") ? "password" : "email";
                        form.setError(field, { message: context.error.message || "The account could not be created." }, { shouldFocus: true });
                    },
                },
            });
        } catch (error: unknown) {
            log.error("Creating the first account failed", {}, wrapError(error));
            setBusy(false);
            form.setError("email", { message: "The account could not be created. Try again." });
        }
    });

    return (
        <div className="w-full max-w-sm">
            <BackHeading title="Create the first account" sub="The one that runs this DBackup." onBack={onBack} />
            <Form {...form}>
                <form noValidate onSubmit={(event) => void submit(event)} className="space-y-4">
                    <FormField
                        control={form.control}
                        name="name"
                        render={({ field }) => (
                            <FormItem>
                                <FormLabel>Name</FormLabel>
                                <FormControl>
                                    <Input autoComplete="name" className="h-10" autoFocus {...field} />
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
                    <p className="flex gap-2.5 rounded-lg border bg-muted/40 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                        You become the SuperAdmin. Add the others later under Users &amp; Groups, and a passkey in your profile.
                    </p>
                    <Button type="submit" tone="create" size="lg" className="w-full" disabled={busy}>
                        {busy ? <Loader2 className="animate-spin" /> : <UserPlus />}
                        Create account
                    </Button>
                </form>
            </Form>
        </div>
    );
}
