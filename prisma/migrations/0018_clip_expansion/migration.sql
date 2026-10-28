-- A bat clip is kept slowed down (time expansion), so its calls can be heard and drawn; how many times slower it plays.
ALTER TABLE "Clip" ADD COLUMN "expansion" INTEGER;
