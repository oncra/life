-- A cut-out picture per species heard, made once by the worker from the lead photo of the species' Wikipedia
-- article (Wikimedia Commons, credits kept) with the background removed, shown on the node dashboard.
CREATE TABLE "SpeciesImage" (
    "id" TEXT NOT NULL,
    "species" TEXT NOT NULL,
    "scientific" TEXT,
    "title" TEXT,
    "sourceUrl" TEXT,
    "author" TEXT,
    "license" TEXT,
    "licenseUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "image" BYTEA,
    "width" INTEGER,
    "height" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SpeciesImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SpeciesImage_species_key" ON "SpeciesImage"("species");
