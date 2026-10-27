---
title: "Specification v0.1"
summary: "Data model, the seven readings with their exact rules, the verdict, confidence and maturity, the API, and what is specified but not yet built."
order: 2
---

# Life Oracle specification, version 0.1

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

- **detections**: `{ts, species, scientific?, confidence 0..1, detector, durationS?}`. Species strings follow the detector's label set (BirdNET common names for birds; BattyBirdNET or BatDetect2 for bats; your own labels for insects, frogs, machines). Where `scientific` is given it is the species' identity: two detections with the same scientific name are the same species, whatever their `species` string. Machine classes (engine, vehicle, siren, chainsaw, tractor) are recognised by name for the Autonomy reading.
- **test detections**: a detection marked `test` was made while the node was built or tested (birdsong played from a phone, a recording held to the microphone). It stays in the database as proof the microphone and the pipeline worked, and it counts nowhere as life: not in any reading, not in the life index, not in the species lists, not in the open data. Only the node's own liveness light on `/box` sees it.
- **acoustic indices** over a window: `{ts, windowS, aci, adi, aei, bio, ndsi, biophony, anthrophony, spl}` as defined in scikit-maad.

**Listening hours (built 2026-10-12, one window length since 2026-10-13).** The readings count detections only inside the listening windows, computed by the oracle for the place's centroid, the same at every place, on every day of a season and in every year:

| Months | Listening windows |
| :-- | :-- |
| March to October | 4 h from civil dawn and 1 h from sunset |
| November to February | 2 h from sunrise |

