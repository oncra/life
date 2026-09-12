---
title: "Specification v0.1"
summary: "Data model, the seven readings with their exact rules, the verdict, confidence and maturity, the API, and what is specified but not yet built."
order: 2
---

# Life oracle specification, version 0.1

Status markers: **built** (runs on life.oncra.org today), **specified** (agreed rule, not yet implemented), **open** (needs a decision).

## 1. Unit of assessment

A **place** is a polygon (GeoJSON Polygon or MultiPolygon, WGS84), from one hectare up to 100,000 hectares. Every reading is about a place and a **period**. Periods are calendar quarters (`2026-Q3`); readings are recomputed whenever new data arrives and at least daily. Actions, projects and people are attributed in a separate layer (specified), the way carbon methodologies separate measurement from additionality. **Built.**

## 2. Streams

### 2.1 Satellite (built)

Source: Copernicus Sentinel-2 Level-2A surface reflectance, via the Earth Search STAC API (Element 84) over the public `sentinel-cogs` bucket. No account. For each scene intersecting the place with cloud cover under 70%:

- read the red (B04), near-infrared (B08) and scene classification (SCL) windows covering the polygon, straight from the cloud-optimised GeoTIFFs with HTTP range requests;
- keep pixels whose centre is inside the polygon and whose SCL class is 4 (vegetation), 5 (not vegetated), 6 (water) or 7 (unclassified); drop clouds, shadows, snow, saturated and no-data;
- detect the additive reflectance offset empirically (1st-percentile DN at or above 900 means the baseline 04.00 offset of 1000 is present) rather than trusting metadata, because mirrors differ;
- compute NDVI per pixel, store mean, 10th and 90th percentile, valid fraction, pixel count, scene id and date;
- require at least 50% valid pixels and at least 3 pixels, else skip the scene.

Backfill covers seven years on registration (enough to contain the 2018, 2020 and 2022 European droughts); updates run every six hours for the last 45 days. Specified, not built: inward buffer of one pixel against boundary mixing; solar-day de-duplication where two tiles cover the same field; kNDVI, NDWI and NDMI; Landsat and HLS for the 1984 archive; Sentinel-1 backscatter as a soil-moisture and structure proxy.

### 2.2 Sound (built: ingest; specified: server-side indices)

A **device** of kind SOUND delivers either or both of:

- **detections**: `{ts, species, scientific?, confidence 0..1, detector, durationS?}`. Species strings follow the detector's label set (BirdNET common names for birds; BattyBirdNET or BatDetect2 for bats; your own labels for insects, frogs, machines). Machine classes (engine, vehicle, siren, chainsaw, tractor) are recognised by name for the Autonomy reading.
- **acoustic indices** over a window: `{ts, windowS, aci, adi, aei, bio, ndsi, biophony, anthrophony, spl}` as defined in scikit-maad.

Raw audio is never uploaded to the oracle. Processing happens at the edge (BirdNET-Pi, BirdWeather PUC) or on the installer's computer (AudioMoth SD cards through BirdNET-Analyzer). Specified: the oracle publishes reference container images so that the same audio gives the same detections everywhere.

### 2.3 Soil (built)

A device of kind SOIL delivers `{ts, depthCm, vwc %, tempC, ec µS/cm, co2Ppm?, fluxUmol?}`. LoRaWAN devices deliver through The Things Stack webhooks to `/api/v1/ingest/ttn`; decoded payloads from Dragino, Milesight, Seeed SenseCAP and Decentlab are recognised automatically, and a per-device `mapping` overrides the heuristics.

### 2.4 Visits (built: storage; specified: scheduler)

A **visit** is `{date, kind BASELINE|RANDOM|TRIGGERED, verifier, findings, notes}`. Specified: 5% of places per year drawn by a public random beacon (drand or the NIST beacon), plus a visit for every place whose streams disagree (see 4.2). Findings carry soil cores, eDNA results, insect counts and photos.

## 3. The seven readings

Every reading returns `direction ∈ {RISING, HOLDING, FALLING, UNKNOWN}`, `confidence ∈ [0,1]`, `maturity ∈ ℕ` (consecutive periods with the same direction) and an `evidence` object with the numbers the direction was derived from. The rules below are deliberately simple and are the thing to argue with.

### 3.1 Productivity (built)

Growing-season mean NDVI per year (April to September in the north, October to March in the south), seasons with fewer than 4 clear observations discarded. Needs three complete seasons. Direction: last season minus the median of the previous three; above +0.03 rising, below −0.03 falling, else holding. Confidence = 0.4 × min(1, observations/10) + 0.4 × min(1, seasons/5) + 0.2. Maturity: consecutive seasons with the same sign against their own trailing median.

### 3.2 Diversity (built)

Distinct species with detection confidence ≥ 0.7 per calendar year. Needs two years. Relative change above +10% rising, below −10% falling. Confidence 0.5 until recorder-uptime and listening-hours normalisation is in place (specified: richness per 100 listening hours, rarefied).

### 3.3 Structure (built)

