---
title: "Coupling with Restor, and the open layers behind it"
summary: "What Restor holds per site, what its APIs allow, what the terms permit, and how the oracle now pulls the useful layers straight from their open sources. Checked 2026-09-12."
order: 14
---

# Coupling with Restor

[Restor](https://restor.eco) (ETH Zurich Crowther Lab spin-out, Swiss non-profit) is the largest public registry of restoration and conservation sites: 355,442 sites (222,590 public) from 7,827 organisations, 224 public sites in the Netherlands. For every polygon it computes about 45 "insights" in Google Earth Engine from open global layers. We looked at whether that data can feed the oracle, whether it fits the three streams, and whether the coupling can be automatic. Checked on live pages and live API responses on 2026-09-12.

## What Restor holds per site

| Group | Insights | Upstream source | Resolution | Series? |
| --- | --- | --- | --- | --- |
| Carbon | current and potential above-ground, below-ground and soil carbon | Walker et al. 2022 | ~500 m | static |
| Carbon | above-ground biomass with confidence bounds | ESA CCI Biomass | 100 m | annual 2015 to 2022 |
| Carbon | net primary productivity, evapotranspiration | MODIS MOD17 / MOD16 | 500 m | annual 2001 to 2024 |
| Tree cover | cover 2000/2010, loss per year, potential tree cover | Hansen GFC; Bastin 2019 | 30 m; 1 km | annual loss |
| Vegetation | NDVI, site mean | Landsat | 30 m | annual since 1984 |
| Structure | tree canopy height | Meta/WRI 2024 | 1 m | static |
| Biodiversity | plant, bird, mammal, amphibian richness; regional tree and herb species lists | IUCN ranges; Crowther Lab model on occurrence data | ~50 km; regional | static |
| Biodiversity | SEED biocomplexity index (beta 0.1), nine sub-scores | Crowther Lab | 1 km | static, ~2010 |
| Water | depth to water table, wetlands | Fan 2013; global wetland map | 1 km; 250 m | static |
| Environment | elevation, temperature, precipitation, aridity, soil pH | SRTM, CHELSA, CGIAR, SoilGrids | 90 m to 1 km | static |
| Land | ESRI land cover, ecoregions and biomes | Impact Observatory; RESOLVE | 10 m; vector | annual |
| Pressure | human modification, population within site, 10 km, 50 km | Kennedy 2019; population grids | 1 km | static |
| Risk | drought risk, erosion risk, burned areas, fire occurrences | various; Landsat; NASA FIRMS | 1 km to 375 m | 32-day; daily |

Paid tiers add per-pixel Sentinel-2 NDVI at 10 m monthly since 2018 ("Vegetation Change Report"), OPERA disturbance alerts, portfolios and dashboards. Site owners can upload polygons, photos and 14 self-reported metrics (trees planted, area restored, community members trained). There is no data model for sensors: no acoustic, soil or any live stream.

## What the APIs allow

Restor has two APIs.

- The documented **Restor Public API** (`api.restor.eco`, OpenAPI at `/v3/api-docs`) is write-only for sites: `POST /site` with a GeoJSON feature and an `externalId`, plus a lookup of funding applications. Key in an `X-API-KEY` header, obtained by arrangement. **No endpoint reads a site, its polygon or its insights.** The direction Restor supports is partners pushing their registries into Restor.
- The **internal API** the web app uses serves public sites' metadata, polygons and all computed insights without authentication. It is undocumented, its path versions change without notice, and the Terms of Use prohibit automated access to it: no "page scrape, robot, spider, or other automated device to access, acquire, copy, monitor or republish any portion of the data." Third parties get no express licence to read and republish site data. So a read coupling is technically trivial and legally not available without an agreement.

Contacts for an agreement: community@restor.eco (platform, bulk uploads, data), gwyn@restor.eco (enterprise), a scientific-collaboration form in the help centre. Restor's own materials say "API and data download features planned for interoperability".

## Does it fit the three streams?

**Satellite.** Restor's free NDVI is Landsat at 30 m, annual, site mean. The oracle already computes Sentinel-2 at 10 m per scene, cloud-masked, since 2019. Restor's paid Sentinel-2 product is the same sensor we read for free. Useful as an independent cross-check, not as a source.

**Sound.** Nothing. Restor's species lists are plants only; its bird richness is a ~50 km count from range maps. For an expected-species reference crowd for acoustics, the sources are GBIF, eBird, Xeno-canto and the Dutch NDFF, directly.

**Soil.** Restor exposes SoilGrids pH at 0 to 5 cm and nothing else. SoilGrids itself has texture, organic carbon, bulk density and classification at 250 m, CC BY 4.0, with a free REST API. **The oracle now pulls that directly**: every place gets clay, sand, silt, organic carbon, pH, bulk density and the WRB soil class at registration, and the Cycling model's moisture optimum is set from the clay fraction instead of a fixed 30%. The two demo places came back as Cambisols (clay 39%, organic carbon 5.6%) near Utrecht and Histosols (peat, organic carbon 10.5%) at Zegveld, which is right.

## Other inferences that are fundamentally useful

Beyond the three streams, four kinds of context from the layers behind Restor change what the readings mean. All are open upstream and can be coupled automatically without Restor.

1. **Potential as the reference.** Walker et al. current versus potential carbon and Bastin potential tree cover give a ceiling per place. Productivity and Structure can then be read as distance to potential, which is what principle 3 of the green paper asks for. Specified.
2. **Structure from above.** The 10 m ETH canopy height (2020, CC BY 4.0, 3-degree cloud-optimised tiles on ETH's server) and the 1 m Meta/WRI map give the Structure reading its first satellite witness, before any recorder is installed. Specified; the ETH tiles are reachable the same way we read Sentinel-2.
3. **Shocks from outside the NDVI curve.** NASA FIRMS fire detections, Landsat burned area and the open OPERA disturbance alerts date disturbances independently, so Resilience can measure recovery from a known event rather than from a dip we infer. Specified.
4. **The neighbour crowd.** Ecoregion, soil class, aridity and land cover are the strata for "same soil and climate" when the regional reference is built. Specified.

SEED is the one layer that exists nowhere else: a 0 to 1 similarity of a pixel to the least-modified pixels of the same ecoregion and land-cover class, in nine sub-scores. Beta, 1 km, static around 2010, non-commercial licence, no open data or code. Right now it is a national or regional baseline (Netherlands 0.27), not a per-place signal; a 30 m temporal version is announced.

## What Restor is good for

**A place catalogue and a publication channel.** 224 Dutch public sites with intervention type, start year, stage, pre- and post-intervention land use, management and ownership, and 78 Dutch organisations, one of them the Climate Cleanup Foundation, already on Restor. With read access, those polygons become places here with one click by their stewards. Without it, the Public API lets the oracle **push** its places into Restor under an `externalId`, so a steward's Restor page and their oracle page describe the same polygon, and Restor's users see the seven readings through an embed or link.

## Decision

- Pull the useful layers from their open sources, with attribution: SoilGrids (done), ETH canopy height, Walker potential carbon, Hansen loss, ESRI land cover, FIRMS and OPERA alerts (specified).
- Do not read from Restor's internal API.
- Ask Restor for a Public API key and a scientific-collaboration agreement covering read access to Dutch public sites, and offer the reverse: our verdicts on their site pages. Until then, treat Restor as where places come from and where results are shown, not as a data stream.
