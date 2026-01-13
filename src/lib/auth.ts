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
            if (ctx.path === "/sign-up/email") {
                const userCount = await prisma.user.count();
                if (userCount > 0) {
                     throw new APIError("FORBIDDEN", {
                        message: "Registration is disabled because an admin account already exists."
                     });
                }
            }
        }
    }
});
