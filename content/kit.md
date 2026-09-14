---
title: "The kit: one box on one post"
summary: "Life node v1: a single solar-powered 4G box that hears (BirdNET), reads two wired soil probes and posts to the oracle. No farm network, no gateway, no WiFi. About €520 in parts, half the earlier set. Order list with suppliers and direct order links, checked 2026-09-13."
order: 3
---

# The kit: Life node v1

One box, one post, one radio. A landowner gets a sealed enclosure with a solar panel and two probe cables. They drive in a post, hang the box, push the probes into the ground. Everything else was done before it shipped. Prices checked on live shop pages on 2026-09-12 and rechecked, with the order list regrouped into shop baskets, on 2026-09-13. Incl. VAT.

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
| 9 | Solar panel | 100 W mono 12 V. A 50 W panel harvests in December exactly what the node eats, which is not a margin | offgridtec.com | ~€60 |
| 10 | Battery | Offgridtec LiFePO4 12 V 18 Ah, BMS, 230 Wh | offgridtec.com | €41.64 (another shop lists €82.95; check) |
| 11 | Charge controller | Victron SmartSolar MPPT 75/10, load output, LiFePO4 preset | Obelink | €49.90 |
| 12 | 12 to 5 V buck | 5 V 3 A USB-C step-down (Pololu D24V22F5 €22.55 if you want the good one) | Kiwi / Eckstein | ~€10 |
| 13 | Scheduler | Witty Pi 4 (power on/off by schedule; the node runs ~10 h a day) | UUGear | ~€25 |
| 14 | Enclosure | IP65 polycarbonate box ~300×200×130 mm, hinged, transparent lid | Hornbach / Conrad | ~€35 |
| 15 | Cable glands ×4 | M20, IP68 | Reichelt | €3.96 |
| 16 | Post and mount | 2 m tube or fence post, 2 stainless hose clamps, cable lock, UV ties, silica, stake for the probe | Hornbach / Toolstation | ~€60 |

**Parts total: about €520** for one node (about €470 in verified lines, the rest estimated), plus shipping from several shops the first time. With the Seeed EC probes instead of the DFRobot ones: about €680. The earlier distributed set was €1,110.

## How it is mounted

A node in an arable field has two predators: people who take things, and the sprayer that never saw it. Both are answered by the same choice, which is to keep the solid part of the node below the crop and put only a 6 mm rod above it.

![Structural drawing of the low-profile field mount: side and front elevation, enclosure interior and probe trench](/img/life-node-low-mount.svg)

Nothing stands higher than 890 mm, and nothing sticks up at all. The enclosure sits at 300 mm above grade, clear of splash and standing water, on a 60 x 60 post driven 600 mm with no concrete and no spoil heap to mark the spot. The panel is tilted 40° south directly over the box, where it doubles as the sunshade and rain cap that the heat and condensation problems both want. Everything is matt green, without branding or reflective labels, and a cable lock passes through the post and the enclosure lugs.

The microphone and the 4G antenna sit inside the box as well, which is the simpler build and, as it turned out, the cheaper one. A microphone cannot hear through a sealed wall, so the enclosure gets a 5 mm port with an ePTFE acoustic membrane behind it, the same trick every outdoor recorder uses: under 2 dB of loss between 1 and 5 kHz, and still IP67. With the capsule inside, the I2S run is about ten centimetres rather than an impossible metre and a half, so the €3.10 INMP441 does the job and the lavalier and its sound card come back off the bill. The 4G stick radiates through the polycarbonate for a few dB. What would actually ruin it is the galvanised steel mounting plate the enclosure ships with, so that stays out and the boards go on a cut sheet of plastic instead.

The price of this is acoustic. A capsule at 300 mm behind a membrane hears a smaller circle than one on a mast, and crop rustle sits closer to it. That is a real reduction in the evidence behind Diversity and Renewal, and the answer if it proves too small is more nodes rather than taller ones.

Power survives the low mount because of a coincidence worth stating plainly: December is both the month with no margin and the month with no crop. The panel is unshaded exactly when it matters. Under a summer canopy the harvest falls to roughly 80 Wh a day against a 50 Wh load, which is thin but positive, and it is the second reason the panel is 100 Wp rather than 50.

The remaining risk is not theft. A box this low is invisible to a sprayer too, so the position goes on the farmer's own GPS, and a headland or the edge of a tramline beats the middle of the crop.

## Cabling

The bill of materials above lists boxes. Boxes do not talk to each other, and the wire between them turned out to be about a hundred euros that the first list did not have in it.

