-- Weather at a place, one row per UTC day, for the Cycling water loop (content/spec.md 3.5): rain per hour and
-- Makkink reference evaporation from the nearest KNMI station. Only places with a soil probe get rows.
CREATE TABLE "WeatherDay" (
    "placeId" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "rainHourly" JSONB NOT NULL,
    "et0" DOUBLE PRECISION,
    "source" TEXT NOT NULL,

    CONSTRAINT "WeatherDay_pkey" PRIMARY KEY ("placeId","day")
);

ALTER TABLE "WeatherDay" ADD CONSTRAINT "WeatherDay_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
