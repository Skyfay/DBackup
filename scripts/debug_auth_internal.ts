
import prisma from "../src/lib/prisma";

async function main() {
  console.log("Checking DB directly...");
  const dbProvider = await prisma.ssoProvider.findFirst({
    where: { providerId: "skyauth" }
  });
  console.log("DB Provider:", dbProvider);

  if (!dbProvider) {
    console.error("Provider not found in DB via Prisma!");
    return;
  }

  // Unfortunately we can't easily invoke auth internal methods here without mocking Request
  // But we can check if the adapter is working
  console.log("Checking session list to verify adapter connection...");
  const sessions = await prisma.session.findMany({ take: 1 });
  console.log("Sessions check:", sessions.length >= 0 ? "OK" : "FAIL");
}

main()
  .catch(e => console.error(e))
  .finally(async () => {
    await prisma.$disconnect();
  });
