import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";
import { twoFactor } from "better-auth/plugins";

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "sqlite",
    }),
    user: {
        additionalFields: {
            timezone: {
                type: "string",
                required: false,
                defaultValue: "UTC"
            }
        }
    },
    emailAndPassword: {
        enabled: true,
        autoSignIn: true
    },
    plugins: [
        twoFactor()
    ],
    hooks: {
        before: async (ctx) => {
            if (ctx.request?.url) { // Ensure request and url exist
                const url = new URL(ctx.request.url);
                if (url.pathname.includes("/sign-up/email")) {
                    const userCount = await prisma.user.count();
                    // If users exist, check if the requester is authenticated (admin)
                    if (userCount > 0) {
                        try {
                            const session = await auth.api.getSession({
                                headers: ctx.headers || new Headers()
                            });

                            if (session) {
                                return; // Allow if authenticated
                            }
                        } catch (e) {
                            // ignore
                        }

                        // Check if we are checking access permission
                        return {
                            success: false, // Explicitly match type
                            error: "Registration is restricted to administrators."
                        } as any; /* Type casting to bypass strict typing if APIError is not matching context return */
                    }
                }
            }
        }
    }
});
