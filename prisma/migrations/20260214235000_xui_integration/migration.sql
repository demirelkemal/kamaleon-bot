-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN "lastProvisionedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "VpnAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "xuiClientId" TEXT NOT NULL,
    "xuiInboundId" INTEGER NOT NULL,
    "vlessUri" TEXT,
    "lastProvisionedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VpnAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VpnAccount_userId_key" ON "VpnAccount"("userId");

-- AddForeignKey
ALTER TABLE "VpnAccount" ADD CONSTRAINT "VpnAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
