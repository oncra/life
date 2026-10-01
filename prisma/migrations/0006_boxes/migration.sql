-- Life Box image generator: people sign in with an emailed code, make a box, download its personal image.
-- A box gets a private, unplaced place at once (devices need a place); the location is set when it goes in the ground.
ALTER TABLE "Place" ADD COLUMN "placed" BOOLEAN NOT NULL DEFAULT true;

CREATE TYPE "ImageStatus" AS ENUM ('BUILDING', 'READY', 'FAILED');

CREATE TABLE "User" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastLogin" TIMESTAMP(3),
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE TABLE "LoginCode" (
  "id"        TEXT NOT NULL,
  "email"     TEXT NOT NULL,
  "codeHash"  TEXT NOT NULL,
  "attempts"  INTEGER NOT NULL DEFAULT 0,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt"    TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoginCode_email_createdAt_idx" ON "LoginCode"("email", "createdAt");

CREATE TABLE "Session" (
  "id"        TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "Box" (
  "id"           TEXT NOT NULL,
  "userId"       TEXT NOT NULL,
  "placeId"      TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "hostname"     TEXT NOT NULL,
  "nodePassword" TEXT NOT NULL,
  "wifiSsid"     TEXT,
  "imageStatus"  "ImageStatus" NOT NULL DEFAULT 'BUILDING',
  "imageError"   TEXT,
  "imageVersion" TEXT,
  "imageBytes"   BIGINT,
  "builtAt"      TIMESTAMP(3),
  "placedAt"     TIMESTAMP(3),
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Box_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Box_hostname_key" ON "Box"("hostname");
ALTER TABLE "Box" ADD CONSTRAINT "Box_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Box" ADD CONSTRAINT "Box_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