South of the equator the months are six on. The standard node listens to exactly these windows (`node/image/life-schedule-wpi.py`), so its effort is the same on every day it is compared over: a species count per day, per month or per season means the same number of listening hours. Hours outside the windows, from a recorder that never sleeps or a node on a bench, are kept and shown on the node dashboard but never counted, so a node and a station that listens all day are read on the same hours. A window the node misses because its battery guard has stopped it (below 12.6 V at its scheduler's input, back above 13.2 V; `node/image/life-wittypi.sh`) is a gap in the heartbeats, not a shorter window. The windows can change only with a new version of this method. Until 13 October 2026, before any node had listened to them, the dawn window was 6 h in May, June and July and a node added extra hours when its battery allowed; one length all season was chosen because it is easier to read and leaves the battery more slack, at the small cost shown below.

Why these hours, from two checks run before the first baseline year. A year (2025) of four Dutch BirdWeather stations that record 24 hours a day (small-scale farmland, rural, a wetland reserve and urban green; every second day, confidence 0.7 or more) was replayed against each schedule. These windows hear 85 to 93% of the species those stations hear on at least three days of the full day, and 68 to 81% of them on three days or more; the curve bends at 3 to 4 hours of dawn listening, and the fifth and sixth hour add about the same in every month from March to October. A 6-hour dawn window in May to July would add 1 to 2 points to the first figure, up to 2 to the second and 3 to 6 points to the days a daytime farm bird is heard (a swallow, a wagtail, a lapwing), against a summer day that costs a quarter more energy. The sampling noise of a yearly species count is 2 to 3% at every window length, so shorter windows shorten the list without making it noisier. The battery was simulated hour by hour on PVGIS output for 2005 to 2023 (40 Wp at 45 degrees facing south, 20 Ah LiFePO4, no charging below 0 C): with the panel at half its output all year, or at 30% from June to September as under a crop or a hedge, the node lost no listening from March to October, and at most 3% in the worst winter month of those 19 years, and the battery stayed above half full on all but 0.3% of the days from March to October (with the extra hours of 12 October, 3 to 6%). With the panel at 30% all year it loses 2% in October and 7 to 9% in December and January, a site that needs the 100 W panel.

Raw audio is never uploaded to the oracle. Processing happens at the edge (the standard node runs BirdNET-Go on its own computer), at the device maker (a BirdWeather PUC sends its sound to BirdWeather, which names the birds; the oracle reads only the detections) or on the installer's computer (AudioMoth SD cards through BirdNET-Analyzer). Edge inference is what keeps a node inside a 500 MB ten-year SIM. Built: BirdWeather stations are polled hourly by station id. Specified: the oracle publishes reference container images so that the same audio gives the same detections everywhere. Specified: an export of a place's detections as Camtrap DP with the acoustic additions proposed by the Safe and Sound project, the listening windows as its recording schedule, for publication to GBIF ([the bird protocols](bird-protocols.md), section 4).

**Clips for checking** (decided 19 October 2026; built in the node software, `node/life-clips.py`, not yet in a released image). To give every species its own threshold (3.2), an expert has to hear what the detector heard, so the node keeps a sample of clips on its own card and nothing else. A clip qualifies only when it belongs to a detection of a bird or bat species inside the listening windows, and BirdNET-Go's speech detector (Privacy Guard) drops any detection in which a voice is heard, clip and all. Per species, per month and per score band of 0.1 the node keeps at most five clips, a uniform random sample of that month's detections in that band; every other clip is deleted at the first run after BirdNET-Go has finished writing it (fifteen minutes), and nothing else in its export directory lives longer than half an hour. A clip is as long as BirdNET-Go writes it: 15 seconds by default, never under 10, with the detected three seconds starting 3 seconds in. The node keeps those defaults, because the same two numbers set the window in which BirdNET-Go confirms a detection, and changing them would change what the node reports. So that every score band has detections in it, BirdNET-Go's own threshold goes to 0.1 while clips are kept; what the node sends to the oracle is 0.7 and up, the score Diversity counts from (`LIFE_MIN_CONFIDENCE_FLOOR` in the node's units). The sample leaves the node only by hand, at a visit (2.4): a stick named LIFECLIPS plugged into the node takes a copy with a list of species, score and time per clip, the copy is read back and checked, and only then is the sample deleted from the node; a clip once collected keeps its place in that month's sample, so no more than five per band ever leave; a clip no visit has collected is deleted after twelve months. Nothing of it goes over the 4G link and nothing of it reaches the oracle: checkers label each clip right, wrong or unsure, and only those labels are delivered, into a calibration register (species, device, season, score, label) from which the threshold per species at a precision of 0.95 is computed (logistic regression of the label on the score, after Wood and Kahl 2024). Beside the clips the node writes `bands.csv`: per month, species and score band, how many detections the sampler saw and how many clips it kept, so each checked clip can be weighted by the detections it stands for (built in the node software, 27 October 2026). Specified: checkers do not see the score, unsure counts as wrong wherever money depends on it, and a second checker labels 10 to 20% of the clips with the agreement published ([what it measures](confidence.md), section 2). The place's steward can switch clip keeping off (`LIFE_KEEP_CLIPS=0` in the node's settings: at the next boot export goes off and the threshold back to 0.7, and every clip on the node is deleted); the place's species thresholds then come from other nodes. Until a golden image with `life-clips` is released, nodes keep no clips at all.

### 2.3 Soil (built)

A device of kind SOIL delivers `{ts, depthCm, vwc %, tempC, ec µS/cm, co2Ppm?, fluxUmol?}`. Probes wired into a node are read over Modbus RTU and posted straight to `/api/v1/ingest/soil` with the device token, buffered on disk while the modem is down. LoRaWAN devices deliver through The Things Stack webhooks to `/api/v1/ingest/ttn`; decoded payloads from Dragino, Milesight, Seeed SenseCAP and Decentlab are recognised automatically, and a per-device `mapping` overrides the heuristics.

### 2.3b Context layers (built: SoilGrids; specified: the rest)

At registration and yearly, each place is enriched from open global layers, stored as `place.context` and used by the readings. Built: ISRIC SoilGrids v2.0 at the centroid (clay, sand, silt, organic carbon, pH, bulk density, WRB class; 250 m; CC BY 4.0), setting the Cycling model's moisture optimum from clay fraction. Specified: ETH 10 m canopy height 2020 (Structure witness), Walker et al. potential carbon and Bastin potential tree cover (distance to potential for Productivity and Structure), Hansen tree-cover loss and ESRI 10 m land cover (land-use context), NASA FIRMS and OPERA disturbance alerts (dated shocks for Resilience), RESOLVE ecoregion (neighbour-crowd stratum); for places in the Netherlands, AHN national airborne lidar (0.5 m surface minus terrain model, a flight every ~3 years since 2020: AHN4 2020-2022, AHN5 2023-2025, AHN6 from 2025; open data via PDOK and AHN's sheet index), which replaces the ETH 2020 canopy-height witness there with a measured, repeated one. Rationale and the Restor assessment: [Coupling with Restor](restor.md).

### 2.4 Visits (built: storage; specified: scheduler)

