---
title: "Installation protocol: soil probe"
summary: "Depth, position, backfill and marking for moisture and temperature probes, and the LoRaWAN join."
order: 8
---

# Installation protocol: soil probe

## Where

- **Representative spot**, not the wettest corner, not the gateway: at least 20 m from the field edge, away from ditches, drains, gateways and tramlines.
- One probe per field at **10 cm**. For deep-rooting crops (maize, miscanthus, trees) add a second at **30 cm**. Register each as its own device with its `depthCm`.
- Note the position to a metre (phone GPS) and mark it: a short stake 30 cm away, or a buried magnet plus a note in the field map, so machinery does not hit it and you can find it in five years.

## How

1. Dig a hole wider than 20 cm to just below the target depth. Keep the soil in order of layers.
2. **Insert the prongs horizontally** into the undisturbed side wall at the target depth, fully, slowly, without rocking. Do not hammer. Stones break probes; if you hit one, move 20 cm.
3. Backfill in the original order and **firm to natural density**. Air gaps give low readings for months.
4. Route the cable up inside a piece of conduit to the transmitter box, mounted on a short post or stake above mowing height, antenna vertical.
5. Wait 24 to 48 hours before trusting the readings; the soil has to settle around the prongs.

## LoRaWAN join

1. Before you go to the field, add the device in The Things Stack (Sandbox or your operator) from the device repository (Dragino, Seeed, Milesight, Decentlab are all there) with its DevEUI, AppEUI/JoinEUI and AppKey from the label.
2. Set the uplink interval to **20 to 30 minutes**. That is about 10 s of airtime a day at SF7 to SF9, well inside the fair-use policy, and gives battery life of five years and more.
3. In the field, power on and watch the join in the console. No join: move the gateway, not the probe. A window-sill indoor gateway reaches 1 to 2 km; an outdoor one on a mast 3 to 8 km on flat land.
4. Add the webhook (see [data protocols](/docs/data-protocols)). The oracle shows "last seen" on the device within one uplink interval.

## Calibration

Factory calibration is for mineral soil. For peat or very sandy soil, note the soil type in the device notes; the oracle uses relative change over time (direction), so a constant offset does not change a reading. If you have a soil texture analysis, put it in the notes: it will be used when the texture-specific moisture curve lands.

## Maintenance

None planned. Check "last seen" quarterly. Battery replacement after 5 to 10 years depending on the model.
