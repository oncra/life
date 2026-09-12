---
title: "Prior art: what exists, what is new"
summary: "A scan of credit methodologies, scientific condition frameworks, Dutch farmland indicator sets and sensor products, checked 2026-09-12, and an honest account of which parts of this design are borrowed and which are not."
order: 13
---

# Prior art

Checked on live pages on 2026-09-12. The purpose is to say plainly what this design inherits and what it adds, so that the standard can cite its ancestors and defend its differences. Corrections by pull request are welcome.

## The short version

Four of our rules have clear ancestors. Three do not, as far as we could find.

| Rule in this design | Ancestors | Status |
| --- | --- | --- |
| Weakest-link verdict (no weighted sum) | EU Water Framework Directive "one-out-all-out"; IUCN Red List of Ecosystems ("the highest level of risk returned by any criterion"); Ecosystem Integrity Index (Hill et al. 2022: minimum of structure, composition, function); SDG 15.3.1; the Dutch Biodiversiteitsmonitor (all KPIs must clear their threshold, FrieslandCampina points only if every KPI is in range); UK BNG trading rules; CreditNature's geometric mean as the soft form | **Prior art** in regulation and science. Absent from sensor-based nature monitoring products, and explicitly rejected by Verra's Nature Framework ("a simple mean prevents indicators from forcing overall quality to zero") and by WUR's BLN 2.0 for soils |
| Unknown as a first-class answer | IUCN "Data Deficient / Not Evaluated"; EPA NARS "Not Assessed"; WFD "unknown" status class | **Partly prior art.** New here: unknown propagates to the verdict as "insufficient, do not pay", instead of being replaced by a proxy (Verra) or treated as zero change (Plan Vivo) |
| Judged against the place's own history and a neighbour crowd | RIVPACS/AUSRIVAS observed-over-expected against predicted reference sites (the canonical version); Biome Makers' percentiles against its database; WFD reference conditions | **Prior art**, applied here to per-parcel satellite phenology and soundscapes rather than to river invertebrates |
| Confidence and maturity per reading | Accounting for Nature's accuracy tiers (80/90/95%); Sylvera's rating ranges; WFD's duty to report confidence and precision | **Partly prior art.** Maturity (how long a direction has held) as a first-class field is ours |
| Three streams fused into one site verdict (satellite, acoustics, soil probe) | Pivotal and Landler run several streams but report metrics side by side; ARISE has the sensor stack without a site verdict; Groenmonitor has the satellite stream without thresholds; BioMonitor4CAP runs all of them in research | **Not found.** Nobody publishes a fused site verdict from these three streams |
| Life as the sensor: birds and bats as the insect reading, breeding song as renewal, machine noise as autonomy | Sentinel-species literature (Clark-Wolf 2024; Hazen 2024); Sethi 2023: soundscape change tracks community change even when indices do not predict richness | **Framing is new**; the science underneath is established |
| Field visits triggered by disagreement between streams, plus a random draw | Adaptive sampling literature (Mondain-Monval 2024; active learning); Savimbo audits a random subset of observations; IAPB asks for triangulation when the data collector is the beneficiary | **Not found as a framework rule** |
| A published ledger of the method's own drift | BeZero's annual rating transition study and versioned methodologies; Sylvera's locked framework versions; WFD intercalibration | **Not found in nature monitoring.** Carbon-credit rating agencies are the nearest |
| A one-click multi-sensor set for landowners with open data | Chirrup (posted recorder, acoustics only, price on request); EasyComp Zeeland BirdNET boxes (€110 to €245); Faunabit DIOPSIS (lease, price on request); Pivotal (enterprise only) | **Not found.** In the Netherlands roughly 1,045 BirdWeather stations and 1,600 Sensor.Community sites already exist, so an open kit lands in a populated ecosystem |

## Credit methodologies

**Verra SD VISta Nature Framework v1.0 (Oct 2024).** Quality hectares = extent times condition; at least three composition and two structure indicators; arithmetic mean within and across components, geometric mean rejected on record; reference from the best reference site or model; missing indicators replaced by a correlated proxy; matched-control baselines; verification at least every five years. Fully compensatory.

**Plan Vivo PV Nature v1.2 (Apr 2026).** Five pillars including a Sentinel-2 NDVI "habitat health" metric and a five-yearly connectivity metric; multimetric is the cumulative sum of year-on-year changes; explicitly no reference sites; changes inside the 95% confidence interval count as zero; a correction factor is applied if measurement accuracy shifts. Compensatory.

**Wallacea Trust V3.** Basket of at least five metrics, median of the percentage changes; the reason for the median is not given in any document we could read.

**Savimbo ISBM.** Hectare-months times integrity, capped sums, indicator species from two kingdoms, eDNA excluded, an independent panel checks a random subset of observations. The only random-audit rule found.

**CreditNature NARIA.** Four metrics 0 to 100 against an attainable maximum, combined by geometric mean, so a weak metric drags the index. Accredited by Accounting for Nature, whose Econd carries accuracy tiers.

**UK statutory BNG.** Units cannot be summed across area, hedgerow and watercourse, and high-distinctiveness losses must be replaced like for like. Non-compensatory across bands, compensatory within.

**IAPB, Biodiversity Credit Alliance, the EU nature-credit roadmap (COM(2025) 374), Australia's Nature Repair Market.** All four reject a single fungible score. The BCA states the motive in one sentence: multiple metrics "to ensure that project interventions aren't causing one aspect of biodiversity to benefit while harming others." The weakest-link verdict is that sentence written as a rule.