A **visit** is `{date, kind BASELINE|RANDOM|TRIGGERED, verifier, findings, notes}`. Specified: 5% of places per year drawn by a public random beacon (drand or the NIST beacon), plus a visit for every place whose streams disagree (see 4.2). Findings carry soil cores, eDNA results, insect counts and photos; lab results for Cycling go in `findings.soil` (3.5). For birds, the visit is a count by Sovon's farmland protocol (Meetnet Agrarische Soorten): 10 minutes at the node in each of the four spring rounds, the species list in `findings` ([the bird protocols](bird-protocols.md), section 2).

## 3. The seven readings

Every reading returns `direction ∈ {RISING, HOLDING, FALLING, UNKNOWN}`, `confidence ∈ [0,1]`, `maturity ∈ ℕ` (consecutive periods with the same direction) and an `evidence` object with the numbers the direction was derived from. The rules below are deliberately simple and are the thing to argue with.

### 3.1 Productivity (built)

Growing-season mean NDVI per year (April to September in the north, October to March in the south), seasons with fewer than 4 clear observations discarded. Needs three complete seasons. Direction: last season minus the median of the previous three; above +0.03 rising, below −0.03 falling, else holding. Confidence = 0.4 × min(1, observations/10) + 0.4 × min(1, seasons/5) + 0.2. Maturity: consecutive seasons with the same sign against their own trailing median.

### 3.2 Diversity (built)

Distinct species with detection confidence ≥ 0.7 per calendar year, counted from detections inside the listening windows (2.2). A species is its scientific name where the detector gives one, so a bird that arrives under both its common and its scientific name (BirdNET-Go's database keeps only the latter) counts once. Needs two years. Relative change above +10% rising, below −10% falling. Confidence 0.5 until recorder-uptime and listening-hours normalisation is in place (specified: richness per 100 listening hours, rarefied). Specified: a threshold per species at a precision of 0.95, set from clips that experts have checked, replacing the single 0.7 (TABMON's method, after Wood and Kahl 2024), starting with the species of the farmland bird index of the Nature Restoration Regulation (Annex V); and a farmland bird lane on those species, the share of listening minutes each is heard from 1 April to 15 July ([the bird protocols](bird-protocols.md), sections 1 and 3). The threshold is set on the precision of all the detections it lets through, weighted by the node's band counts, fitted per species and stratum with an offset per place and month, and taken at the upper end of its interval; a species with no usable threshold is never counted, and species that cannot be told apart by sound are counted as a group ([what it measures](confidence.md), section 2). Many thresholds will come out below 0.7, so the node has to send detections below it (specified: from 0.1, or counts per species, hour and band, once the data volume is measured against the ten-year SIM).

### 3.3 Structure (built)

Median NDSI (biophony minus anthrophony, normalised) per year from delivered indices. Needs two years. Change above +0.05 rising, below −0.05 falling. Specified: ADI/AEI trend, and a canopy-structure component from Sentinel-1 and lidar where available. Where lidar is AHN (the Netherlands), the component is the change between consecutive flights in canopy cover above 2 m and in height-class diversity (share of the place in 0-2, 2-5, 5-10 and 10+ m), read at the same 0.5 m pixels in both flights. A rise in the taller classes with the lower ones still present reads as layering, the structure a recovering woodland or food forest builds; a loss of the taller classes is a dated shock for Resilience. Two caveats travel with it: AHN is flown in the leafless season, and AHN4 kept the averaged rather than the highest return per pixel, so an AHN4-to-AHN5 change is partly method and gets lower confidence than AHN5-to-AHN6.

### 3.4 Renewal (built)

Count of detections in the breeding window (April to June north, October to December south) per year, inside the listening windows (2.2). Needs two years. Relative change ±15%. Specified: restrict to song rather than calls where the detector distinguishes them; add seedling and juvenile observations from visits.

### 3.5 Cycling (built, method cycling-v0.3)

The question is whether the soil's loops, the part of them that roots and soil life run, are changing, with the weather taken out. Moisture and temperature alone cannot answer it: they say how hard soil life *could* work in this weather. Version 0.1 compared a yearly mean of a moisture-and-temperature index and so read a warm, moist year as rising. Version 0.2 took the direction only from lab samples or a flux probe, which needs a visit or a fragile probe. Version 0.3 adds the water loop, read from the node's own probes with nobody visiting, and keeps the other two as optional, stronger sources. The water loop's rules and the test behind every number: [The soil's water loop](soil-water.md).

