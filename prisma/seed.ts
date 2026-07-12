import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding minimal data...');

  // Create the local organization
  const org = await prisma.organization.create({
    data: {
      name: 'ModelVault Local',
      slug: 'modelvault-local',
      ownerId: 'local',
    },
  });

  // Create the local user
  const user = await prisma.user.create({
    data: {
      email: 'local@modelvault',
      name: 'Local User',
      passwordHash: 'local',
    },
  });

  // Create the org membership
  await prisma.orgMember.create({
    data: {
      orgId: org.id,
      userId: user.id,
      role: 'admin',
      invitedBy: user.id,
      acceptedAt: new Date(),
    },
  });

  // Update the org owner to the real user ID
  await prisma.organization.update({
    where: { id: org.id },
    data: { ownerId: user.id },
  });

  console.log(`Created org: ${org.id} (${org.name})`);
  console.log(`Created user: ${user.id} (${user.email})`);
  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());