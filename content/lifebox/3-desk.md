---
title: "Build it on the desk"
short: "Everything loose on the table, powered from the wall. One part at a time, and each one checked on your box page."
order: 3
parts: [Computer, "Scheduler + DC/DC", Storage, Bench supply, Instrument, I2S header, Microphone, Mic wiring, RS485 adapter, Soil probe, probe power, terminations, Modem, SIM]
---

## Lay out the parts

Put everything for this part on the table and tick it off against the list at the end of this part. Look at each soil probe's cable: it should have four wires, **brown, black, yellow and blue**. A cable with other colours: stop here and ask before you connect it, because a wrong wire on the power can break the probe.

![All the parts for one box laid out on a table, seen from above: enclosure with glands, laptop, Raspberry Pi with Witty Pi, meter, microphones, jumper wires, standoffs, ferrules, 4G stick, RS485 adapter, USB screw terminals, crimping pliers, two soil probes, charge controller, battery](../../public/img/build/2026-10-01-parts-laid-out.webp "Node 1, 1 October 2026: everything on the table before the build starts.")

Nothing goes into the enclosure yet. On the desk you can see every light and reach every wire.

> **Check.** Every line in the list has its part on the table.

## Put the Witty Pi on the Pi

The Witty Pi is the box's alarm clock: it switches the Pi on for the hours it should listen, and off for the rest. It sits on top of the Pi.

![The Witty Pi sits on the Raspberry Pi on four brass standoffs; its 40 pins come through on top, and that is where the microphone wires go](../../public/img/build/desk-stack.svg "From the bottom up: Raspberry Pi, standoffs, Witty Pi. The pins on top of the Witty Pi are the Pi's own 40 pins, passed through.")

1. Screw the four brass standoffs from the Witty Pi's bag into the corner holes of the Pi.
2. Press the Witty Pi onto the Pi's 40 pins, straight down, all the way, and screw it to the standoffs.
3. Put the small round battery (CR2032) in its holder on the Witty Pi, if one came with it. It keeps the clock running when the power is off.
4. Put the memory card into the slot on the underside of the Pi.

![The Witty Pi 4 seated on the Raspberry Pi, the row of 40 pins along its edge, the coin battery in its holder, the meter's cable in the Witty Pi's USB-C socket](../../public/img/build/2026-10-01-witty-pi-on-pi.webp "Node 1: the Witty Pi on the Pi. The 40 pins come through along the bottom edge; power goes into the Witty Pi's USB-C socket, at the top.")

The Pi's 40 pins come through on top of the Witty Pi, along its edge. The microphone connects to them in the next step.

From now on the power always goes into the **Witty Pi**, never into the Pi itself: the Witty Pi feeds the Pi, and that is how it can switch it on and off.

![The Raspberry Pi turned over: the memory card sits in the slot on its underside, at the end opposite the USB sockets](../../public/img/build/2026-10-01-card-in-pi.webp "Node 1, turned over: the memory card in its slot on the underside of the Pi, label facing out.")

Do not switch anything on yet.

## Wire the microphone

The microphone is the small round black board, about 14 mm across, with a tiny hole in the middle: that hole is where the sound goes in. It comes with two loose strips of three pins, which have to be soldered on first. If you have never soldered, ask someone who has; it takes five minutes.

1. Push both strips into the board from the side with the chip (the small metal block), long pins pointing up.
2. Turn it over and solder the six pins on the side with the hole.
3. Clip the short ends flush on that side, so the hole side lies flat against the port in the box later.

Then it connects with six short jumper wires to the pins on top of the Witty Pi. The names (VDD, GND, L/R, SCK, WS, SD) are printed next to the pins on the board; boards differ in the order, so go by the letters, not by where a pin sits. The Witty Pi pins are numbered: pin 1 is the corner pin at the memory-card end, away from the USB sockets and the battery, on the row towards the middle of the board. Odd numbers run along that row, even numbers along the row at the edge. The "P1" printed at the battery end is the name of the whole 40-pin header, not pin 1. To be sure, look under the Raspberry Pi: pin 1 is the only one with a square solder pad.

