---
title: "The kit: one set, ready to order"
summary: "One standard field set for a landowner (connected sound recorder, two soil probes, gateway, power, mounting), the exact order list with suppliers, and the pre-provisioning that makes it plug-and-play."
order: 3
---

# The kit

One set per place. No options, no choices for the landowner. We buy it, register every device in our systems before it ships, label the boxes, and the landowner does three things: plug the gateway into the internet, push the probes into the ground, clip the recorder to a post. Prices checked on live pages on 2026-09-12, incl. VAT.

## What is in the set

| # | Item | Why | Supplier | Price |
| --- | --- | --- | --- | --- |
| 1 | **BirdWeather PUC** | connected sound recorder, BirdNET on-device, public API; birds and bats-by-proxy, breeding song, machine noise | [Veldshop.nl](https://www.veldshop.nl/en/birdweather-puc.html) | €289.00 |
| 2 | **Voltaic V75 always-on battery** (72 Wh) | the PUC draws ~7 Wh/day; ordinary power banks switch off at that load, Voltaic's always-on ports do not; 9 days of autonomy | [SeeSense (EU)](https://seesense.eu/products/power/batteries/battery-voltaic-v75-71wh-lithium-with-always-on-capability/) | €110.70 |
| 3 | **Voltaic 10 W ETFE panel P110 + bracket BK103** | 10 W is the floor for a Dutch December (~12 Wh/day); no EU reseller stocks it, order direct | [Voltaic Systems](https://voltaicsystems.com/10-watt-panel-etfe/) | ~€90 incl. shipping |
| 4 | **IP65 enclosure ~200×150×75 mm** for the battery | the V75 is weather-resistant, not waterproof | Hornbach / Conrad | ~€15 |
| 5 | **USB-A to USB-C cable, 1 m** | battery to PUC | any | ~€8 |
| 6 | **3× AA lithium (Energizer Ultimate)** | first 48 h and fallback | any | ~€8 |
| 7 | **TP-Link Omada EAP225-Outdoor** | brings the farm WiFi to the field edge (2.4 GHz, passive PoE injector included) | [Megekko.nl](https://www.megekko.nl/product/2105/229846/Accesspoint/TP-LINK-Omada-Access-Point-EAP225-Outdoor) | €79.95 |
| 8 | **Outdoor Cat6 cable, 30 m** | barn router to the access point | Hornbach / Allekabels | ~€20 |
| 9 | **2× Dragino SE01-LB EU868** | soil moisture, temperature, EC; one at 10 cm, one at 30 cm (or two fields); 5-year battery | [Antratek](https://www.antratek.com/se01-lb-lorawan-soil-sensor) | 2 × €120.94 = €241.88 |
| 10 | **Dragino LPS8N-868 gateway** | indoor LoRaWAN gateway on the farmhouse window; Ethernet or WiFi; works with The Things Stack out of the box | [Antratek](https://www.antratek.com/lps8n-indoor-lorawan-gateway) | €152.41 |
| 11 | **Steel tube Ø42 mm, 2 m** (or a wooden fence post) | recorder and panel mount | Hornbach | ~€40 |
| 12 | 2× stainless hose clamps 40 to 60 mm | mount | Toolstation / Hornbach | ~€6 |
| 13 | UV cable ties 250 mm, 100 pcs | cables | Hornbach | €6.45 |
| 14 | Steel cable lock 1 m | theft | bol.com | €8.62 |
| 15 | Flexible conduit 25 mm (2 m per kit, sold per 25 m roll) | probe cable up the stake | Hornbach | €10.90 / roll |
| 16 | Silica gel sachets | enclosure | bol.com | €13.95 / 10 |
| 17 | Wooden stake 1 m | marks the probe | Hornbach | €4.73 |
| 18 | Weatherproof labels | QR label per device | bol.com | €7.45 / 240 |

**Set total: about €1,110** (€890 verified on product pages, the rest estimated). At ten sets the consumables spread and the total drops to about €1,050.

### Optional add-on: no WiFi within reach

| Item | Supplier | Price |
| --- | --- | --- |
| Teltonika RUT241 LTE router | [Reichelt](https://www.reichelt.com/de/de/shop/suche/rut241) | €161.90 |
| Data SIM, 1 to 2 GB/month (the PUC uploads audio snippets; a 500 MB/10-year IoT SIM is not enough) | KPN / Simyo data-only | ~€5 to €10/month |

## What was decided, and why

- **Connected recorder, not SD cards.** Card swaps every six weeks are exactly the friction we want gone. The PUC runs BirdNET on the device, buffers to its SD card when the link drops, and its public API is polled by the oracle every hour. Nothing runs on the farm.
- **Farm WiFi over 4G.** Nearly every farm has WiFi in the barn. An outdoor access point on the barn wall reaches 100 to 200 m into the field. 4G is the add-on, not the default.
- **Two probes.** Two depths give the soil-breathing model a profile, and two probes on one gateway make a probe failure visible as disagreement rather than silence.
- **One vendor for soil.** Dragino probe and Dragino gateway, one support line, both in The Things Stack device repository.
- **No insect trap, no CO2 probe, no camera** in the standard set. Birds and bats are the insect sensor; soil breathing comes from moisture and temperature. An insect camera is the first add-on for places that want it.

## Pre-provisioning: what we do before the box ships

This is what turns a list of parts into one click.

1. Register the place in the oracle (polygon from the landowner's parcel map). Steward key stored in our vault, not in the box.
2. Register the two probes in **our** The Things Stack application with the DevEUI / JoinEUI / AppKey from their stickers; set uplink to 20 minutes. Register the gateway in the same application. The landowner never sees The Things Stack.
3. Register both probes and the PUC as devices on the place in the oracle: probes with their DevEUI and depth; the PUC with its BirdWeather station id as `serial`.
4. Create the BirdWeather station on our account, pre-configure the PUC's WiFi to the farm's SSID (we ask for it on the order form), and note the station id.
5. Print one QR label per device pointing at the place page. Pack the probes, gateway, and recorder kit in one box with the two-page install sheet.

Result on the farm: plug in the gateway (it joins by DHCP), push the probes in, clip on the recorder. "Last seen" on the place page turns green within an hour, the satellite readings are already there.

## Install day, in order

1. Gateway on the farmhouse window sill, Ethernet into the router (or WiFi via its setup page). Green LED.
2. Access point on the barn wall facing the field, Cat6 to the router, injector inside.
3. Post at the field edge, 20 m from the road, facing the open field. Recorder at 1.8 m, microphone horizontal, facing the field. Panel above it, south, 30 to 45 degrees. Battery in the enclosure at the base, silica inside, cable lock through everything.
4. Probes: dig, insert horizontally into the undisturbed wall at 10 cm and 30 cm, backfill and firm, conduit up the stake, transmitter box on the stake above mowing height, antenna vertical. Press the button 5 s. Blue LED means joined.
5. Photo of each device from 2 m, sent to us; we put the positions on the place.

Roughly two hours for one person.

## Offering it to landowners

Two ways, both with everything above pre-provisioned:

- **Buy**: the set at cost plus provisioning, about €1,250, delivered; install by the landowner with the sheet, or by us for a day rate.
- **Lease**: about €35 a month over four years, replacement included; the set stays with the place if the landowner leaves.

In both cases the landowner gets: a public place page with seven readings, a lighter carbon-verification burden when the life readings agree with the carbon claim, and their data in the open.

## First test order

One set exactly as above, for one of our own fields, ordered from three shops (Veldshop, Antratek, Hornbach) plus the Voltaic panel from the US. The CSV in the repository (`kit/order-list.csv`) is the shopping list. Two weeks from order to "last seen".
