---
title: Satellite stream: how it is computed
summary: Exactly what the oracle does with Sentinel-2 for each place, which free sources it uses, and the gotchas it handles.
order: 10
---

# Satellite stream

## Source

Copernicus **Sentinel-2 Level-2A** (surface reflectance, 10 m), found through the **Earth Search** STAC API run by Element 84 (`https://earth-search.aws.element84.com/v1`, collection `sentinel-2-l2a`) and read from the public `sentinel-cogs` bucket on AWS. No account, no key, no cost. Coverage is global, archive from mid-2015, revisit 2 to 3 days in north-west Europe. A field of 5 ha costs about three HTTP range requests of ~100 kB per scene.

## Per scene

1. Find scenes intersecting the place, cloud cover under 70% (the scene classification does the real work).
2. Read the red (B04), near-infrared (B08) and scene classification (SCL, 20 m) windows that cover the polygon's bounding box, after projecting the polygon into the scene's UTM zone (read from the item, never assumed).
3. Keep pixels whose centre is inside the polygon and whose SCL class is vegetation, not-vegetated, water or unclassified (4, 5, 6, 7). Drop no-data, saturated, shadows, clouds, cirrus, snow.
4. Detect the reflectance offset. Since processing baseline 04.00 (January 2022) ESA adds 1000 to every digital number; some mirrors remove it again but still advertise it in metadata. NDVI is a ratio and an additive offset ruins it, so we look at the data: if the 1st-percentile DN inside the window is at or above 900 the offset is present and subtracted.
5. NDVI = (NIR − red) / (NIR + red) per pixel; store mean, 10th and 90th percentile, valid fraction, pixel count.
6. Skip the scene if fewer than 50% of the polygon's pixels are clear.

## Per place

- Backfill seven years on registration; update the last 45 days every six hours.
- Growing-season mean per year (April to September in the north; October to March in the south) feeds **Productivity**.
- Shocks (a season more than 15% under the place's own median) and recovery times feed **Resilience**.

## Layers on the map

- Basemap: **Sentinel-2 cloudless 2025** by EOX (CC BY-NC-SA; attribution shown) and OpenStreetMap.
- **ESA WorldCover 2021** land cover (CC BY 4.0) via Terrascope WMTS.
- **MODIS Terra NDVI 16-day** from NASA GIBS as a global greenness context layer, colour-mapped for display only.

## Known limits and what comes next

- Two tiles can cover the same field on the same day; both are stored. Solar-day de-duplication is specified.
- No inward buffer yet: a pixel straddling the boundary mixes the neighbour in. One-pixel erosion is specified.
- Only NDVI. kNDVI (tanh of NDVI squared, less saturation in dense canopies), NDWI and NDMI are specified.
- The calendar season rule fails in the tropics; phenology-derived seasons are an open question.
- Landsat (1984 to 2012) via Planetary Computer or USGS and NASA HLS (2013 onward, 30 m) are the route to a longer archive; both need a free account and are specified.
- Sentinel-1 radar (VV/VH) as a soil-moisture and structure witness is specified.

## Reproduce it yourself

`npm run sat:test` in the repository runs the pipeline on a test field and prints the numbers. The code is `src/lib/satellite.ts`, about 150 lines.
