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

Both places are live here, with their full Sentinel-2 history: [Horaholm](/places/horaholm-oncra-hor-l-001-hornhuizen) and [Boer in Natuur, home parcel](/places/boer-in-natuur-maashorst-oncra-bin-n01-m01-home-parcel). The numbers below are what the API returned on 2026-09-13; they move as scenes and readings arrive.

### Horaholm, Hornhuizen (HOR-L-001)

55.05 ha of regenerative arable and vegetable land on marine clay (SoilGrids: Fluvisols, 29% clay, 5.6% organic carbon). The registry's published calculation: baseline soil carbon 163 t CO₂/ha, target 283 t CO₂/ha, so 120 t CO₂/ha of storage over twenty years, times 55 ha is 6,591 t, minus 20% for project emissions gives **5,273 t CO₂, issued as potential credits on 15 August 2023**. As a yearly flux that claim is **6.0 t CO₂ per hectare per year**, about 264 t a year for the project.

What the satellite saw, growing-season mean NDVI: 2019 0.50, 2020 0.45, 2021 0.46, 2022 0.44, then **2023 0.53 and 2024 0.53**, 2025 0.46. The step up in 2023 is consistent with the farm's own account of year-round living cover from that season. The 2025 dip coincides with the driest spring on record in the Netherlands; the Productivity reading calls it falling because the neighbour crowd that would subtract regional weather is not built yet, and it says so in its evidence.

The carbon balance the method infers, per hectare per year, central parameters, soil breathing from climatology because no probe is installed:

| Year | NPP t C | Soil breathing t C | Export t C | Net, central t CO₂ | Net, box t CO₂ |
| --- | --- | --- | --- | --- | --- |
| 2020 | 6.1 | 3.6 | 2.8 | −0.9 | −17 to +15 |
| 2021 | 6.6 | 3.6 | 3.0 | 0.0 | −17 to +16 |
| 2022 | 7.0 | 3.6 | 3.2 | +0.9 | −17 to +18 |
| 2023 | 8.1 | 3.6 | 3.6 | **+3.0** | −17 to +22 |
| 2024 | 7.9 | 3.6 | 3.6 | **+2.7** | −17 to +21 |
| 2025 | 7.8 | 3.6 | 3.5 | **+2.4** | −17 to +21 |

Reading it: the central estimate moved from about zero in 2020 to 2022 to about **+2.5 to +3 t CO₂ per hectare per year from 2023**, which is a real change in the same direction as the claim, at roughly half the claimed rate. The box, however, still spans zero, so **the lower bound is zero and the streams alone would issue nothing yet**. That is the correct answer for a place with only the satellite stream and default parameters: the method is showing a trend witness and a consistency check, not a certificate.

### Boer in Natuur, Maashorst (BIN-N01-M01), home parcel

