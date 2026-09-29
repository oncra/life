---
title: "Stage 2. The power chain"
short: "Battery, charge controller and scheduler. Three unattended cycles, and Wh per day measured."
order: 3
stage: "2"
produces: "battery, MPPT and scheduler running the node on their own"
gate: "three unattended boot-work-shutdown cycles, and a measured Wh/day"
status: later
parts: [Charge controller, Battery, "Scheduler + DC/DC", W2 battery lead, W2 fuse, Solar panel]
---

# Stage 2. The power chain

**2.1 Assemble in this order, battery last.** MPPT load output to the Witty Pi's DC input (6 to 30 V, its own 30 cm XH2.54 lead). Witty Pi onto the Pi's header, above the stacking header. Probes on 5 V from the USB screw-terminal adapter, so they switch with the Pi. **Then** the fused battery lead: the 15 A inline fuse within a hand's width of the battery post. The panel stays on the windowsill; indoors in autumn a 100 W panel behaves like a 10 W panel outdoors, which is a fine way to test a charge controller. Victron preset: LiFePO4.

**2.2 Schedule.** Set the Witty Pi to the `bench` script first (fifteen minutes awake in every hour) so a day gives a dozen cycles. Confirm `life-flush.service` runs before shutdown and the queue is empty afterwards, and that the `shutdown` heartbeat arrives. Only then set the real seasonal schedule: about ten hours a day March to October, one hour a day November to February, at a fixed clock time.

**2.3 Brown-out and recovery.** Pull the supply mid-cycle, three times. The node must come back on its own with no card corruption and no lost queue. This is the most likely field failure and the cheapest to test.

**2.4 Twenty-four hours unattended**, meter logging. Compare with the model: 54.6 Wh/day summer, 9.6 winter, and a 4.6 Wh/day floor from the controller's own consumption with the node off. More than about 20 percent above the model means the kit page's energy section is wrong and gets corrected, not explained.

## Gate

Three unattended cycles completed, and a measured Wh/day in the log.