**Sources, in order of weight.**
1. *Lab samples from visits* (optional; `findings.soil`: `{depthCm, co2Burst, poxc}`, one object or a list). `co2Burst` is the CO2 released in 24 h after drying and rewetting, mg CO2-C per kg (Franzluebbers et al. 2000, doi 10.2136/sssaj2000.642613x; Solvita or titration, Haney, Brinton and Evans 2008, doi 10.1017/s174217050800224x). `poxc` is permanganate-oxidisable carbon, mg per kg (Weil et al. 2003, doi 10.1079/ajaa200228). Both run under standard lab conditions and track management within a few years (Hurisso et al. 2016, doi 10.2136/sssaj2016.04.0106). Sampling: 0 to 10 cm, a composite of at least ten cores, same month every year. The latest sample is compared with the most recent earlier one at least 300 days before, within 45 days of the same day of the year and at the same depth; the mean relative change of the two indicators gives the direction at ±15% (provisional). Confidence 0.5 when both indicators agree in sign, 0.35 otherwise.
2. *Soil CO2 flux* (optional; `fluxUmol`, µmol CO2 m⁻² s⁻¹, chamber or gradient method; a low-cost gradient system: Nguyen et al. 2025, doi 10.5194/soil-11-639-2025). Each flux is divided by the weather-expected activity at the same moment (below); the yearly mean ratio is the basal rate at 10 °C and optimal moisture. Readings with expected activity below 0.05 are left out; a year needs 30 pairs. Direction from the last two years at ±10%, confidence 0.45.
3. *The water loop* (built, the default; `src/lib/soilwater.ts`). **Uptake**: on dry days (no more than 0.3 mm of rain from 48 h before one morning to the next, reference evaporation 1 mm or more, April to September), the water that leaves the top 40 cm from one morning to the next as a share of the day's Makkink reference evaporation; the season's value is the median of at least ten such days. Water in the top 40 cm is read in the first hour of the core listening window (2.2), 200 mm of soil per probe layer (probes at 15 cm or less, and 15 to 45 cm). Rain per hour and evaporation per day come from the nearest KNMI station within 40 km (`WeatherDay`, `src/lib/weather.ts`). On the Twente soil moisture network (22 stations, 2009 to 2020, read the way a node reads its probes) permanent grass has a median uptake of 0.60 and maize 0.38, while a field where nothing changed moves with a standard deviation of 0.22 from one season to the next. The thresholds are the 90th percentile of that movement: one complete season against the one before, ±0.41, confidence 0.2; from four complete seasons, the mean of the last two against the two before, ±0.29, confidence 0.25. Both confidences stay under the verdict's bar of 0.3 (4.1): at a signal about the size of the noise, the water loop says which way a place is going but cannot make the verdict "declining" on its own. A probe replaced or moved starts a new series.

**Weather-expected activity** (`soilActivity`, used to normalise flux and drawn on the node dashboard; dimensionless, 1 at 10 °C and optimal moisture) = temperature term × moisture term. Temperature: Q10 = 2 referenced at 10 °C; field Q10 of soil respiration has a global median near 2.4 (Raich and Schlesinger 1992, doi 10.1034/j.1600-0889.1992.t01-1-00001.x) and falls as soils warm (Lloyd and Taylor 1994, doi 10.2307/2389824; Davidson and Janssens 2006, doi 10.1038/nature04514). Moisture: aerobic microbial activity peaks near 60% water-filled pore space (Linn and Doran 1984, doi 10.2136/sssaj1984.03615995004800060013x; Skopp, Jawson and Doran 1990, doi 10.2136/sssaj1990.03615995005400060018x); WFPS = VWC / (1 − bulk density / 2.65), bulk density from SoilGrids (2.5); the term is 1 − ((WFPS − 0.6) / 0.6)², floored at 0. Empirical moisture curves are approximations (Moyano, Manzoni and Chenu 2013, doi 10.1016/j.soilbio.2013.01.002), which is why this term only normalises a measurement and never stands in for one.

**Without any of the three** the reading is UNKNOWN and says which is missing (no probe, no weather source, fewer than two complete seasons, or a new series after a probe change).

