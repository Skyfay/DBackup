"use server"

import { auth } from "@/auth"
import prisma from "@/lib/prisma"
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
    GenerateRegistrationOptionsOpts,
    VerifyRegistrationResponseOpts,
} from '@simplewebauthn/server';
import { revalidatePath } from "next/cache";

const RP_ID = process.env.NEXT_PUBLIC_RP_ID || 'localhost';
const ORIGIN = process.env.NEXT_PUBLIC_ORIGIN || 'http://localhost:3000';

export async function generatePasskeyRegistrationOptions() {
    const session = await auth();
    if (!session?.user?.email) throw new Error("Not authenticated");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email },
        include: { Authenticator: true }
    });

    if (!user) throw new Error("User not found");

    const opts: GenerateRegistrationOptionsOpts = {
        rpName: 'Database Backup Manager',
        rpID: RP_ID,
        userID: new TextEncoder().encode(user.id),
        userName: user.email,
        timeout: 60000,
        attestationType: 'none',
        excludeCredentials: user.Authenticator.map(authenticator => ({
            id: authenticator.credentialID,
            type: 'public-key',
            transports: authenticator.transports ? (authenticator.transports.split(',') as any) : undefined,
        })),
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'preferred',
        },
        supportedAlgorithmIDs: [-7, -257],
    };

    const options = await generateRegistrationOptions(opts);

    // Save challenge to DB to verify later?
    // Usually we need to store the challenge associated with the user session or something.
    // However, NextAuth's `WebAuthn` provider might handle its own flow, but here we are doing manual registration.
    // For simplicity, we'll store it in a temporary way or just rely on signed payload if we could,
    // but verification REQUIRES the expected challenge.
    // Let's store it in the user record temporarily or a generic cache.
    // Since we don't have a cache table, we can add a field or use the `currentChallenge` field if we add one.
    // Or we can abuse `totpSecret` (bad idea).
    // Let's add `currentChallenge` to User model.

    await prisma.user.update({
        where: { id: user.id },
        data: { currentChallenge: options.challenge }
    });

    return options;
}

export async function generatePasskeyAuthenticationOptions(email: string) {
    const user = await prisma.user.findUnique({
        where: { email },
        include: { Authenticator: true }
    });

    if (!user) throw new Error("User not found");

    const opts = {
        rpID: RP_ID,
        allowCredentials: user.Authenticator.map(authenticator => ({
            id: authenticator.credentialID,
            type: 'public-key' as const,
            transports: authenticator.transports ? (authenticator.transports.split(',') as any) : undefined,
        })),
        userVerification: 'preferred' as const,
    };

    const options = await generateAuthenticationOptions(opts);

    await prisma.user.update({
        where: { id: user.id },
        data: { currentChallenge: options.challenge }
    });

    return options;
}

export async function verifyPasskeyFor2FA(response: any, email: string) {
    const user = await prisma.user.findUnique({
        where: { email },
        include: { Authenticator: true }
    });

    if (!user || !user.currentChallenge) throw new Error("Authentication not initialized");

    // Find the authenticator used
    const authenticator = user.Authenticator.find(a => a.credentialID === response.id);
    if (!authenticator) throw new Error("Authenticator not found");

    const verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: ORIGIN,
        expectedRPID: RP_ID,
        authenticator: {
            credentialID: authenticator.credentialID,
            credentialPublicKey: Buffer.from(authenticator.credentialPublicKey, 'base64'),
            counter: authenticator.counter,
        },
    });

    if (verification.verified && verification.authenticationInfo) {
         // Update counter
         await prisma.authenticator.update({
             where: { credentialID: authenticator.credentialID },
             data: { counter: verification.authenticationInfo.newCounter }
         });

         // Clear challenge
         const token = crypto.randomUUID();
         const expires = new Date(Date.now() + 5 * 60 * 1000); // 5 mins

         await prisma.user.update({
             where: { id: user.id },
             data: {
                 currentChallenge: null,
                 tempToken: token,
                 tempTokenExpires: expires
             }
         });

         return { success: true, token };
    }

    throw new Error("Verification failed");
}

export async function verifyPasskeyRegistration(response: any, name: string = "Passkey") {
    const session = await auth();
    if (!session?.user?.email) throw new Error("Not authenticated");

    const user = await prisma.user.findUnique({
        where: { email: session.user.email }
    });

    if (!user || !user.currentChallenge) throw new Error("Registration not initialized");

    const opts: VerifyRegistrationResponseOpts = {
        response,
        expectedChallenge: user.currentChallenge,
        expectedOrigin: ORIGIN, // Ensure this matches your deployment
        expectedRPID: RP_ID,
        requireUserVerification: false, // Depending on your needs
    };

    const verification = await verifyRegistrationResponse(opts);

    if (verification.verified && verification.registrationInfo) {
        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;
        const { id: credentialID, publicKey: credentialPublicKey, counter, transports } = credential;

        console.log("Saving new passkey with name:", name);

        await prisma.authenticator.create({
            data: {
                credentialID,
                credentialPublicKey: Buffer.from(credentialPublicKey).toString('base64'),
                counter,
                credentialDeviceType,
                credentialBackedUp,
                transports: transports ? transports.join(',') : undefined,
                userId: user.id,
                providerAccountId: credentialID,
                name: name
            }
        });

        // Clear challenge
        await prisma.user.update({
            where: { id: user.id },
            data: { currentChallenge: null }
        });

        revalidatePath("/dashboard/settings");

        return { success: true };
    }

    throw new Error("Verification failed");
}

export async function deletePasskey(credentialID: string) {
    const session = await auth();
    if (!session?.user?.id) throw new Error("Not authenticated");

    await prisma.authenticator.deleteMany({
        where: {
            credentialID,
            userId: session.user.id
        }
    });

    revalidatePath("/dashboard/settings");
    return { success: true };
}

export async function getPasskeys() {
    const session = await auth();
    if (!session?.user?.id) {
        console.log("getPasskeys: No session user id");
        return [];
    }

    console.log("getPasskeys: Fetching for user", session.user.id);
    const keys = await prisma.authenticator.findMany({
        where: { userId: session.user.id },
        select: {
            credentialID: true,
            counter: true,
            name: true,
        }
    });
    console.log("getPasskeys: Found", keys.length);
    return keys;
}
