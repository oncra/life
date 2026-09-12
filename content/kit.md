---
title: "The kit: one box on one post"
summary: "Life node v1: a single solar-powered 4G box that hears (BirdNET), reads two wired soil probes and posts to the oracle. No farm network, no gateway, no WiFi. About €520 in parts, half the earlier set. Order list with suppliers, checked 2026-09-12."
order: 3
---

# The kit: Life node v1

One box, one post, one radio. A landowner gets a sealed enclosure with a solar panel and two probe cables. They drive in a post, hang the box, push the probes into the ground. Everything else was done before it shipped. Prices checked on live pages on 2026-09-12, incl. VAT.

## Why one box

The first set had three radios (WiFi to the recorder, LoRaWAN to the probes, the farm's internet for both), two hubs (an access point on the barn, a gateway on the window sill), and a dependence on the farm network reaching the field. It was €1,110. Most fields are not within WiFi reach of a barn, and every extra device is a thing that can be unplugged.

The node folds all of it into one enclosure:

- a small computer runs BirdNET locally, so only detections leave the field (a few kilobytes a day, which is why a €12 ten-year IoT SIM is enough);
- the soil probes are wired, over a 20 m cable, into the same box, so they need no radio and no battery of their own;
- one 4G/LTE-M modem carries everything; the landowner's network is never involved;
- one solar panel and one battery power the lot.

## What is in the box

| # | Part | Choice | Supplier | Price |
| --- | --- | --- | --- | --- |
| 1 | Computer | Raspberry Pi 4 Model B, 2 GB (runs BirdNET-Go; the Pi Zero 2 W is out of stock in the EU until December and BirdNET-Go no longer supports it) | Kiwi Electronics | ~€50 |
| 2 | Storage | SanDisk High Endurance 32 GB microSD | DataIO | €24.99 |
| 3 | Modem | Brovi/Huawei E3372-325 USB 4G stick (plug-and-play; the Waveshare SIM7080G LTE-M HAT is €34.90 but on a three-month lead) | TelecomShop / bol | ~€45 |
| 4 | SIM | 1NCE IoT Lifetime Flat, 500 MB, 10 years, LTE-M and 4G in NL | 1nce.com | €12 |
| 5 | Microphone | Boya BY-M1 lavalier + USB sound card, foam windscreen, downward hood (I2S MEMS INMP441 as the €5 alternative) | bol / Kiwi | ~€27 |
| 6 | Soil probes ×2 | DFRobot SEN0600 RS485 moisture + temperature, stainless, IP68 (Seeed S-Soil MTEC-02A with EC, €107 each, as the upgrade) | Berrybase | 2 × €26.90 = €53.80 |
| 7 | RS485 adapter | Waveshare industrial USB to RS485 | Opencircuit | €13.50 |
| 8 | Probe cable | outdoor 4-core 0.75 mm², 20 m, plus junction | Elektramat / Hornbach | ~€25 |
| 9 | Solar panel | Offgridtec 50 W mono 12 V (the 30 W at €25.98 does not carry December) | offgridtec.com | ~€40 |
| 10 | Battery | Offgridtec LiFePO4 12 V 18 Ah, BMS, 230 Wh | offgridtec.com | €41.64 (another shop lists €82.95; check) |
| 11 | Charge controller | Victron SmartSolar MPPT 75/10, load output, LiFePO4 preset | Obelink | €49.90 |
| 12 | 12 to 5 V buck | 5 V 3 A USB-C step-down (Pololu D24V22F5 €22.55 if you want the good one) | Kiwi / Eckstein | ~€10 |
| 13 | Scheduler | Witty Pi 4 (power on/off by schedule; the node runs ~10 h a day) | UUGear | ~€25 |
| 14 | Enclosure | IP65 polycarbonate box ~300×200×130 mm, hinged, transparent lid | Hornbach / Conrad | ~€35 |
| 15 | Cable glands ×4 | M20, IP68 | Reichelt | €3.96 |
| 16 | Post and mount | 2 m tube or fence post, 2 stainless hose clamps, cable lock, UV ties, silica, stake for the probe | Hornbach / Toolstation | ~€60 |

**Parts total: about €520** for one node (about €470 in verified lines, the rest estimated), plus shipping from several shops the first time. With the Seeed EC probes instead of the DFRobot ones: about €680. The earlier distributed set was €1,110.

## What was traded

- **Compute instead of radio.** A Pi 4 draws about 3 W while listening. That is the price of doing BirdNET at the edge; the reward is a ten-year SIM and no network on the farm.
- **Scheduled, not continuous.** A 50 W panel yields about 50 Wh a day in a Dutch December (PVGIS, 45° south). A Pi 4 plus modem running all day needs about 75 Wh. So the node listens on a schedule: from an hour before sunrise to five hours after, and around sunset, ten hours a day, about 35 Wh. The 18 Ah battery then carries five dark days. In summer the schedule extends into the night for crickets and frogs. Acoustic-index variance stabilises after about 120 hours of recording, so a schedule reads the same directions as a continuous stream.
- **Wired probes, one place per box.** Two probes on one 20 m cable run: 10 cm and 30 cm at one spot, 15 to 20 m into the field from the post.
- **Moisture and temperature, not EC.** The soil-breathing reading needs only those two. EC (nutrient leakage) is the first upgrade, with the Seeed probe.

## Before it ships

1. Flash the golden image (Raspberry Pi OS Lite, BirdNET-Go, the node agent, read-only root so power cuts cannot corrupt the card).
2. Register the place and three devices in the oracle; write the three device tokens and the APN into the node with `node/provision.sh`.
3. Insert the SIM, test an upload on the bench, note the modem's IMEI on the place.
4. Attach and label the two probe cables (10 cm, 30 cm), pack with the panel, the post clamps and the two-page sheet.

On the farm: post, box, panel facing south, probes in. "Last seen" turns green on the place page within twenty minutes.

## When the farm network does reach the field

If a place has WiFi at the field edge (a barn, a house), the earlier distributed set still works and needs no compute: a BirdWeather PUC (€289) on a Voltaic always-on battery, LoRaWAN probes and a gateway on the window sill. It is listed in the [hardware guide](/docs/hardware). The node is the default.

## Next step down: an integrated board

Everything in the box except the panel and battery could be one printed circuit board: an ESP32-S3 running a small bird classifier (the BirdWeather PUC proves it runs on that chip), an LTE-M module, an RS485 transceiver and a solar charger, bill of materials about €80 at a hundred units. That would put a node near €250 and cut the power draw ten-fold, which shrinks the panel and battery too. It is a firmware project of a few months, not a kit change; it starts once twenty v1 nodes have shown the streams are right. EasyComp Zeeland (NL) already assembles a €245 solar 4G BirdNET box on a Pi 4 with a €15/month data plan and may be a partner for v1 assembly.

## Order list

`kit/order-list.csv` in the repository carries the same lines with URLs, quantities and a verified/estimate flag per line.