Tested and left out: the share of a rain shower the top 40 cm still holds the next morning (it did not tell grass from maize on the Twente network and moved nearly three times as much as uptake), taking off the neighbours' median in the same year (it did not reduce the spread: the movement belongs to the field), dividing by the day's green cover from Sentinel-2 (noisier on 2018 to 2020), and reading the share at a fixed wetness (noisier). Specified: calibration places with lab samples and earthworm counts per soil type; a soil-sound witness (a contact microphone in the ground, recorded in the listening windows) beside the reading, not in it; ERA5-Land weather outside the Netherlands; flux from `co2Ppm` at two depths; EC trend as a nutrient-leakage signal. Considered and not adopted: the Tea Bag Index (Keuskamp et al. 2013, doi 10.1111/2041-210x.12097), because its decomposition rate is disputed (Mori 2025, doi 10.1111/ele.70010; reply Sarneel et al. 2025, doi 10.1111/ele.70117) and the original bags changed (Middelanis et al. 2023, doi 10.1111/1440-1703.12409).

### 3.6 Resilience (built, single-place form)

From the satellite archive: a shock is a growing season more than 15% below the place's own multi-year median. Recovery time is the number of years until a season returns to within 5% of that median. Needs two shocks. Direction: recovery time shortening rising, lengthening falling, equal holding; a shock with no recovery yet is falling. Confidence 0.4 until the neighbour crowd is applied. Specified: compute the same for the regional crowd (all places, or all fields from public parcel registries, on the same soil type within 25 km) and judge the place's drop and recovery relative to the crowd's; add the acoustic check (sound returning with greenness).

### 3.7 Autonomy (built)

Machine-noise signal per year: summed anthrophony from indices plus count of machine-class detections inside the listening windows (2.2). Needs two years. Less machine noise is rising (±15%). Specified: inputs and subsidies per hectare from steward declarations, cross-checked against satellite-detected field operations.

### 3.8 Humans in the place (specified)

Regional statistics (population continuity, children, health) enter Diversity, Renewal and Resilience as one more population. Not an eighth axis.

## 4. Verdict, confidence, disagreement

### 4.1 Verdict (built)

`declining` if any reading is FALLING with confidence ≥ 0.3. Else `insufficient` if any reading is UNKNOWN. Else `thriving` if every confidence ≥ 0.6 and at least one reading is RISING. Else `holding`.

### 4.2 Disagreement (specified)

Streams disagree when, in the same period, Productivity rises while Diversity or Structure falls, or Cycling rises while Productivity falls, or a carbon claim exceeds what the life readings support. Disagreement lowers the confidence of the involved readings by 0.2 and schedules a TRIGGERED visit.

### 4.3 Maturity (built)

Consecutive periods with the same direction. Users who pay on verdicts are expected to weight by maturity.

## 5. Carbon coupling (built: v0.1 inference; specified: calibration and gate)

Built: a yearly net ecosystem carbon balance per place as a low/central/high range (`src/lib/carbon.ts`, `GET /api/v1/places/{id}/carbon`): NPP from monthly fAPAR (from NDVI) × PAR climatology × light-use efficiency by vegetation class, GPP→NPP 0.45 to 0.55; heterotrophic respiration from a reference rate by vegetation class × Q10 (1.8 to 2.4) × moisture hump with texture-dependent optimum, integrated from the soil stream or, without a probe, from a soil-temperature climatology; harvest export as a land-use fraction of NPP. Low/high are the corners of the parameter box; issuable = max(0, low) × area. Method and a worked example on two Oncra projects: [How carbon is inferred](carbon.md). Specified: per-place calibration of the light-use efficiency against cores at two depths once per soil type; declared yields and imports; manure; the sampling gate: all life readings rising or holding → light (one core set per soil type per decade); any life reading falling or unknown → full methodology sampling. Credits issue for the lower bound and release as the range narrows with maturity.

## 5b. Measurement rules (built as constraints on every stream)

Nine rules that govern any model or statistic this oracle uses. They are written down because the largest working
precedent for paying land stewards on remote sensing, Rabobank's Acorn programme, was found by its own auditors to
break several of them, twice, in public. The evidence is in [Prior art](prior-art.md); these are the rules we took
from it.

1. **Never credit a change smaller than the instrument error.** If the uncertainty of a quantity exceeds the change
   being claimed in it, the answer is a range whose lower bound is what issues, and a range spanning zero issues
   nothing. No deduction factor substitutes for this.
