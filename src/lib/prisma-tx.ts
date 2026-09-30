import type prisma from "@/lib/prisma";

/** A transaction on the client of DBackup, with its extensions, as `prisma.$transaction` hands it over. */
export type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];
