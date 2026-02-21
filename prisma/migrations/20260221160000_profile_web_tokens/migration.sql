-- CreateTable
CREATE TABLE "ProfileAccessToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "ProfileAccessToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProfileWebSession" (
    "id" TEXT NOT NULL,
    "sessionKey" TEXT NOT NULL,
    "telegramId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3),

    CONSTRAINT "ProfileWebSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProfileAccessToken_token_key" ON "ProfileAccessToken"("token");

-- CreateIndex
CREATE INDEX "ProfileAccessToken_telegramId_createdAt_idx" ON "ProfileAccessToken"("telegramId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfileAccessToken_expiresAt_idx" ON "ProfileAccessToken"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProfileWebSession_sessionKey_key" ON "ProfileWebSession"("sessionKey");

-- CreateIndex
CREATE INDEX "ProfileWebSession_telegramId_createdAt_idx" ON "ProfileWebSession"("telegramId", "createdAt");

-- CreateIndex
CREATE INDEX "ProfileWebSession_expiresAt_idx" ON "ProfileWebSession"("expiresAt");

-- AddForeignKey
ALTER TABLE "ProfileAccessToken" ADD CONSTRAINT "ProfileAccessToken_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfileWebSession" ADD CONSTRAINT "ProfileWebSession_telegramId_fkey" FOREIGN KEY ("telegramId") REFERENCES "User"("telegramId") ON DELETE RESTRICT ON UPDATE CASCADE;
