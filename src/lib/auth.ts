import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import prisma from "./prisma";
import { twoFactor } from "better-auth/plugins";
import { passkey } from "@better-auth/passkey";
import { PERMISSIONS } from "@/lib/permissions";

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
        passkey()
    ],
    hooks: {
        after: async (ctx) => {
            if (ctx.request?.url) {
                const url = new URL(ctx.request.url);
                if (url.pathname.includes("/sign-up/email")) {
                    const userCount = await prisma.user.count();
                    if (userCount === 1) {
                        const user = await prisma.user.findFirst();
                        if (user) {
                            const allPermissions = Object.values(PERMISSIONS).flatMap(group => Object.values(group));

                            const group = await prisma.group.upsert({
                                where: { name: "SuperAdmin" },
                                update: { permissions: JSON.stringify(allPermissions) },
                                create: {
                                    name: "SuperAdmin",
                                    permissions: JSON.stringify(allPermissions)
                                }
                            });

                            await prisma.user.update({
                                where: { id: user.id },
                                data: { groupId: group.id }
                            });
                        }
                    }
                }
            }
        }
    }
});