![The round INMP441 microphone and the Pi's header: L/R to pin 9, WS to pin 35, SCK to pin 12, SD to pin 38, VDD to pin 1, GND to pin 6; inset: solder the pin strips on the chip side, clip them flush on the hole side](../../public/img/build/desk-mic.svg "The header as it lies on the desk, USB sockets to the left. Six wires, each colour to its pin. L/R goes to ground, which makes it the left channel.")

| Microphone pin | Header pin | What it is |
| :-- | :-- | :-- |
| VDD | 1 | 3.3 V power |
| GND | 6 | ground |
| L/R | 9 | ground (left channel) |
| SCK | 12 | clock |
| WS | 35 | word select |
| SD | 38 | sound data |

Check each wire twice against the table, reading the letters on the board. Power on the wrong pin can break the microphone, nothing else.

## Switch on for the first time

![The desk with the Raspberry Pi and Witty Pi in front, the meter in the cable from the wall supply, soil probes, jumper wires and parts boxes behind](../../public/img/build/2026-10-01-desk-overview.webp "Node 1 on the desk. The meter sits between the wall supply and the Witty Pi, so you can read how much power the box uses.")

1. Plug the small black meter into the power supply, and the supply's cable from the meter into the **USB-C socket of the Witty Pi** (not the one on the Pi).
2. Plug the supply into the wall. If the Pi does not start by itself, press the button on the Witty Pi once.
3. Wait. The first start takes a few minutes and the box restarts itself once. A flickering green light is normal.

![Close-up of the meter's screen: 5.217 V, 0.351 A, 1.831 W](../../public/img/build/2026-10-01-meter.webp "The meter on node 1: volts, amps and, top right in yellow, watts. Watts is the number to write down.")

Write down the watts the meter shows after ten minutes. About 5 W is expected; that number decides how big the battery and panel need to be. Above 6.5 W, tell us via the feedback box at the bottom of this page.

On the desk the box wakes up once an hour and listens for 15 minutes, then switches itself off. That is the Witty Pi doing its job. When the box seems dead, look at the clock: it is waiting for the next hour.

> **Check.** On your box page, **The box is on** turns green. That can take up to 15 minutes after switching on.

## Let it hear a bird

Play a blackbird or a robin from your phone for a minute or two, with the phone's speaker 5 to 10 cm from the small hole in the microphone.

**Keep the room quiet while it plays: no talking, no radio, no television.** The box throws away every few seconds of sound in which it hears a human voice, birds included. That is on purpose: it is how the box keeps its promise that it never records people, and in a field it costs nothing. On a desk it means that a conversation next to the box, or a video with a narrator, gives no bird at all, and it looks exactly like a broken microphone.

So use a recording of the bird alone. [xeno-canto.org](https://xeno-canto.org) has field recordings of every species without commentary: search for *blackbird* or *Turdus merula*.

> **Check.** On your box page, **Microphone** turns green with the name of the bird. The box sends what it heard once an hour, so this light can take up to an hour. No bird after two tries: first try once more in a silent room with a recording that has no voice in it. Still nothing: check the six wires against the table. A microphone that is wired wrong gives no sound at all, not hiss.

## Connect the 30 cm soil probe, alone

Both probes leave the factory with the same address, so the box cannot tell them apart. You fix that by connecting **one probe first**: the box sees a single probe and gives it its own address by itself. Then the second one joins.

![Wiring diagram. One probe: brown to + and black to − on the USB screw terminal, yellow to A+ and blue to B− on the RS485 adapter; S, D− and D+ stay empty.](../../public/img/build/s1-probe-wiring.svg "Step 1 is this part: one probe. Step 2, in the next step, adds the second probe on the same terminals.")

1. Switch off: pull the power supply out of the wall.
2. Plug the **RS485 adapter** into a USB port of the Pi, and the **USB screw terminal** into another.
3. Take one probe; leave the other in its bag. No ferrules needed yet: the bare wires go straight into the terminals.
4. The USB screw terminal has five screws, marked **S, +, D−, D+, −**. **Brown** into **+** and **black** into **−**. The other three stay empty: **S** is the cable shield, not power, and a probe on S gets no power and stays silent. (Some terminals say VCC and GND instead: then brown into VCC, black into GND.) **Yellow** into **A+** and **blue** into **B−** of the RS485 adapter, not into D+ and D−. Tighten the screws and tug each wire.
5. Wrap a piece of tape around this probe's cable and write **30 cm** on it. The two probes look the same; from now on the tape is the only way to tell them apart.
6. Put the prongs in a glass of water and switch on.

> **Check.** On your box page, **Soil probe 30 cm** turns green, with a moisture close to 100% (the prongs are in water). Then switch off. Nothing on the light after an hour: check that brown sits in **+** and not in **S**, then try swapping yellow and blue. Neither mistake breaks anything.

## Add the 10 cm soil probe

1. Switch off.
2. Take the four wires of the taped probe out of their terminals.
3. Lay the second probe's wires next to them, **same colour with same colour**: brown with brown, black with black, yellow with yellow, blue with blue.
4. Twist each pair together tightly, same colour with same colour, so the strands of both wires make one bundle.
5. Put the four pairs back into the same terminals as before, tighten the screws, and tug both wires of each pair: neither may come out. Turn the screw firmly but not so hard that strands break.

A **ferrule is optional.** It holds the strands of both wires together, so the screw cannot push them apart, and it lasts longer in a box that gets warm and cold. Use one if a pair still slips out after you tighten the screw: put the pair into **one ferrule together** (one that holds two wires) and crimp it with the pliers. **Do not solder** the ends that go under a screw: solder slowly gives way under the pressure, so the screw loosens over the seasons and the probe drops out.
6. Prongs of both probes in the air this time, and switch on.

> **Check.** Both **Soil probe 10 cm** and **Soil probe 30 cm** are green with a fresh time, and the moisture now reads close to 0% (the prongs are in air). Hold the prongs of one probe in your hand for a minute: its temperature goes up on the next reading.

## Connect the 4G stick

The white stick is the box's own phone line, for the field where there is no WiFi.

![The white 4G stick opened with the SIM card in its slot, next to the RS485 adapter, two USB screw terminals, the crimping pliers and the box of ferrules](../../public/img/build/2026-10-01-stick-adapter-ferrules.webp "Node 1: the 4G stick open with its SIM in, the RS485 adapter and the two USB screw terminals in front, ferrules and crimping pliers behind.")

1. Slide the SIM into the stick.
2. Plug the stick into **your laptop** first. After half a minute, open [192.168.8.1](http://192.168.8.1) in your browser: that is the stick's own page.
3. Under the mobile network settings (often *Settings*, then *Profile management*), add a profile with the network name (APN) **iot.1nce.net**, save it, and make it the default.
4. When the stick's light shows it is connected, take it out of the laptop and plug it into the Pi.

> **Check.** On your box page, **4G** turns green after the next hourly wake-up. All lights green: the electronics work. Well done.