Median NDSI (biophony minus anthrophony, normalised) per year from delivered indices. Needs two years. Change above +0.05 rising, below −0.05 falling. Specified: ADI/AEI trend, and a canopy-structure component from Sentinel-1 and lidar where available.

### 3.4 Renewal (built)

Count of detections in the breeding window (April to June north, October to December south) per year. Needs two years. Relative change ±15%. Specified: restrict to song rather than calls where the detector distinguishes them; add seedling and juvenile observations from visits.

### 3.5 Cycling (built)

Soil breathing index per reading: Q10 temperature response with Q10 = 2 referenced at 10 °C, multiplied by a moisture hump peaking at 30% VWC and reaching zero at 5% and 55%. Annual mean of the index; needs two years; relative change ±10%. Specified: replace the hump with a soil-texture-specific curve once texture is known; use EC trend as a nutrient-leakage signal; use Sentinel-1 soil moisture as a second witness.

### 3.6 Resilience (built, single-place form)

From the satellite archive: a shock is a growing season more than 15% below the place's own multi-year median. Recovery time is the number of years until a season returns to within 5% of that median. Needs two shocks. Direction: recovery time shortening rising, lengthening falling, equal holding; a shock with no recovery yet is falling. Confidence 0.4 until the neighbour crowd is applied. Specified: compute the same for the regional crowd (all places, or all fields from public parcel registries, on the same soil type within 25 km) and judge the place's drop and recovery relative to the crowd's; add the acoustic check (sound returning with greenness).

### 3.7 Autonomy (built)

Machine-noise signal per year: summed anthrophony from indices plus count of machine-class detections. Needs two years. Less machine noise is rising (±15%). Specified: inputs and subsidies per hectare from steward declarations, cross-checked against satellite-detected field operations.

### 3.8 Humans in the place (specified)

Regional statistics (population continuity, children, health) enter Diversity, Renewal and Resilience as one more population. Not an eighth axis.

## 4. Verdict, confidence, disagreement

### 4.1 Verdict (built)

`declining` if any reading is FALLING with confidence ≥ 0.3. Else `insufficient` if any reading is UNKNOWN. Else `thriving` if every confidence ≥ 0.6 and at least one reading is RISING. Else `holding`.

### 4.2 Disagreement (specified)

Streams disagree when, in the same period, Productivity rises while Diversity or Structure falls, or Cycling rises while Productivity falls, or a carbon claim exceeds what the life readings support. Disagreement lowers the confidence of the involved readings by 0.2 and schedules a TRIGGERED visit.

### 4.3 Maturity (built)

Consecutive periods with the same direction. Users who pay on verdicts are expected to weight by maturity.

## 5. Carbon coupling (specified)

Carbon change per field per season is estimated as a range from satellite capture, soil breathing and detected removals, calibrated once per soil type against cores. Sampling intensity for any carbon claim is set by agreement: all life readings rising or holding → light (one core set per soil type per decade); any life reading falling or unknown → full methodology sampling. Credits issue for the lower bound of the range and release as the range narrows with maturity.

## 6. Self-audit (specified)

Every method version is identified (`v0.1`). Readings carry the version. Places judged in a version are revisited at +5 and +10 years with full sampling; the gap between verdict and outcome is published per version as the drift ledger.

## 7. Roles and keys (built)

| Role | Can | Key |
| --- | --- | --- |
| Admin | everything; create keys | `ADMIN_API_KEY` (env) or an ADMIN key |
| Steward | register places, update their own, register devices, recompute | `lo_key_…` scoped to a place (or unscoped) |
| Verifier | file visits, recompute | `lo_key_…` VERIFIER |
| Consumer | read (everything public is readable without a key; a CONSUMER key is for rate limits and attribution later) | `lo_key_…` |
| Device | deliver data for itself only | `lo_dev_…` |

Keys are stored hashed (SHA-256). Specified: magic-link login for stewards and verifiers, organisations, and per-place sharing.

## 8. Data model (built)

`Place`, `Device`, `SoundDetection`, `AcousticIndex`, `SoilReading`, `SatelliteObs`, `Reading`, `Visit`, `ApiKey`, `Job`. Postgres (PostGIS image so spatial queries can be added without migration of the engine). Geometry is stored as GeoJSON; centroid and area are precomputed. The schema is in `prisma/schema.prisma`; migrations are hand-reviewed SQL.

## 9. API (built)

See [API](/docs/api) and `/api/v1/openapi.json`.

## 10. Global scale

Nothing in the satellite path is specific to the Netherlands: Sentinel-2 covers all land, the STAC search takes any polygon, UTM zones are read from the scene. The growing-season rule flips by hemisphere. Open: tropics without a dry season need a different season rule (phenology from the curve itself rather than a calendar window); deserts and tundra need the neighbour-crowd reference before Productivity means anything. The sound and soil protocols are frequency-agnostic (LoRaWAN regional plans differ; the webhook does not care).

## 11. Open questions

- Season rule for the tropics (see 10).
- Weighting of human-population signals without making them tradeable.
- Which public random beacon for the visit draw.
- Whether to publish per-pixel NDVI or only per-place statistics (privacy of stewards versus reproducibility). Current: per-place statistics, raw scenes are public anyway.
