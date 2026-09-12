-- Place.context: static reference layers fetched from open sources (SoilGrids etc.)
ALTER TABLE "Place" ADD COLUMN "context" JSONB;
