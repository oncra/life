-- Detections made while a node was built or tested (birdsong played from a phone on the desk, a recording held to the
-- microphone) stay in the database as proof the box worked, but count nowhere as life.
ALTER TABLE "SoundDetection" ADD COLUMN "test" BOOLEAN NOT NULL DEFAULT false;
