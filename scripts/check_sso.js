const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const providers = await prisma.ssoProvider.findMany();
  console.log("SSO Providers:", JSON.stringify(providers, null, 2));
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
