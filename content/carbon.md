---
title: "How carbon is inferred"
summary: "Net ecosystem carbon balance as a yearly range from the three streams, credits issued for the lower bound, and a worked example on two Oncra land projects: Horaholm and Boer in Natuur."
order: 4
---

# How carbon is inferred

Version 0.1 of the method. A range, never a point. Not an issuance: the numbers below say what the streams support, and the registry decides what to do with that. The parameters are placeholders for north-west Europe until soil cores and flux measurements have been used to fit them; they sit in one file (`src/lib/carbon.ts`) so a method change is one diff.

## The balance

Carbon in the soil and vegetation of a place changes by what plants capture, minus what the soil breathes out, minus what leaves in the harvest:

```
net change  =  NPP  −  soil breathing (Rh)  −  export  (+ imports)
```

Each of the three terms comes from a stream the oracle already has, and each carries a low and a high value.

**NPP from the satellite.** Greenness (NDVI) per scene, averaged inside the boundary, gives the fraction of sunlight the canopy absorbs (fAPAR ≈ 1.24 × NDVI − 0.17). Multiply by the light that arrived that month (a long-term monthly radiation table for the Netherlands, 45% of it photosynthetically active) and by a light-use efficiency (1.6 to 2.4 g C per MJ for crops and grass), sum over the year, halve for the plant's own respiration. Months without a clear scene are interpolated across short gaps and the total is scaled for months not seen; a year with fewer than eight months seen is not computed.

**Soil breathing from the probe.** Heterotrophic respiration is a reference rate at 10 °C and optimum moisture (3.0 to 5.0 t C per hectare per year in temperate cropland), scaled every reading by the Q10 temperature response (Q10 1.8 to 2.4) and by the moisture hump, whose optimum is set from the SoilGrids clay fraction of the place. With a probe the scaling is integrated over the year's readings. Before a probe exists it comes from a monthly soil-temperature climatology, and the method says so.

**Export by land use.** The carbon that leaves as harvest, as a fraction of NPP: arable 35 to 55%, grassland and peat meadow 25 to 45%, orchard 10 to 25%, agroforestry 8 to 20%, food forest 5 to 15%, forest and wetland under 10%. A steward's declaration of yields replaces the default; manure and compost imports are added when declared.

**The range.** The low end of the net change is the low NPP minus the high breathing minus the high export; the high end is the reverse. Multiply by 44/12 for CO₂ and by the area for the place.

## Issue for the lower bound

Credits are issued for the bottom of the range, per year, never for the middle. A year whose lower bound is negative issues nothing. As the streams keep agreeing over more seasons, the parameter box narrows (a probe replaces the climatology, declared yields replace the default fraction, cores per soil type replace the reference rate) and the lower bound rises, so more releases from the same place. Uncertainty costs the claimant time, not laboratory fees, and rewards keeping the place alive for years.

## Let life set the sampling burden

The carbon range never travels alone. The seven life readings sit next to it, and the rule from the green paper applies: when the life readings are rising or holding and agree with the carbon claim, the claim gets the light sampling regime (one set of cores per soil type per decade). When any life reading falls or is unknown, or when the claim exceeds what the streams support, the full methodology sampling stays in force. A place claiming carbon while its diversity and cycling readings fall is the monoculture case; that is where the cores belong.

## Worked example: two Oncra land projects

Both are public projects on registry.oncra.org, pathway Land Stored Carbon, method regenerative farming. The boundaries are the registry's public KML files, registered here by the operator so that the numbers can be reproduced by anyone.

WORKED_EXAMPLE_PLACEHOLDER

## What this does and does not claim

- It infers a **flux** (net change per year), while the registry's land calculation projects a **stock** change to a target over twenty years. The two are compared per year: the registry's twenty-year projection is a per-year flux claim of its own.
- Satellite greenness sees the canopy, not the soil. NPP from NDVI is the best-supported term; breathing without a probe is the weakest. That is why the range is wide and why the probe is in the kit.
- Nothing here has been calibrated against cores or flux towers yet. The first calibration is the first triggered visit.
