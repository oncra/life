-- Common names of a species in the languages the sites show (en, nl, de, fr, es, zh), from Wikidata, so a page in
-- Dutch can say "Zwarte kraai" where the detector says "Carrion Crow". Filled by the worker once per species.
ALTER TABLE "SpeciesImage" ADD COLUMN "names" JSONB;
