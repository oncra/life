---
title: "The soil's water loop"
summary: "What the Cycling reading takes from the node's own soil probes with nobody visiting, tested on twelve years of the Twente soil moisture network: what it sees, how much it moves where nothing changed, and the thresholds that follow."
order: 14.5
---

# The soil's water loop

Method `cycling-v0.3`. The rule is in the [specification](spec.md), section 3.5; the code is `src/lib/soilwater.ts`; every number on this page comes from `scripts/soil-noise/run.ts` and can be reproduced from open data.

## The question

A Life Node has two soil probes, at 10 and 30 cm, that read moisture and temperature. A CO2 probe in the soil is hard to keep working in a field ([hardware](hardware.md)), and a lab sample needs someone to visit. Can the two probes on their own say whether the living part of the soil is changing?

## The number

On a dry day, two days or more after rain, the water that leaves the top 40 cm between one morning and the next is mostly water that roots draw up for the plants to transpire. That is the soil water balance method, one of the ways compared by Guderle and Hildebrandt (2015, doi 10.5194/hess-19-409-2015) for estimating root water uptake from probe readings. Divided by the day's reference evaporation (Makkink, from KNMI), it becomes the share of the weather's demand that the living cover meets from the top 40 cm. Call it **uptake**.

- The water in the top 40 cm is read once a morning: the mean of the readings in the first hour of the core listening window (civil dawn from March to October), 200 mm of soil per probe.
- A day counts when no rain fell in the 48 hours before the first morning or between the two mornings (0.3 mm at most), and the reference evaporation was 1 mm or more.
- A growing season (April to September) needs ten such days; its value is their median.
- Morning to morning, never morning to evening: the two readings are taken at nearly the same soil temperature, and a capacitance probe reads a little differently in warm soil.

## The test data

The Twente soil moisture network (van der Velde et al. 2023, doi 10.5194/essd-15-1889-2023; data doi 10.17026/dans-znj-wyg5, CC BY 4.0): 22 stations in the east of the Netherlands, 2009 to 2020, readings every 15 minutes at 5 to 80 cm, calibrated, with quality flags and a flag for every probe that was replaced or moved. The land use of the field next to each station comes from the crop parcel registry, year by year (the data paper's supplement, Table S2). Rain per hour and Makkink evaporation per day come from the nearest of the KNMI stations Twenthe, Hupsel and Heino.

Each station was read the way a node reads its probes: only the first hour of the core listening window, 10 cm as the upper layer and the mean of 20 and 40 cm as the lower. Readings flagged as anything other than normal were left out, and so was every season in which a probe was replaced or moved. That leaves 126 station seasons.

## What it sees

| Land use next to the station | Seasons | Median uptake | Middle half |
| --- | --- | --- | --- |
| Permanent grass | 92 | 0.60 | 0.39 to 0.76 |
| Maize | 21 | 0.38 | 0.28 to 0.49 |
| Cereal | 5 | 0.34 | 0.28 to 0.70 |
| Forest | 5 | 0.34 | 0.32 to 0.34 |

Permanent grass has roots in the top 40 cm from April on and draws a clearly larger share than maize, which covers the ground only from June. The number sees living cover. Trees draw much of their water from deeper down, so under forest the top 40 cm shows less of what the place does.

## How much it moves where nothing changed

The change between seasons at stations whose land use stayed the same, with no probe replaced or moved:

| Comparison | Pairs | Standard deviation | 90th percentile |
| --- | --- | --- | --- |
| One season against the one before | 72 | 0.22 | 0.41 |
| The last two seasons against the two before | 25 | 0.19 | 0.29 |
| Three against three | 5 | 0.15 | 0.20 |

A field where nothing changed moves from one year to the next about as much as grass differs from maize. Mowing dates, the droughts of 2018 and 2019, a shower the KNMI station did not catch and the farmer's own choices all move it. The thresholds are the 90th percentiles: a place where nothing changed reads holding in nine comparisons out of ten.

## What did not work

- **The share of a shower the soil still holds the next morning** (5 mm or more, dry the day before) was the second candidate. It did not tell grass from maize (medians 0.40 and 0.48) and moved nearly three times as much from year to year (standard deviation 0.62). It is left out. On these sandy soils the rain soaks in everywhere, and what the probes see is mostly how wet the soil already was.
- **Comparing with the neighbours.** Taking off the median of the other stations with the same land use in the same year did not make the number any stiller (standard deviation 0.23 against 0.22). The movement belongs to the field, not to the weather the fields share, so for this number more nodes in a region do not sharpen the reading at one place.
- **Other choices of rule** (a dry day at all three KNMI stations, 24 or 72 hours dry, May to August only, evaporation of 2 mm or more, wet days only, the ratio of the sums, 10 cm only, 20 to 40 cm only, twenty days or more) were none clearly better: `scripts/soil-noise/explore-uptake.ts` and `explore.ts`. The lower layer alone did a little better on signal against noise (1.15 against 1.01), well within what chance gives on 72 pairs, so the rule fixed before the test stays.
- **How fast the soil dries out after rain** is the same number once it is divided by the day's evaporation; it is not a third one.

## What follows for the reading

- **One season against the one before**: rising or falling beyond 0.41, confidence 0.2. **From four complete seasons**: the last two against the two before, beyond 0.29, confidence 0.25.
- Both stay under the verdict's bar of 0.3 on purpose. With a signal about the size of the noise, the water loop can say which way a place is going but cannot make the verdict "declining" on its own.
- It is a slow and coarse sensor. By the spread above, a change the size of grass to maize (0.22) crosses the two-season threshold about one time in three. It will catch a field going from year-round cover to bare soil in spring over a few years; it will not catch a subtle change in soil life within one or two.
- The weather comes from the nearest KNMI station within 40 km, so the water loop works in the Netherlands; elsewhere the reading says it has no weather source until ERA5-Land is added.
- A probe replaced or moved starts a new series. On ploughed land, where the node is lifted every year, every season is a new start in practice ([kit](kit.md)).
- Lab samples and a CO2 flux probe stay in the method as optional, stronger sources (specification 3.5). Nobody has to visit for the reading to work.

## What comes next

1. **Per unit of green.** Divide uptake by the place's Sentinel-2 greenness on the same days, so that mowing and the stage of the crop drop out and what remains is how much water the roots get per unit of green canopy. Testable on the Twente stations for 2016 to 2020.
2. **Calibration places.** At a few places per soil type, a lab sample (24 h CO2 burst and POXC) and an earthworm count once a year for a few years, to see whether uptake follows soil life within the same land use. Once, to fix the method; not a yearly visit everywhere.
