import { z } from "zod";
import { MAX_PASSWORD_LENGTH, passwordProblem, type PasswordRules } from "@/lib/auth/password-policy";
import { HOME_TENANT_ID } from "@/lib/tenant/home";
import { NO_GROUP } from "./user-columns";

/**
 * The fields of the dialog. A new password follows the rules of Settings > Passwords once they are
 * loaded. A new account of All tenants names its tenant, and outside the home tenant its group, or
 * under Platform runs the platform with a platform group instead.
 */
export function schemaFor(creating: boolean, rules: PasswordRules | null, pickTenant: boolean) {
    return z
        .object({
            name: z.string().trim().min(2, "Name must be at least 2 characters.").max(100, "Name can have at most 100 characters."),
            email: z.string().trim().email("Invalid email address."),
            password: creating
                ? z.string().min(1, "Enter a password, or click Generate.").max(MAX_PASSWORD_LENGTH, `The password can have at most ${MAX_PASSWORD_LENGTH} characters.`)
                : z.string(),
            /** Works in a tenant with a group there, or runs the platform with a platform group. */
            kind: z.enum(["tenant", "platform"]),
            tenantId: z.string(),
            groupId: z.string(),
            platform: z.string(),
        })
        .superRefine((values, ctx) => {
            const problem = creating && rules && values.password ? passwordProblem(values.password, rules, values) : null;
            if (problem) ctx.addIssue({ code: "custom", path: ["password"], message: problem });
            if (values.kind === "platform") {
                if (!values.platform) ctx.addIssue({ code: "custom", path: ["platform"], message: "Pick the platform group they hold." });
                return;
            }
            if (pickTenant && !values.tenantId) ctx.addIssue({ code: "custom", path: ["tenantId"], message: "Pick the tenant they work in." });
            if (!values.groupId) ctx.addIssue({ code: "custom", path: ["groupId"], message: "Pick a group, or No group." });
            if (pickTenant && values.tenantId && values.tenantId !== HOME_TENANT_ID && values.groupId === NO_GROUP) {
                ctx.addIssue({ code: "custom", path: ["groupId"], message: "Pick the group they work with in this tenant." });
            }
        });
}

export type Values = z.infer<ReturnType<typeof schemaFor>>;