12.2 ha of the 24.4 ha project (the parcel whose boundary is in the registry's public KML): food forest with free-ranging animals on sandy Maashorst soils. The registry shows **4,738 t CO₂ in circulation** for the whole project and its calculation as a published document; over 24.4 ha and a twenty-year horizon that is about **9.7 t CO₂ per hectare per year**.

The satellite sees a dense, closing canopy: growing-season NDVI 0.62 in 2019 and 2022, 0.72 to 0.74 in 2021, 2023 and 2024. With the woody parameter set (lower light-use efficiency, higher soil breathing than cropland, small harvest export):

| Year | NPP t C | Soil breathing t C | Export t C | Net, central t CO₂ | Net, box t CO₂ |
| --- | --- | --- | --- | --- | --- |
| 2020 | 6.4 | 4.3 | 0.9 | +4.3 | −11 to +19 |
| 2021 | 7.2 | 4.3 | 1.0 | +7.1 | −10 to +23 |
| 2022 | 6.4 | 4.3 | 0.9 | +4.5 | −11 to +19 |
| 2023 | 7.6 | 4.3 | 1.1 | **+8.2** | −9 to +25 |
| 2024 | 7.3 | 4.3 | 1.0 | **+7.1** | −9 to +23 |
| 2025 | 6.4 | 4.3 | 0.9 | +4.4 | −11 to +19 |

Reading it: a young food forest that exports almost nothing can plausibly bank **4 to 8 t CO₂ per hectare per year** in wood and soil, and the central estimate lands in the range of the registry's per-year figure. The box again spans zero. Lower bound: zero.

### What narrows the box, in order of leverage

The width of the box is the sum of three parameter ranges. Each stream removes one:

1. **A soil probe** replaces the climatology and the 1.8 to 2.4 Q10 range with the place's own temperature and moisture. Soil breathing goes from a 2.6 to 4.7 t C range to roughly ±0.5 around a measured curve. About 8 t CO₂ off the box.
2. **A declared harvest** (yields, animals sold, wood cut) replaces the land-use fraction. Export goes from 1.8 to 5.1 t C at Horaholm to about ±0.3 around the declared figure. About 6 t CO₂ off the box.
3. **Soil cores at two depths, once per soil type**, pin the light-use efficiency: the remaining 1.6 to 2.4 g C per MJ range is the last big term, and it is fitted by comparing five years of inferred net change with the measured stock change. That is what turns the lower bound positive.

With all three, the Horaholm box for 2024 would be roughly +1 to +5 t CO₂ per hectare per year instead of −17 to +21, and the lower bound, 1 t CO₂ per hectare, about 55 t a year, becomes issuable. Every further season that the streams agree adds maturity and lifts it further. The registry's projected 6 t per hectare per year is then either confirmed by the cores, or the certificates are delivered at the rate the place actually shows.

### The gate, applied today

At both places the Productivity reading is currently **falling** (single-place, 2025 against the previous three seasons) and the other readings are **unknown**. Under the rule, both projects stay on the registry's full sampling regime. Nothing about their standing changes. What changes is what the next visit measures: cores at two depths, taken where the satellite says the canopy is densest and sparsest, so that the same cores calibrate the light-use efficiency for every arable and every food-forest place after them.

## Why a range that spans zero is the point, not a failure

Both worked examples above end with a lower bound of zero, so the streams alone would issue nothing yet. That reads like
a weakness. It is the single most important rule in this method, and it is worth saying why in full.

The largest programme in the world paying smallholders on satellite-measured biomass, Rabobank's Acorn, was told the
following by its own verifier in a published report on a Kenyan project in July 2024: the biomass change being claimed
was 10.73% of the standing stock, while the model's permitted error was 30%, so that "the allowed maximum error (30%) of
the model is 2.63 times bigger (280%) than the percentage of the biomass change", and therefore "the actual uncertainty
in the estimation of the biomass changes, and therefore of the CRUs, is not being addressed". The same report asked what
should happen to credits already sold but not yet verified. Two years earlier, a different auditor had found a project of
theirs overestimating removals more than sixfold, with a machine-learning model whose predictions could not go below 3.5
t/ha on land whose true values reached 0.03.

When the change you are claiming is smaller than the error of the instrument measuring it, there are two possible
responses. One is to issue anyway and apply a deduction factor. The other is to issue for the bottom of the range and
wait. This method does the second. A place whose box spans zero earns nothing from carbon until a probe, a declared
harvest or a set of cores narrows it, and the page says exactly which of those would narrow it most.

That is also why the parameter box here is wide and visible rather than collapsed into a single number. A point estimate
with a hidden error is worth less than a range you can argue with.

## What this does and does not claim

- It infers a **flux** (net change per year), while the registry's land calculation projects a **stock** change to a target over twenty years. The two are compared per year: the registry's twenty-year projection is a per-year flux claim of its own.
- Satellite greenness sees the canopy, not the soil. NPP from NDVI is the best-supported term; breathing without a probe is the weakest. That is why the range is wide and why the probe is in the kit.
- Nothing here has been calibrated against cores or flux towers yet. The first calibration is the first triggered visit.
