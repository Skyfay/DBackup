import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";
import { APIError } from "better-auth/api";

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "sqlite",
    }),
    emailAndPassword: {
        enabled: true,
        autoSignIn: true
    },
    hooks: {
        before: async (ctx) => {
            if (ctx.request?.url) { // Ensure request and url exist
                const url = new URL(ctx.request.url);
                if (url.pathname.includes("/sign-up/email")) {
                    const userCount = await prisma.user.count();
                    // If users exist, check if the requester is authenticated (admin)
                    if (userCount > 0) {
                        try {
                            // We need to construct a headers object that matches what getSession expects
                            // The context request headers are available
                            const session = await auth.api.getSession({
                                headers: ctx.headers
                            });

                            if (session) {
                                return; // Allow if authenticated
                            }
                        } catch (e) {
                            // Ignore error, verify session failed
                        }

                        throw new APIError("FORBIDDEN", {
                           message: "Registration is disabled because an admin account already exists."
                        });
                    }
                }
            }
        }
    }
});
