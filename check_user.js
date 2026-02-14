require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

(async () => {
  const u = await p.user.findUnique({
    where: { telegramId: BigInt('291249764') },
    include: {
      subscriptions: { orderBy: { createdAt: 'desc' }, take: 3 },
      vpnAccount: true,
      orders: { orderBy: { createdAt: 'desc' }, take: 3 }
    }
  });

  console.log(JSON.stringify(u, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
})()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await p.$disconnect();
  });
