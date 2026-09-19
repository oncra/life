---
title: "Hardware guide: what to buy"
summary: "The market behind the standard kit: sound recorders, soil probes, gateways and ready-made devices available today, with prices, where to buy in Europe, and the three alternative sets for places the single 4G node does not suit."
order: 7
---

# Hardware guide

> **The standard set is a single solar 4G box on one post: [The kit: Life node v1](/docs/kit).** It needs no farm WiFi, no LoRaWAN gateway and no monthly subscription, because species recognition runs inside the box and the soil probes are wired into it. This page is the wider market scan behind that choice, plus the alternative sets for the places where the node is not the right answer: no signal at all, or WiFi already at the field edge.

Prices were checked live on 2026-09-12, and the ready-made devices at the bottom of the page on 2026-09-13. They include VAT where the shop shows it. They will drift; the repository is the place to correct them. Everything here was chosen on one criterion: **install once, leave it for years, data comes out without a visit.** Where that is not possible yet (offline recorders), the guide says so.

## The alternative sets

The node covers both streams at once. These three sets each cover one stream, and each answers a situation the node does not. They are named, not lettered, so that a set means the same thing on every page.

| Set | What it is | Per unit, all-in | When it is the right choice | Data path |
| --- | --- | --- | --- | --- |
| **Offline sound** | AudioMoth 1.2.0 + IPX7 case + 3 AA lithium + 128 GB microSD + cable lock | about €245 | no power and no cellular signal, and somebody passes the spot every six weeks anyway | SD card swap every 6 to 8 weeks, analysed on a laptop with BirdNET-Analyzer, pushed with `clients/audiomoth-birdnet-push.py` |
| **Connected sound** | BirdWeather PUC + 5 W solar panel + pole mount; a 4G router only if there is no WiFi | about €355 per unit (+ €120 router + €10/month SIM where WiFi does not reach) | WiFi already reaches the field edge from a barn or a house, and you want a second, independent BirdNET implementation | On-device BirdNET; detections pulled from the BirdWeather API into the oracle every hour, or pushed from a BirdNET-Pi |
| **LoRaWAN soil** | Dragino SE01-LB (moisture, temperature, EC) + a LoRaWAN gateway shared by the area | about €121 per probe; gateway €140 to €300 once per farm or village | probes scattered over fields too far apart to wire, with one gateway covering all of them | LoRaWAN → The Things Stack (free Sandbox or €1.33/month KPN) → webhook to the oracle |

A first installation for one farm (three fields, say 20 ha) along the distributed route: 2× connected or offline sound, 3× SE01-LB, one indoor gateway on the farmhouse window. Roughly €1,200 to €1,400 once, under €15 a month connectivity. That is under €10 per hectare per year over five years, before any satellite cost, which is zero. The same farm along the node route is one node per field at about €687, so more money up front for three fields, and in exchange no access point, no gateway, no router, no subscription, and nothing that stops working when the farm changes its WiFi password. The node wins the moment the field is out of WiFi reach, which is most fields.

## Sound recorders

### Offline (SD card)

