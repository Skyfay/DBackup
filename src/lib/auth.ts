import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";

export const auth = betterAuth({
    database: prismaAdapter(prisma, {
        provider: "sqlite", // or "postgresql", "mysql", etc.
    }),
    emailAndPassword: {
        enabled: true,
        autoSignIn: true
    },
});
