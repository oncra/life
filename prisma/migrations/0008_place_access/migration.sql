-- People who may see a place exactly and, later, follow its readings day to day, without owning a Life Box on it
-- (yet): the landholder of a place that was registered for them.
CREATE TABLE "PlaceAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'owner',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PlaceAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PlaceAccess_userId_placeId_key" ON "PlaceAccess"("userId", "placeId");
CREATE INDEX "PlaceAccess_placeId_idx" ON "PlaceAccess"("placeId");
ALTER TABLE "PlaceAccess" ADD CONSTRAINT "PlaceAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlaceAccess" ADD CONSTRAINT "PlaceAccess_placeId_fkey" FOREIGN KEY ("placeId") REFERENCES "Place"("id") ON DELETE CASCADE ON UPDATE CASCADE;