![Enclosure wiring: interior layout with cable routing, one-line schematic and the cable schedule](/img/life-node-wiring.svg)

Two decisions are worth stating rather than leaving in the drawing. The buck converter and the probes both hang on the charge controller's **load output**, not on the battery directly. That gets Victron's low-voltage disconnect between the electronics and the cells for free, and it is also what stops the probes drawing power through the fourteen hours a day the node is asleep. And the battery lead carries an inline **15 A fuse** at the battery end, which is not optional on a lithium cell that can deliver a hundred amps into a shorted screwdriver.

Three things will bite a first build, so they are written on the drawing:

- **Both probes ship as Modbus address 1.** Put one on the bench alone, write register `0x07D0` to set it to 2, then do the other. Two probes on one address collide and neither reads.
- **The SEN0600 has moisture and temperature only**, no EC register, so it uses the `sen0600` profile in `node/life-soil-agent.py` and reads two registers. The `generic-thc` profile reads three and would fail here.
- **The probe wire colours are not published.** Meter them before splicing. The family convention is brown +V, black ground, yellow A, blue B, but convention is not a datasheet.

One conflict is still open. The Witty Pi sits on the GPIO header, and the microphone needs the I2S pins on that same header, so the build wants a stacking header underneath it. Check that the Witty Pi does not itself use those pins before ordering.

## What was traded

- **Compute instead of radio.** A Pi 4 draws about 3 W while listening. That is the price of doing BirdNET at the edge; the reward is a ten-year SIM and no network on the farm.
- **Scheduled, not continuous, and seasonal.** PVGIS 5.2 for 52.1° N at 45° south gives a 50 W panel about 50 Wh a day in December and 200 Wh in June. A Pi 4 running BirdNET with a 4G stick attached draws somewhere between 3.5 and 7 W; at 5 W for ten hours that is 50 Wh a day, which in December is exactly the harvest and therefore no margin at all. So two things changed after the design was stress-tested: the panel is 100 W, and the schedule is seasonal rather than fixed, dropping to five or six hours a day from November to January. In summer it extends into the night for crickets and frogs. Acoustic-index variance stabilises after about 120 hours of recording, so a schedule reads the same directions as a continuous stream. **The draw itself is still an estimate**: measure it with an inline USB meter on the bench before trusting any of these numbers.
- **Wired probes, one place per box.** Two probes on one 20 m cable run: 10 cm and 30 cm at one spot, 15 to 20 m into the field from the post.
- **Moisture and temperature, not EC.** The soil-breathing reading needs only those two. EC (nutrient leakage) is the first upgrade, with the Seeed probe.

## Cheaper builds

€520 is the verified build with new parts from named shops. About €200 of it is not measurement. Reading the code rather than guessing: `cycling()` compares a soil-activity index **at one place, year over year**, and Diversity counts species per calendar year, so a stable sensor offset cancels while gaps and changes of equipment do not. That says number of nodes matters more than the grade of any one node, and it says exactly what is safe to cut.

- **Free**: the second probe (`cycling()` pools depths and never reads `depthCm`, so the 30 cm probe buys no reading today), a plainer enclosure and mount, a second-hand computer and modem. The scheduler comes off too if the charge controller's timed load output can express a sunrise-relative window; check that, because a Pi cannot wake itself.
- **Cheap with a condition**: a €5 I2S microphone instead of the €27 lavalier, and a generic RS485 probe instead of the DFRobot. Both are fine **only if one type is frozen across every node in the network**, because a change of sensor between nodes is a systematic offset in the counts the readings compare. Spend part of the saving on the acoustic port and on an oven-dry calibration per probe, stored in the device `mapping`.
- **Do not cut**: the MPPT charge controller for a PWM one, the endurance SD card, the panel back down to 50 W, or the surge protection on the RS485 adapter. A 10 to 20% harvest loss is a winter gap, and a gap moves the very annual mean that Cycling compares. Twenty-nine euros of SD card is cheaper than a site visit, and the twenty-metre probe cable is a lightning collector in an open field.

That lands a field node near €300 to €330 and a bench node near €85. Those two numbers are indicative: they depend on second-hand and generic prices that are not verified in the order list, unlike the €520.

## Before it ships

