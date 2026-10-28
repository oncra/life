-- Sound clips of detections, kept so people can check by ear whether the detector was right (/triage), and their
-- verdicts. Only from a node on the bench; the sound file goes after CLIP_KEEP_DAYS, the row and the verdicts stay.
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "deviceId" TEXT NOT NULL,
    "detectionRef" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "scientific" TEXT NOT NULL,
    "species" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "band" TEXT,
    "detector" TEXT,
    "source" TEXT,
    "clipS" DOUBLE PRECISION,
    "fromS" DOUBLE PRECISION,
    "toS" DOUBLE PRECISION,
    "file" TEXT,
    "mime" TEXT,
    "bytes" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Clip_deviceId_detectionRef_key" ON "Clip"("deviceId", "detectionRef");
CREATE INDEX "Clip_deviceId_scientific_idx" ON "Clip"("deviceId", "scientific");
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ClipReview" (
    "id" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "actual" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipReview_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClipReview_clipId_userId_key" ON "ClipReview"("clipId", "userId");
ALTER TABLE "ClipReview" ADD CONSTRAINT "ClipReview_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ClipReview" ADD CONSTRAINT "ClipReview_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- per month, species and score band: the detections the node's sampler saw and the clips it kept from them
CREATE TABLE "ClipBand" (
    "deviceId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "scientific" TEXT NOT NULL,
    "band" TEXT NOT NULL,
    "detections" INTEGER NOT NULL,
    "kept" INTEGER NOT NULL,
    "asOf" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClipBand_pkey" PRIMARY KEY ("deviceId","month","scientific","band")
);

ALTER TABLE "ClipBand" ADD CONSTRAINT "ClipBand_deviceId_fkey" FOREIGN KEY ("deviceId") REFERENCES "Device"("id") ON DELETE CASCADE ON UPDATE CASCADE;
