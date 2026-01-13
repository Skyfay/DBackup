import { createAuthClient } from "better-auth/react"

export const authClient = createAuthClient({
    baseURL: "http://localhost:3000" // Set your base URL
})

export const { signIn, signOut, useSession, signUp } = authClient;
