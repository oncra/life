---
title: "Installation protocol: soil probe"
summary: "Choosing the spot, depth, backfill and marking for moisture and temperature probes, wiring them into the node, and the LoRaWAN join for probes that stand alone."
order: 10
---

# Installation protocol: soil probe

## Where

The probes read the soil under the plants right above them, and the water loop reads what the roots of those plants do ([the soil's water loop](soil-water.md)). So the spot decides what the reading is about. Choose it in four steps.

1. **Decide what the node speaks for.** One part of the place: the meadow, the field, a tree row, the alley between two rows, the shrub layer of a food forest, the margin. One node speaks for one part; another part that matters needs its own node. Write the part in the device notes, because the reading says nothing about the parts it does not stand in.
2. **Pick a typical spot on the map, before going out.** Inside that part: its most common soil type (the national soil map; SoilGrids elsewhere), not in a hollow or on a ridge (the AHN height map in the Netherlands, a contour map elsewhere), and a spot that looks like the rest of the part on aerial photos of several years, not wetter, barer or greener. Away from ditches, drains, gateways, tramlines and headlands, and about a tree height from a hedge or tree line, unless the part is that tree line. The panel needs its winter sun ([the kit](kit.md)); if the probe spot is shaded, the panel can stand a few metres away on a longer solar cable, the probes cannot.
3. **Check it on the spot.** The plants there are the plants of the part, the same grass, crop or herb layer, with no bare patch, rut, old track or wet hollow. The soil in the pit looks like the soil around it, without rubble or a drain.
4. **Agree how it is managed.** The farmer mows, grazes, sows and harvests over the probes as over the rest; only the post is in the way. A ring that is left alone grows its own plants, and the reading follows the ring: on the Twente network the water loop gives about 0.6 under permanent grass and about 0.4 under maize, so weeds round a post in a maize field would read more like grass than like maize.

With a [node](kit.md) both probes sit at one spot, at **10 and 30 cm** (the water loop reads the top 40 cm as two layers), **1.5 m south of the post** on their own 2 m leads. South because the panel's shadow always falls north; along a tree row running east to west, east or west of the post will do when south leads out of the part. The disturbances of the post itself are all under a metre: a drip line reaches 0.3 to 0.5 m, the disturbed ground round a driven post 0.2 to 0.3 m. Register each probe as its own device with its `depthCm`.

| Land | Where the node stands | What the reading speaks for |
| --- | --- | --- |
| Permanent grass | inside the field at a typical spot; machines pass the post | the field |
| Agroforestry | in a tree row | the row and its edge; the middle of an alley is out of reach of 2 m leads |
| Food forest | under its most common cover, not on a path | that cover |
| Orchard | in the grass between two rows, or in the tree strip | the strip chosen |
| Ploughed arable | at the field edge, or lifted before ploughing and put back | the edge; or a new series every year ([kit](kit.md)) |

Note the position to a metre (phone GPS), take a photo of the spot looking north, and mark it: a short stake 30 cm away, or a buried magnet plus a note in the field map, so machinery does not hit it and you can find it in five years.

## How

1. Dig a hole wider than 20 cm to just below the target depth. Keep the soil in order of layers.
2. **Insert the prongs horizontally** into the undisturbed side wall at the target depth, fully, slowly, without rocking. Do not hammer. Stones break probes; if you hit one, move 20 cm.
3. Backfill in the original order and **firm to natural density**. Air gaps give low readings for months.
4. Route the 2 m lead back to the box through a downward gland, with the slack pinned down under a peg or a short length of conduit where it crosses ground that gets mown. A stand-alone LoRaWAN probe has its transmitter on a short stake instead, above mowing height, antenna vertical.
5. Wait 24 to 48 hours before trusting the readings; the soil has to settle around the prongs.

## Wiring into the node (standard)

Each probe keeps its own factory lead and goes straight through its own gland into the box: 5 V and ground from a USB breakout on the Pi, so the probes are powered exactly when the Pi is, and the RS485 pair to the adapter. No extension cable, no junction box. Set each probe to its own Modbus address (10 cm and 30 cm) before it goes in the ground, because reaching it afterwards means digging.

1. Register both probes as their own devices on the place, each with its `depthCm`, and write the two device tokens into the node with `node/provision.sh`.
2. Bench-test before you dig. `life-soil-agent --scan` walks the Modbus addresses and prints the raw registers next to the decoded values, which is how you catch a register map that does not match its datasheet, and `life-soil-agent --set-address 2 --addr 1` writes the new address, with only that probe on the bus. Both probes leave the factory on address 1 and will collide. The order of work is in the [build plan](build.md).
3. In the field, connect, then watch one reading arrive. The node posts every 20 minutes and buffers to disk when the modem is down, so a gap in coverage is a delay and not a loss.
4. Note both depths and the position on the place. "Last seen" moves within one interval.

## LoRaWAN join (stand-alone probes)

1. Before you go to the field, add the device in The Things Stack (Sandbox or your operator) from the device repository (Dragino, Seeed, Milesight, Decentlab are all there) with its DevEUI, AppEUI/JoinEUI and AppKey from the label.
2. Set the uplink interval to **20 to 30 minutes**. That is about 10 s of airtime a day at SF7 to SF9, well inside the fair-use policy, and gives battery life of five years and more.
3. In the field, power on and watch the join in the console. No join: move the gateway, not the probe. A window-sill indoor gateway reaches 1 to 2 km; an outdoor one on a mast 3 to 8 km on flat land.
4. Add the webhook (see [data protocols](data-protocols.md)). The oracle shows "last seen" on the device within one uplink interval.

## Calibration

Factory calibration is for mineral soil. For peat or very sandy soil, note the soil type in the device notes; the oracle uses relative change over time (direction), so a constant offset does not change a reading. If you have a soil texture analysis, put it in the notes: it will be used when the texture-specific moisture curve lands.

## Maintenance

None planned. Check "last seen" quarterly. A wired probe on a node has no battery; a LoRaWAN probe needs one every 5 to 10 years depending on the model. If "last seen" goes stale on a node, both streams go stale together, which points at the box or the modem rather than at the probe.
