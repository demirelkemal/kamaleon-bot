const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const plans = [
    { code: 'plan_7', name: '7 days', durationDays: 7, priceCents: 9900 },
    { code: 'plan_30', name: '30 days', durationDays: 30, priceCents: 29900 },
    { code: 'plan_90', name: '90 days', durationDays: 90, priceCents: 79900 }
  ];

  for (const plan of plans) {
    await prisma.plan.upsert({
      where: { code: plan.code },
      update: {
        name: plan.name,
        durationDays: plan.durationDays,
        priceCents: plan.priceCents,
        isActive: true
      },
      create: plan
    });
  }

  const count = await prisma.plan.count({ where: { isActive: true } });
  console.log(`Seed complete: ${count} active plans`);
}

main()
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