| Device | Buy | Price | Rate | Power | Weather | Open |
| --- | --- | --- | --- | --- | --- | --- |
| **AudioMoth 1.2.0** (Open Acoustic Devices) | [Veldshop €146.85](https://www.veldshop.nl/en/audiomoth.html), [LabMaker $99](https://www.labmaker.org/products/audiomoth-v1-2-0); [IPX7 case €64.83](https://www.veldshop.nl/en/audiomoth-ipx7-case.html) | €147 + €65 case | 8 to 384 kHz (bat-capable in principle) | 3× AA; ~9 days continuous at 48 kHz, 6 to 8 weeks on a dawn/dusk schedule | IPX7 case (there is no IP68 case; ignore claims of one) | firmware MIT, hardware CC BY 4.0 |
| **Song Meter Micro 2** (Wildlife Acoustics) | [Veldshop €177](https://www.veldshop.nl/en/song-meter-micro-2.html) | €177 | 8 to 96 kHz, not bat-capable | 4× AA, up to 280 h | IP67 hinged housing | no |
| **Song Meter Mini 2** | [Veldshop €593 (AA) / €712 (Li-ion)](https://www.veldshop.nl/en/song-meter-mini-2-aa.html) | €593 | 96 kHz | 8× AA, 530 h | IP67 | no |
| **Song Meter SM5** (SM4 successor) | [Veldshop €915](https://www.veldshop.nl/en/song-meter-sm5.html) | €915 | 96 kHz | 11× 18650, 1,330 h, solar input | IP67, GPS; cellular module expected 2027 | no |
| **Frontier Labs BAR-LT** | [Veldshop €699](https://www.veldshop.nl/en/frontier-labs-bar-lt-bioacoustic-recorder.html) | €699 | 96 kHz, 2 ch, GPS | 1 to 6× 18650, 100 to 600 h | rugged, lockable | no |
| **Frontier Labs Solar BAR** | Veldshop €935 | €935 | 96 kHz | solar, indefinite | waterproof | no |
| **Titley Chorus** | [Veldshop €653](https://www.veldshop.nl/en/titley-chorus.html) (+€326 ultrasonic mic) | €653 | 22 to 500 ksps | 4× AA, 300 h | IP67 | no |

Cornell's Swift is discontinued; Bugg (Imperial College) is not currently for sale and needs a 50 to 100 W solar kit because it uploads full audio. Neither is recommended today.

### Connected (real-time detections, no card swap)

| Device | Buy | Price | Does | Power | Link | Data out |
| --- | --- | --- | --- | --- | --- | --- |
| **BirdWeather PUC** | [Veldshop €289](https://www.veldshop.nl/en/birdweather-puc.html), [maker $299](https://www.birdweather.com/shop-birdweather-puc) | €289 | BirdNET on-device (~6,000 species), GPS, environment sensors | 3× AA lithium ≈ 48 h, or USB-C from a 3 to 5 W solar panel (maker sells both) | 2.4 GHz WiFi + BLE only; in a field you need a 4G router | [public GraphQL API](https://app.birdweather.com/api/index.html) with live subscriptions, CSV |
| **BirdWeather PUC Bat Edition** | [Veldshop €495](https://www.veldshop.nl/en/birdweather-puc-bat-edition.html) | €495 | 250 kHz; bat classifier 215 species plus BirdNET | Li-ion pack included, solar via USB-C | WiFi | API, FLAC on 64 GB SD |
| **Haikubox** | [Veldshop €277](https://www.veldshop.nl/en/haikubox.html) | €277 | BirdNET in the cloud | mains USB only; maker says solar is not viable | WiFi | CSV, no public API |
| **DIY BirdNET-Pi / BirdNET-Go** (this is what the node is) | Raspberry Pi 4 (~€50; the Zero 2 W at ~€22 is out of stock in the EU until December 2026 and BirdNET-Go dropped support for it) + USB microphone + weatherproof box + 10 to 20 W panel and battery | €150 to €250 | BirdNET locally; BirdNET-Go adds bat models (needs an ultrasonic USB mic, e.g. Dodotronic Ultramic384K €445) | ~3 W listening; 50 W panel and 18 Ah battery on a ten-hour schedule | WiFi or USB LTE dongle (the node uses the dongle) | MQTT, webhooks, SQLite. Use `clients/birdnet-pi-push.py` |

There is no commercial LoRaWAN or NB-IoT recorder that ships species detections today. That remains DIY (Pi + LTE dongle) or 2027 (Wildlife Acoustics cellular module).

### Ultrasonic (bats, 192 kHz and up)

| Device | Buy | Price | Notes |
| --- | --- | --- | --- |
| **Song Meter Mini Bat 2** | [Veldshop €890 (AA) / €999 (Li-ion)](https://www.veldshop.nl/en/song-meter-mini-bat-2-aa.html) | €890 | 500 kHz, 50 nights per AA set, IP67; add the €96 acoustic mic stub to record birds on the same unit |
| **Song Meter SM5BAT** | Veldshop €1,199 | €1,199 | 500 kHz, 2 ultrasonic + 2 acoustic channels, 150 nights |
| **AudioMoth at 250 to 384 kHz** | as above | €212 with case | cheapest bat option; days not weeks at full rate, use triggered recording |
| **PUC Bat Edition** | as above | €495 | the only connected bat option under €1,000 |

### Insect cameras (instead of traps)

- **DIOPSIS** (Faunabit, NL): camera with LED screen, 4G, Naturalis recognition model; ran at 120 sites 2021 to 2024, now in regular monitoring. Price on request: [faunabit.eu](https://www.faunabit.eu/en/products/diopsis).
- **Insect Detect** (open source, DE): OAK-1 camera + Pi Zero 2 W, solar, BOM €445 to €660, GPLv3: [docs](https://maxsitt.github.io/insect-detect-docs/).

In the oracle design, birds and bats are the routine insect sensor; an insect camera is a good add-on for a subset of places and a fine triggered-visit instrument.

### Software that turns audio into data

| Tool | Does | Licence |
| --- | --- | --- |
| [BirdNET-Analyzer](https://github.com/birdnet-team/BirdNET-Analyzer) | bird classifier, 6,500 species, CLI | code MIT, **models CC BY-NC-SA 4.0** (commercial use needs a licence from Cornell) |
| [BirdNET-Go](https://github.com/tphakala/birdnet-go), [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) | 24/7 on a Pi, MQTT, webhooks | CC BY-NC-SA 4.0 |
| [BattyBirdNET-Analyzer](https://github.com/rdz-oss/BattyBirdNET-Analyzer) | European bats | CC BY-NC-SA 4.0 |
| [BatDetect2](https://github.com/macaodha/batdetect2) | bat call detection | CC BY-NC 4.0 |
| [Perch 2.0](https://github.com/google-research/perch) | embeddings for your own classifiers (insects, frogs, machines) | Apache-2.0 |
| [scikit-maad](https://github.com/scikit-maad/scikit-maad) | acoustic indices (ACI, ADI, NDSI, BI) | BSD-3 |

The licence line matters: if the oracle is ever sold as a service, the BirdNET family needs a commercial licence or a replacement. Perch and scikit-maad do not.

## Soil probes

### Recommended: LoRaWAN moisture + temperature (+ EC)

| Device | Buy (EU) | Price | Measures | Battery | Rating | Decoder |
| --- | --- | --- | --- | --- | --- | --- |
| **Dragino SE01-LB** (LSE01 successor) | [Antratek €120.94](https://www.antratek.com/se01-lb-lorawan-soil-sensor), [maker $146.50](https://shop.dragino.com/index.php?rt=product%2Fproduct&path=75&product_id=195) | €121 | VWC 0 to 100% (±3% below 53%), temp ±0.3 °C, EC 0 to 20,000 µS/cm | 8,500 mAh Li-SOCl2, up to 5 years | IP66 box, epoxy probe | in The Things Stack device repository; fields `water_SOIL`, `temp_SOIL`, `conduct_SOIL` |
| **Dragino SE01-LS** (solar) | Antratek €109.95 excl. | €133 | same | solar + battery | IP66 | same |
| **Seeed SenseCAP S2105** | [Antratek €175.09](https://www.antratek.com/sensecap-s2105-lorawan-soil-moisture-and%20ec-sensor), [maker $146](https://www.seeedstudio.com/SenseCAP-S2105-LoRaWAN-Soil-Temperature-Moisture-and-EC-Sensor-p-5358.html) | €175 | VWC ±3%, temp ±0.5 °C, EC 0 to 23 dS/m | 19 Ah D-cell, replaceable, "up to 10 years" | IP66 | Seeed decoder; `messages[].measurementId` 4102 temp, 4103 VWC, 4108 EC |
| **Seeed SenseCAP S2104** | maker $135.50 | €125 | VWC + temp, no EC | same | IP66 | same |
| **Milesight EM500-SMTC** | [Industry-Electronics €456.79](https://industry-electronics.com/milesight-iot/em500-smtc-868m-mec20-soil-moisture-temperature-electrical-conductivity-sensor-lieske_1673557.htm) | €457 | VWC ±2%, temp ±0.5 °C, EC ±3% | 19 Ah, up to 10 years | IP67 box, IP68 probe | GPL-3.0 decoders; `humidity`, `temperature`, `conductivity` |
| **Truebner SMT100 + Dragino SDI-12-LB** | [SMT100 €149 to €158](https://dvs-beregnung.de/truebner-smt100-sdi-12-soil-moisture-sensor-temperature-irrigation) + [SDI-12-LB €54.95](https://www.antratek.com/sdi-12-lb-sdi-12-to-lorawan-converter) | €205 | TDT (works in clay, EC-insensitive), VWC ±3% factory / ±1% soil-specific, temp ±0.2 °C | 8,500 mAh | potted sensor | generic SDI-12 payload, set a `mapping` |
| **METER TEROS 12 + Decentlab DL-TRS12** | [iot-shop €1,218](https://iot-shop.de/en/shop?search=DL-TRS11) | €1,218 | research-grade VWC ±0.03, temp ±0.3 °C, EC ±5% | 2× C alkaline, 4 to 16 years | IP66/67 node, IP68 sensor | MIT decoders, in TTN repository |
| **Sensoterra Single Depth** (NL) | [iot-shop €543.71](https://iot-shop.de/en/shop/sensoterra-single-depth-sensor-for-soil-moisture-4828), often quote-only | €544 + €12 to €30/year cloud | VWC only (no temp), hammer-in, 15/30/60/90 cm | 6 to 10 years, non-replaceable | IP67 | closed payload; must route through Sensoterra's API |

For the oracle's Cycling reading you need **temperature and moisture together**, so the Sensoterra (no temperature) and the cheap analog probes (Pino-Tech SoilWatch 10 €21 to €28, Ecowitt WH51 €20 to €27 with WiFi gateway, Catnip €12 open hardware) are second choices: fine as extra witnesses, not as the one probe per field.

### Soil CO2 (flux) is not in the standard kit

Purpose-built flux instruments (Eosense eosFD, LI-COR LI-8250) are quote-only research equipment, mains or large solar, with moving parts or annual membrane changes. No LoRaWAN buried CO2 probe exists as a product; the one long field trial of buried Seeed CO2 nodes saw 20 units fall to 1 survivor in four years (humidity). The oracle therefore derives soil breathing from moisture and temperature (a Q10 model, see the [specification](/docs/spec)) and treats any CO2 probe as an optional extra witness or a triggered-visit instrument. If you want one anyway, the honest budget route is a Sensirion SCD30 in a membrane housing with desiccant (~$60 module) as published in Nguyen and Levintal 2025 (doi 10.5194/soil-11-639-2025).

## LoRaWAN gateways and networks

Check [ttnmapper.org](https://ttnmapper.org/) first: if a community gateway already covers the fields, you need none.

| Gateway | Price | Where | Notes |
| --- | --- | --- | --- |
| **Seeed SenseCAP M2** | [Antratek €120.94](https://www.antratek.com/catalogsearch/result/?q=sensecap) | indoor, window | Ethernet + WiFi; cheapest TTN-ready; outdoor enclosure €53 |
| **Dragino LPS8N** | Antratek €169.34 | indoor | Ethernet + WiFi; 4G variant €242 |
| **Dragino DLOS8N** | Antratek €302.44 | outdoor IP65 | PoE; vendor range "up to 5 km" |
| **MikroTik wAP LR8G kit** | Reichelt €139.95 | outdoor IP54 | passive PoE, GPS; UDP forwarder only |
| **RAK7268V2** | iot-shop €273.58 | indoor | Basic Station; LTE variant |
| **Milesight UG67** | iot-shop €942 | outdoor IP67 | 4G, "15 km rural" |

On flat farmland expect 3 to 8 km from a mast-mounted outdoor gateway, 1 to 2 km from an indoor one behind glass.

**Network server.** The Things Stack **Sandbox** is free for small, non-commercial use (fair use: 30 s uplink airtime per device per day, plenty for a probe sending every 15 to 30 minutes at SF7 to SF9). The Things Stack Cloud Discovery tier is free for 10 devices with an SLA; Standard is €190/month for 1,000 devices. In the Netherlands **KPN LoRa** is nationwide: Explorer plan €1.33/month per device, monthly cancellable, devices must be on KPN's qualified list. Helium costs about $0.00001 per uplink but has no roaming with TTN and needs its own network server.

**NB-IoT alternative** where there is no LoRaWAN: Dragino SE01-NB (€133 at Antratek) with a 1NCE SIM (€12 for ten years, 500 MB).

## Ready-made alternatives: can you skip the build?

Checked live on 2026-09-13. Prices include VAT where the shop shows it. The short answer: for either half of the node, nearly. For the whole node, no. Nobody sells it.

### Listening, assembled

| Product | Price | Link | Connectivity | Inference | Data |
| --- | --- | --- | --- | --- | --- |
| BirdWeather PUC | €289 | [veldshop.nl](https://www.veldshop.nl/en/birdweather-puc.html) | WiFi only | on device, 6,424 birds plus frogs and some insects | public API, CSV, no subscription |
| EasyComp Watch House Field Pro | €245 plus €15/month for 10 GB | [easycompzeeland.nl](https://easycompzeeland.nl/en/services/birdnet-pi-non-profit/) | 4G modem, 10 to 20 W solar | BirdNET-Pi on the device | your own instance. "Coming soon" on the check date |
| EasyComp Watch House Basic / Plus | €110 / €155 | same | WiFi | BirdNET-Pi | Basic ships today, mains powered |
| Bugg v4 | not published | [bugg.xyz](https://www.bugg.xyz/) | 3G/4G, off-grid solar | cloud | pre-order via GroupGets; "hardware, not analyses or dashboards" |
| Haikubox | $399 with 5 years, then $59/year | [haikubox.com](https://haikubox.com/collections/all) | WiFi | on device | closed consumer platform |
| Song Meter Micro 2 | about $202 | [wildlifeacoustics.com](https://www.wildlifeacoustics.com/products/song-meter-micro-2) | none | none | SD card |
| RFCx Guardian 3 | not retail | [rfcx.org/guardian](https://rfcx.org/guardian) | cellular, solar | on device | programme deployments |

The PUC is the strongest of these and this oracle already polls it hourly by station id. Its one constraint is the one that produced the node: WiFi and nothing else, and most fields have none. EasyComp's Field Pro does add 4G, at €15 a month for 10 GB, which is the whole architectural argument in one line: their box ships audio, ours ships detections, so a €12 SIM covers ten years instead of €180 a year.

Two open reference designs are worth reading before anyone builds a v2 board: [Microsoft SPARROW](https://microsoft.github.io/SPARROW/) (Jetson Orin Nano with Starlink, solar, edge inference) and [Bird@Edge](https://jonashoechst.de/assets/papers/hoechst2022birdedge.pdf) (ESP32 microphone nodes reporting to a Jetson base, about €110 in parts). Neither is a product.

### Soil, assembled

| Product | Price | Link | Connectivity | Depths |
| --- | --- | --- | --- | --- |
| Farm21 FS31 | €375 plus €89 per sensor per year | [farm21.com](https://www.farm21.com/product/fs21-soil-moisture/) | NB-IoT and LTE-M, 2G fallback, SIM included, no gateway | moisture 0-10, 10-20, 20-30 cm; temperature at 10 and 20 cm; air temperature and humidity |
| SenseCAP S2105 | €129.99 excl. VAT | [kiwi-electronics.com](https://www.kiwi-electronics.com/en/sensecap-s2105-lorawan-wireless-soil-moisture-temperature-ec-sensor-11232) | LoRaWAN, gateway required | one depth: moisture, temperature, EC |
| Sensoterra | price on request | [sensoterra.com](https://www.sensoterra.com/soil-moisture-sensor/) | LoRaWAN, gateway required | single or multi-depth, 6 to 8 year battery |

Farm21's FS31 is the one product that could replace the soil half of the node outright: cellular built in, no gateway, about a year on a charge, three moisture depths in one probe, and a published [REST API](https://www.farm21.com/developers/). Against two €26.90 wired probes it costs about €280 more up front and €89 a year per node, and it places a company between a place and its own readings. That is the trade, and it is a real one.

### The combination is what is missing

No product hears, reads the soil, carries both over one cellular link, and posts the result to a registry the landowner and anyone else can read. The nearest buyable approximation is a PUC plus an FS31, roughly €664 plus €89 a year, and it stops at the first field without WiFi. Adding a 4G router to rescue it rebuilds the €1,110 distributed set that [the kit](/docs/kit) replaced.

This is not a gap in engineering. Every part of it is available and cheap. It is a gap in what the market is for: these devices are sold to deliver data into the seller's platform, so nobody has a reason to build the one that delivers it into someone else's. That is the reason to build it rather than buy it, and it is recorded with its evidence in [Prior art](/docs/prior-art).

One thing worth buying anyway: a PUC next to the first node, as an independent BirdNET implementation to check our own detections against. €289 answers the first question any auditor will ask.

## Where to buy

- **Veldshop.nl** (NL): all acoustic recorders above, same-day shipping across the EU.
- **LabMaker** (Berlin): Open Acoustic Devices' EU distributor (AudioMoth, µMoth, HydroMoth).
- **Antratek.nl** (NL): Dragino full line, Seeed SenseCAP, gateways.
- **iot-shop.de** (DE): broadest LoRaWAN range: Dragino, RAK, Milesight, Kerlink, Decentlab, Sensoterra.
- **Reichelt.de** (DE): MikroTik, Milesight, RAK gateways.
- **OpenSprinklerShop.de** (DE): Truebner SMT100/SMT50 and a ready LoRaWAN SMT100 node from €99.

UK shops (Wildcare, NHBS, Connected Things) add import VAT and duty for EU buyers since Brexit.

## Not verified, open

Bugg v4 pricing (availability resolved 2026-09-13: GroupGets pre-order, first half of 2026, hardware only); Swift successor "Magpie" timing; DIOPSIS price; Sensoterra's two conflicting subscription prices; Milesight's soil-type presets; independent multi-year corrosion reports for the budget probes. If you know, edit this page.
