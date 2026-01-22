import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { sso } from "@better-auth/sso";
import { PERMISSIONS } from "@/lib/permissions";

export const auth = betterAuth({
    logging: {
        level: "debug"
    },
    baseURL: process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000",
    database: prismaAdapter(prisma, {
        provider: "sqlite",
    }),
    user: {
        additionalFields: {
            timezone: {
                type: "string",
                required: false,
                defaultValue: "UTC"
            },
            dateFormat: {
                type: "string",
                required: false,
                defaultValue: "P"
            },
            timeFormat: {
                type: "string",
                required: false,
                defaultValue: "p"
            },
            passkeyTwoFactor: {
                type: "boolean",
                required: false,
                defaultValue: false
            }
        }
    },
    emailAndPassword: {
        enabled: true,
        autoSignIn: true
    },
    plugins: [
        twoFactor(),
        passkey(),
        sso()
    ]
});