2. **Normalise error by the mean, not the range.** An error normalised by the spread of the calibration set can hide an
   absolute error many times the value being measured on small places.
3. **Validate spatially blocked.** Hold out whole regions, never random plots. Models of this class routinely explain
   most of the variance under ordinary cross-validation and almost none once the held-out data are spatially
   independent (Ploton et al. 2020). Our neighbour-crowd reference is a spatial construct and would inherit the same
   illusion.
4. **Use prediction error, not the standard error of the mean.** Dividing residual spread by the square root of the
   sample understates per-place uncertainty and rewards adding calibration points over improving the model.
5. **No confidence gate that is cosmetic at realistic uncertainty.** If a gate does not bite at the uncertainty actually
   observed, it is decoration. Gates are tested against the real error distribution before they ship.
6. **Never apply a model outside the stratum it was calibrated in.** No adjacency exemption.
7. **Publish money paid per steward per season, never stewards enrolled.** Enrolment is a vanity metric.
8. **A visit that is not reproducible is not ground truth.** Visits follow a written sampling procedure, by trained
   observers, with a second observer on a fraction of them.
9. **Before any payment flows in a country, establish what the state claims.** Check for an overlapping national
   programme and obtain a letter of no objection. Rights to an outcome can already be spoken for.

What we do adopt from the same precedent, because it is what makes cheap verification possible at all: **calibrate the
stratum rather than the site**, and **audit a sample of the programme rather than every place every year**. Those are
the neighbour crowd and the random draw in this design.

### 5c. What this instrument cannot yet claim

Stated here rather than left for a reviewer to find.

**Species identification is not payment-grade.** Published European evaluations of the bird-recognition software this design uses report a best F-score of roughly 0.40 to 0.52 at recording level and about 0.33 per vocalisation, and at a common confidence threshold report tens of species correctly detected against a larger number falsely detected. Administrative payment systems in Europe work to roughly 5% false positives and 10 to 20% false negatives (for satellite checks of eligibility conditions against field visits; Devos et al. 2018, JRC112918). Acoustic species identification is around a factor of two away from that bar.

This is survivable for what the oracle actually claims, and fatal for what it does not claim. The readings are **directions over seasons, compared against the same place's history and against a crowd of neighbours recorded with the same equipment**. Errors that are stable across time and across neighbours largely cancel in that comparison, which is why one microphone type must be frozen across a network. What cannot be claimed on this evidence alone is a species list, a count, or a per-detection assertion about any individual place. [What it measures](confidence.md) sets out what each of those claims would need: a checked clip makes a species' presence verifiable, a calibration register across nodes makes it a probability, and only point counts beside many nodes make a number of birds. Until that register exists, Diversity is a direction, not an inventory.

**No government anywhere currently pays on acoustic or sensor evidence**, and we found no biodiversity credit issued on it either (Plan Vivo, whose nature standard accepts sound recorders, expects its first certificates in 2028). The nearest precedent is the European agricultural monitoring system, which accepts satellite data "or other data with at least equivalent value" and admits geotagged photographs, and which verifies eligibility rather than ecological outcomes. There is no precedent for this and we should not imply one.

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

See [API](api.md) and `/api/v1/openapi.json`.

## 10. Global scale

Nothing in the satellite path is specific to the Netherlands: Sentinel-2 covers all land, the STAC search takes any polygon, UTM zones are read from the scene. The growing-season rule flips by hemisphere. Open: tropics without a dry season need a different season rule (phenology from the curve itself rather than a calendar window); deserts and tundra need the neighbour-crowd reference before Productivity means anything. The sound and soil protocols are frequency-agnostic (LoRaWAN regional plans differ; the webhook does not care).

## 11. Open questions

- Season rule for the tropics (see 10).
- Weighting of human-population signals without making them tradeable.
- Which public random beacon for the visit draw.
- Whether a node should also keep a few short windows of sound that no detection triggered, so that a checker can count what the detector missed. That needs a speech check on the windows themselves. Until then, misses are read from the MAS counts at visits (2.4).
- How one fixed node per field fits a biodiversity standard that re-draws its sampling points at random every year (Plan Vivo PV Nature).
- Whole nights for bats within the power budget: the evening hour is a dusk index and misses the late species ([what it measures](confidence.md), section 6).
- Whether to publish per-pixel NDVI or only per-place statistics (privacy of stewards versus reproducibility). Current: per-place statistics, raw scenes are public anyway.
