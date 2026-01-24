import { PrismaClient } from '@prisma/client'

// Add BigInt serialization support for JSON
// This prevents "TypeError: Do not know how to serialize a BigInt" when passing data to client components
// @ts-expect-error - BigInt toJSON is not in standard types
BigInt.prototype.toJSON = function () {
  return this.toString()
}

const prismaClientSingleton = () => {
  return new PrismaClient()
}

declare global {
  var prisma: undefined | ReturnType<typeof prismaClientSingleton>
}

const prisma = globalThis.prisma ?? prismaClientSingleton()

export default prisma

if (process.env.NODE_ENV !== 'production') globalThis.prisma = prisma
