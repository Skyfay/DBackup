
import { PrismaClient } from '@prisma/client';
import { testDatabases } from '../tests/integration/test-configs';

const prisma = new PrismaClient();

async function main() {
    console.log('🌱 Seeding test database sources...');

    for (const db of testDatabases) {
        console.log(`Adding ${db.name}...`);

        // Check if exists
        const exists = await prisma.adapterConfig.findFirst({
            where: { name: db.name }
        });

        if (exists) {
            console.log(`- ${db.name} already exists. Updating config...`);
            await prisma.adapterConfig.update({
                where: { id: exists.id },
                data: {
                    config: JSON.stringify(db.config),
                    adapterId: db.config.type,
                    type: 'database'
                }
            });
        } else {
            await prisma.adapterConfig.create({
                data: {
                    name: db.name,
                    type: 'database',
                    adapterId: db.config.type,
                    config: JSON.stringify(db.config)
                }
            });
            console.log(`- ${db.name} created.`);
        }
    }

    console.log('✅ Seeding complete.');
}

main()
    .catch((e) => {
        console.error(e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
