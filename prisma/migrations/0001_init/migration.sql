-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "DeviceKind" AS ENUM ('SOUND', 'SOIL', 'CAMERA', 'OTHER');

-- CreateEnum
CREATE TYPE "Dimension" AS ENUM ('PRODUCTIVITY', 'DIVERSITY', 'STRUCTURE', 'RENEWAL', 'CYCLING', 'RESILIENCE', 'AUTONOMY');

-- CreateEnum
CREATE TYPE "Direction" AS ENUM ('RISING', 'HOLDING', 'FALLING', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "VisitKind" AS ENUM ('BASELINE', 'RANDOM', 'TRIGGERED');

-- CreateEnum
CREATE TYPE "KeyRole" AS ENUM ('ADMIN', 'STEWARD', 'VERIFIER', 'CONSUMER');

-- CreateTable
CREATE TABLE "Place" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "geometry" JSONB NOT NULL,
    "centroidLat" DOUBLE PRECISION NOT NULL,
    "centroidLon" DOUBLE PRECISION NOT NULL,
    "areaHa" DOUBLE PRECISION NOT NULL,
    "country" TEXT,
    "biome" TEXT,
    "landUse" TEXT,
    "stewardName" TEXT,
    "stewardContact" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Place_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "kind" "DeviceKind" NOT NULL,
    "model" TEXT NOT NULL,
    "serial" TEXT,
    "devEui" TEXT,
    "lat" DOUBLE PRECISION,
    "lon" DOUBLE PRECISION,
    "heightM" DOUBLE PRECISION,
    "depthCm" INTEGER,
    "installedAt" TIMESTAMP(3),
    "tokenHash" TEXT NOT NULL,
    "mapping" JSONB,
    "notes" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoundDetection" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "species" TEXT NOT NULL,
    "scientific" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "detector" TEXT NOT NULL,
    "durationS" DOUBLE PRECISION,

    CONSTRAINT "SoundDetection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AcousticIndex" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "windowS" INTEGER NOT NULL,
    "aci" DOUBLE PRECISION,
    "adi" DOUBLE PRECISION,
    "aei" DOUBLE PRECISION,
    "bio" DOUBLE PRECISION,
    "ndsi" DOUBLE PRECISION,
    "biophony" DOUBLE PRECISION,
    "anthrophony" DOUBLE PRECISION,
    "spl" DOUBLE PRECISION,

    CONSTRAINT "AcousticIndex_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoilReading" (
    "id" BIGSERIAL NOT NULL,
    "deviceId" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "depthCm" INTEGER NOT NULL,
    "vwc" DOUBLE PRECISION,
    "tempC" DOUBLE PRECISION,
    "ec" DOUBLE PRECISION,
    "co2Ppm" DOUBLE PRECISION,
    "fluxUmol" DOUBLE PRECISION,
    "raw" JSONB,

    CONSTRAINT "SoilReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SatelliteObs" (
    "id" BIGSERIAL NOT NULL,
    "placeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "sceneId" TEXT NOT NULL,
    "ndviMean" DOUBLE PRECISION NOT NULL,
    "ndviP10" DOUBLE PRECISION,
    "ndviP90" DOUBLE PRECISION,
    "validFraction" DOUBLE PRECISION NOT NULL,
    "cloudCover" DOUBLE PRECISION,
    "pixelCount" INTEGER NOT NULL,

    CONSTRAINT "SatelliteObs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Reading" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dimension" "Dimension" NOT NULL,
    "direction" "Direction" NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "maturity" INTEGER NOT NULL DEFAULT 0,
    "evidence" JSONB,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Visit" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "kind" "VisitKind" NOT NULL,
    "verifier" TEXT,
    "findings" JSONB,
    "notes" TEXT,

    CONSTRAINT "Visit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" "KeyRole" NOT NULL,
    "keyHash" TEXT NOT NULL,
    "placeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "placeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Place_slug_key" ON "Place"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Device_devEui_key" ON "Device"("devEui");

-- CreateIndex
CREATE UNIQUE INDEX "Device_tokenHash_key" ON "Device"("tokenHash");

-- CreateIndex
CREATE INDEX "Device_placeId_idx" ON "Device"("placeId");

-- CreateIndex
CREATE INDEX "SoundDetection_deviceId_ts_idx" ON "SoundDetection"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "SoundDetection_species_idx" ON "SoundDetection"("species");

-- CreateIndex
CREATE INDEX "AcousticIndex_deviceId_ts_idx" ON "AcousticIndex"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "SoilReading_deviceId_ts_idx" ON "SoilReading"("deviceId", "ts");

-- CreateIndex
CREATE INDEX "SatelliteObs_placeId_date_idx" ON "SatelliteObs"("placeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "SatelliteObs_placeId_sceneId_key" ON "SatelliteObs"("placeId", "sceneId");

-- CreateIndex
CREATE UNIQUE INDEX "Reading_placeId_period_dimension_key" ON "Reading"("placeId", "period", "dimension");

-- CreateIndex
CREATE INDEX "Visit_placeId_date_idx" ON "Visit"("placeId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "Job_status_createdAt_idx" ON "Job"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Device" ADD CONSTRAINT "Device_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoundDetection" ADD CONSTRAINT "SoundDetection_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AcousticIndex" ADD CONSTRAINT "AcousticIndex_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoilReading" ADD CONSTRAINT "SoilReading_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SatelliteObs" ADD CONSTRAINT "SatelliteObs_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Reading" ADD CONSTRAINT "Reading_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Visit" ADD CONSTRAINT "Visit_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Job" ADD CONSTRAINT "Job_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;

