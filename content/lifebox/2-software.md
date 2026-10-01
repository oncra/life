---
title: "Make the software"
short: "An account, the software for your box, and the memory card. Only a laptop needed."
order: 2
---

## Make your account

Open [life.oncra.org/box](https://life.oncra.org/box) and type your email address. You get a mail with six digits; type them on the page. That is your account. There is no password to remember: next time you get a new code.

> **Check.** The page says *Signed in as* with your address.

## Make the software for your box

On the same page, give your box a name (anything: *Back field*, *Test box*) and type the name and password of the WiFi where you will build it. Capitals and spaces count. Press **Make the software for this box**. After about a minute a **Download** button appears.

The download is made for your box only: its WiFi password and its own keys to the oracle are inside, so you never type them on the box itself. Keep the file to yourself. The link on your box page stays; you can download it again any time.

Building the box somewhere else later, or taking it to the field? Make new software for it on the same page. The old card then stops sending, and the new one carries on where it left off.

> **Check.** Your box page shows a green **Download** button with a size of about 0.9 GB.

## Put it on the memory card

![The memory card in a card reader plugged into the laptop, the Raspberry Pi with the Witty Pi waiting beside it](../../public/img/build/2026-10-01-card-reader.webp "Node 1: the card goes in a card reader on the laptop for this step, not in the Pi.")

1. Download the file from your box page. Do not unpack it.
2. Install [Raspberry Pi Imager](https://www.raspberrypi.com/software/) on your laptop and open it.
3. **Device:** Raspberry Pi 4.
4. **Operating system:** scroll to the bottom, choose **Use custom**, and pick the file you downloaded.
5. **Storage:** the memory card. Check the size: choosing the wrong disk erases it.
6. When it asks about custom settings, choose **No**. Everything is already in the file.
7. Wait until it says it is done (about ten minutes), then take the card out.

> **Check.** Raspberry Pi Imager says *Write successful*.