1. Flash the golden image (Raspberry Pi OS Lite, BirdNET-Go, the node agent, read-only root so power cuts cannot corrupt the card).
2. Register the place and three devices in the oracle; write the three device tokens and the APN into the node with `node/provision.sh`.
3. Insert the SIM, test an upload on the bench, note the modem's IMEI on the place.
4. Attach and label the two probe cables (10 cm, 30 cm), pack with the panel, the post clamps and the two-page sheet.

On the farm: post, box, panel facing south, probes in. "Last seen" turns green on the place page within twenty minutes.

## Where this design is most likely to fail

Written down so that the first build knows what to watch, and so that a later failure is a confirmed prediction rather than a surprise. In rough order of how likely each one is to bite.

1. **Winter power.** The largest risk and the reason the panel went from 50 to 100 W. The harvest figure is solid (PVGIS); the draw figure is not, because nobody has measured this node yet. If the real draw is 7 W rather than 5, a 50 W panel misses December by 20 Wh a day and the 230 Wh battery covers nine days before the node goes dark, less after an overcast week. Measure first, then size.
2. **The battery will not charge below freezing.** LiFePO4 suffers lithium plating if charged below 0 °C, and the damage is cumulative and permanent. A good BMS refuses the charge, which protects the cells and flattens the node instead. In a Dutch frost week both outcomes are an outage. Check the cutoff on the datasheet, insulate the battery inside the enclosure, and let the electronics' waste heat work for you.
3. **The buffered queue lives in RAM.** `life-soil-agent.py` writes its offline queue to `/var/lib/life-node/`, and the provisioning script switches the root filesystem to a read-only overlay. Under that overlay the queue is in RAM, so a power cut loses exactly the readings the queue exists to protect. It needs a small writable partition.
4. **Heat in a sealed box.** An IP65 enclosure in full sun runs well above ambient, and a Pi 4 throttles at 80 °C. Mount the box on the shaded face of the post, let the panel shade it, and fit one vented membrane gland. The same gland handles condensation, which is the winter version of the same problem.
5. **The probes draw power all day.** Two RS485 probes left powered pull roughly 0.4 W around the clock, close to 10 Wh a day, which is a fifth of the December budget for readings taken every twenty minutes. Switch them with the Pi's rail rather than wiring them straight to the battery.
6. **A hung node is silent.** Nothing recovers a wedged Pi. `lastSeenAt` on the place page tells the oracle something is wrong, but only a visit fixes it. Enable the Pi's hardware watchdog and the scheduler's heartbeat; both are free.
7. **The register maps are from datasheets.** Three probe profiles in the agent, none verified against a physical probe. Expect one to be wrong and plan the bench session around finding out.
8. **The 4G stick next to a steel plate.** The chosen enclosure ships with a galvanised steel mounting plate. Keep the modem and its antenna away from it, or accept a weaker signal than the coverage map promises.

## When the farm network does reach the field

If a place has WiFi at the field edge (a barn, a house), the earlier distributed set still works and needs no compute: a BirdWeather PUC (€289) on a Voltaic always-on battery, LoRaWAN probes and a gateway on the window sill. It is listed in the [hardware guide](/docs/hardware). The node is the default.

## Next step down: an integrated board

Everything in the box except the panel and battery could be one printed circuit board: an ESP32-S3 running a small bird classifier (the BirdWeather PUC proves it runs on that chip), an LTE-M module, an RS485 transceiver and a solar charger, bill of materials about €80 at a hundred units. That would put a node near €250 and cut the power draw ten-fold, which shrinks the panel and battery too. It is a firmware project of a few months, not a kit change; it starts once twenty v1 nodes have shown the streams are right. EasyComp Zeeland (NL) already assembles a €245 solar 4G BirdNET box on a Pi 4 with a €15/month data plan and may be a partner for v1 assembly.

## Order list

`kit/order-list.csv` in the repository carries every line with a direct order link, a price and a check date, grouped into shop baskets so the parts arrive in as few parcels as possible. **A** Berrybase, about €185 and seven lines: computer, storage, microphone, both probes, the RS485 adapter, the scheduler and a power meter. **B** reichelt, about €101: enclosure, glands, charge controller, each with its reichelt product number so the three go in through their Direct order form in one pass. **C** offgridtec, about €102: panel and battery. Then one SIM, one modem and one trip to a builders' merchant for the post and the cable. Five shops plus a basket of cable and connectors, about €620 in parts and roughly €30 in postage. Neither German shop ships free at this size: Berrybase is €9.90 to the Netherlands and free only from €250, reichelt is €6.95. Rows marked `alt` are the parts that were considered and not taken, with the reason, including the cheaper charge controller that costs an extra shipment.
