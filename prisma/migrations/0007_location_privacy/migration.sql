-- A place can hide its exact location. The public then sees a circle whose centre is moved a random distance
-- from the true centroid, drawn once and stored, so that repeated requests cannot be averaged back to the truth.
ALTER TABLE "Place" ADD COLUMN "locationHidden" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Place" ADD COLUMN "blurLat" DOUBLE PRECISION;
ALTER TABLE "Place" ADD COLUMN "blurLon" DOUBLE PRECISION;
ALTER TABLE "Place" ADD COLUMN "blurRadiusM" INTEGER;