## Scientific frameworks

**Essential Biodiversity Variables (GEO BON).** Twenty-one variables in six classes, deliberately not aggregated; satellite phenology and primary productivity are EBVs, there is no acoustic EBV.

**SEEA Ecosystem Accounting (UN 2021).** Variables rescaled against a reference condition, then aggregated; the text is agnostic on the rule and names the minimum operator ("one out, all out") as a precautionary option used in the Habitats Directive and the IUCN Red Lists, while noting that arithmetic means let a lost bird community be compensated by deadwood.

**Ecosystem Integrity Index (Hill et al. 2022; Ecological Indicators 2026).** Per 1 km cell the minimum of structure, composition and function, then down-weighted by the other two, "because the integrity of an ecosystem cannot be higher than the minimum score from any of the three components." The closest single precedent for our verdict rule.

**Water Framework Directive.** Ecological status is "the lower of the values" across quality elements. Twenty years of critique (Moe 2015; Prato 2014; Borja 2014) say the same thing: one-out-all-out over-reports failure when individual indicators are uncertain, and the error grows with that uncertainty. Keith et al. 2013 add the mirror risk: a minimum rule under-estimates when the limiting indicator is the one you lack. Our answer to both is confidence per reading and an unknown state that blocks the verdict instead of passing it.

**Ecoacoustics.** Alcocer et al. 2022 (meta-analysis, 34 studies): acoustic indices relate to biodiversity moderately and inconsistently (r about 0.33). Sethi et al. 2023 (8,023 recordings with paired point counts): neither indices nor machine learning predicted species richness across datasets, but soundscape change was consistently indicative of community change. That is why this design reads direction over time at one place, not level, and why visits remain the ground truth.

**Spectral diversity (Rao's Q).** Open R packages exist; results across habitats are ambiguous; no published framework pairs satellite spectral diversity with acoustics as joint condition streams.

## Dutch farmland indicator sets

**Biodiversiteitsmonitor Melkveehouderij and Akkerbouw.** Seven to nine KPIs from farm records, no sensors. WENR report 2968 (2019) is explicit that a low score on one KPI must not be compensable by another and requires every KPI to meet its threshold; FrieslandCampina awards a points class only if the farm sits in range on all KPIs. An independent validation on about thirty Brabant farms (HAS, 2022 to 2024) found only weak correlation between KPI scores and birds or butterflies and none with soil or water life: the strongest field evidence we found for measuring behaviour rather than inputs.

**Open Bodemindex (OBIC).** Twenty-one soil indicators, scored 0 to 1, weighted so the lowest indicator counts most (a soft Liebig rule), then weighted across years and categories. Partial compensation by design; open source, GPL-3.

**BLN 2.0 (WUR 2023).** Considered one-out-all-out for soils and rejected it because "in most cases soil quality would be judged insufficient", preferring classes over a grade.

**Farmland Bird Index.** Geometric mean of species trends; compensatory by construction.

**ARISE and Automated Biodiversity Monitoring (Naturalis, TNO, RIVM, Rijkswaterstaat; €19.4 M, 2026 to 2030).** The national sensor stack (acoustics, insect cameras, radar, eDNA), institution-hosted, no site verdict, no landowner route.

**Carbon MRV (SNK).** Soil carbon certificates are issued on the model (RothC) with measurement at year 0 and 10, because measured change is within lab error; a model version is frozen per project. The nearest Dutch precedent for "issue for the lower bound, release as confidence grows".

## Sensor products and services

No one sells a landowner-facing, install-once, multi-sensor set with a published price and open data. Single-modality services exist: Chirrup (bird recorder posted to the farm for 14 to 21 days, a "biodiversity score" with undisclosed method, price on request), Wilder Sensing (analysis of your own recorders, £400 to £800 per recorder per year), AgriSound Polly (insect acoustics, price on request), NatureMetrics (eDNA kits at £335 including lab, and a 0 to 100 Ecosystem Condition Index for UK rivers), Faunabit DIOPSIS (insect camera, buy or lease, price on request). Pivotal integrates cameras, acoustics, drones, eDNA and satellite for enterprise clients and keeps the metrics separate. Carbon MRV firms (CarbonSpace under $5/ha, Kanop with per-pixel confidence intervals) publish uncertainty but not biodiversity.

Free-kit programmes for farmers exist only for air quality (Boer aan het Roer, Snuffelfiets); biodiversity hardware stays with institutes (DIOPSIS, AgZero+, BioMonitor4CAP) or is paid by a corporate buyer (Pilgrim's with Chirrup). Farmers in BioMonitor4CAP flagged data privacy and theft as the two recurring problems.

## What this means for the standard

- Cite the ancestors: WFD, IUCN RLE, EII and the Biodiversiteitsmonitor for the verdict rule; RIVPACS for the reference crowd; Accounting for Nature and WFD for confidence reporting; Sethi 2023 for direction-over-level.
- Own the critique: the known failure of one-out-all-out is over-reporting failure under uncertainty. This design's confidence and unknown fields are the mitigation, and the drift ledger is how we will find out whether it works.
- The three claims we make as new, and will defend until someone shows prior art: a fused three-stream site verdict; disagreement-triggered visits with a random draw as a framework rule; a published self-audit of method drift in nature monitoring.

## Sources not reachable today

Verra and Plan Vivo pages intermittently blocked; Wallacea's methodology PDF is form-gated; ISC Victoria PDF; NINA/TABMON; Chirrup and Faunabit prices are not published anywhere we could reach. Listed so that the next pass knows where to look.
