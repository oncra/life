/*
 * life-guard: the tamper guard of a Life node. ATtiny84 on the Witty Pi 4's always-on 3V3 pin.
 *
 * Three normally-closed contacts to ground (lid, panel, tilt) on inputs with 1 M pull-ups and 100 nF to ground.
 * Asleep in power-down between contact changes: about 0.3 uA for the chip plus 3.3 uA per closed contact.
 *
 *   lid opens      -> ENTRY: a 50 ms chirp every 3 s, the Pi is booted; no valid window within 60 s -> SIREN
 *   panel or tilt  -> SIREN at once, the Pi is booted
 *   SIREN          -> continuous for 20 min, then a chirp every 5 s until disarmed (a beeping box, not a flat battery)
 *   DISARM pulse from the Pi (only ever sent after the oracle confirmed a maintenance window, or the node holds a
 *                  cached one): 0.1 to 1.5 s -> BYPASS 4 h; 2 s or longer -> BYPASS 24 h; two pulses within 1 s -> re-arm
 *   BYPASS         -> silent, green LED blink; at expiry re-arm, but only once every contact is closed (WAIT_CLOSE)
 *
 * To the Pi: ALARM (high in ENTRY/SIREN/CHIRP), LOOP_A/LOOP_B (00 none, 01 lid, 10 panel, 11 tilt; held until re-arm).
 * Those three lines double as the ISP lines, so the Pi programs the guard in circuit (node/firmware/life-guard/flash.sh).
 * SW pulses the Witty Pi SWITCH line through a MOSFET, and only when VOUT (the Pi's 5 V) is low: a tap on a running
 * Pi would shut it down.
 *
 * Board: ATTinyCore, ATtiny84, 1 MHz internal, BOD disabled, factory fuses. Compile: see README.md beside this file.
 */
#include <avr/sleep.h>
#include <avr/wdt.h>
#include <avr/interrupt.h>

// inputs
const uint8_t PIN_LID    = PIN_PA0;  // NC contact, magnet in the lid
const uint8_t PIN_PANEL  = PIN_PA1;  // NC contact on the panel bracket, magnet on the frame
const uint8_t PIN_TILT   = PIN_PA2;  // 45 degree tilt switch, closed upright
const uint8_t PIN_DISARM = PIN_PA3;  // from Pi GPIO 26, 100 k pull-down
const uint8_t PIN_VOUT   = PIN_PB2;  // Witty Pi VOUT through 10 k / 15 k divider: high = Pi is on
// outputs
const uint8_t PIN_LOOP_A = PIN_PA4;  // to Pi GPIO 11 (SCK when programming)
const uint8_t PIN_LOOP_B = PIN_PA5;  // to Pi GPIO 9  (MISO when programming)
const uint8_t PIN_ALARM  = PIN_PA6;  // to Pi GPIO 10 (MOSI when programming)
const uint8_t PIN_SIREN  = PIN_PA7;  // MOSFET gate, 12 V piezo siren
const uint8_t PIN_SW     = PIN_PB0;  // MOSFET gate, pulls Witty Pi SWITCH to ground
const uint8_t PIN_LED    = PIN_PB1;  // green LED through the wall, 1 k

enum State : uint8_t { ARMED, ENTRY, SIREN, CHIRP, BYPASS, WAIT_CLOSE };
enum Loop : uint8_t { NONE = 0, LID = 1, PANEL = 2, TILT = 3 };

const uint32_t ENTRY_MS       = 60000UL;        // chirps before the siren
const uint32_t SIREN_MS       = 20UL * 60000UL; // continuous siren before it drops to chirps
const uint32_t BYPASS_SHORT_S = 4UL * 3600UL;
const uint32_t BYPASS_LONG_S  = 24UL * 3600UL;

volatile bool woke = false;
State state = ARMED;
Loop lastLoop = NONE;
uint32_t stateSince = 0;     // millis() at entry into the state
uint32_t bypassLeftS = 0;    // counted down in 8 s watchdog ticks
uint32_t lastChirp = 0;
uint32_t lastDisarmEdge = 0; // for the double pulse

ISR(PCINT0_vect) { woke = true; }
ISR(WDT_vect) { woke = true; }

static bool contactOpen(uint8_t pin) { return digitalRead(pin) == HIGH; } // pull-up: closed contact reads LOW

static Loop openLoop() {
  // read twice 20 ms apart: a contact that bounces is not a contact that opened
  for (uint8_t pass = 0; pass < 2; pass++) {
    if (!contactOpen(PIN_LID) && !contactOpen(PIN_PANEL) && !contactOpen(PIN_TILT)) return NONE;
    delay(20);
  }
  if (contactOpen(PIN_PANEL)) return PANEL;   // the attractive part first
  if (contactOpen(PIN_TILT)) return TILT;
  if (contactOpen(PIN_LID)) return LID;
  return NONE;
}

static void showLoop(Loop l) { digitalWrite(PIN_LOOP_A, l & 1); digitalWrite(PIN_LOOP_B, (l >> 1) & 1); }

static void bootPi() {
  if (digitalRead(PIN_VOUT) == HIGH) return;  // already on; a tap would shut it down
  digitalWrite(PIN_SW, HIGH); delay(300); digitalWrite(PIN_SW, LOW);
}

static void chirp(uint16_t ms) { digitalWrite(PIN_SIREN, HIGH); delay(ms); digitalWrite(PIN_SIREN, LOW); }

static void enter(State s) {
  state = s; stateSince = millis(); lastChirp = 0;
  digitalWrite(PIN_ALARM, s == ENTRY || s == SIREN || s == CHIRP);
  digitalWrite(PIN_SIREN, s == SIREN);
  if (s == ARMED) { lastLoop = NONE; showLoop(NONE); digitalWrite(PIN_LED, LOW); }
}

/* DISARM: measure the pulse the Pi holds high. Returns 0 (none), 1 (short), 2 (long), 3 (double = re-arm). */
static uint8_t readDisarm() {
  if (digitalRead(PIN_DISARM) != HIGH) return 0;
  uint32_t t0 = millis();
  while (digitalRead(PIN_DISARM) == HIGH && millis() - t0 < 5000) delay(5);
  uint32_t len = millis() - t0;
  if (len < 60) return 0;                                   // noise
  uint8_t kind = len >= 2000 ? 2 : 1;
  if (millis() - lastDisarmEdge < 1000) kind = 3;           // second pulse within a second
  lastDisarmEdge = millis();
  return kind;
}

static void applyDisarm(uint8_t kind) {
  if (kind == 0) return;
  if (kind == 3) { if (openLoop() == NONE) enter(ARMED); else enter(WAIT_CLOSE); return; }
  bypassLeftS = kind == 2 ? BYPASS_LONG_S : BYPASS_SHORT_S;
  enter(BYPASS);
}

/* Sleep until a pin changes; with wdt8s also every 8 s, for the bypass countdown and the LED. */
static void sleepNow(bool wdt8s) {
  if (wdt8s) { wdt_reset(); WDTCSR = _BV(WDCE) | _BV(WDE); WDTCSR = _BV(WDIE) | _BV(WDP3) | _BV(WDP0); }
  else { wdt_reset(); WDTCSR = _BV(WDCE) | _BV(WDE); WDTCSR = 0; }
  set_sleep_mode(SLEEP_MODE_PWR_DOWN);
  woke = false;
  cli(); sleep_enable(); sei(); sleep_cpu(); sleep_disable();
}

void setup() {
  pinMode(PIN_LID, INPUT); pinMode(PIN_PANEL, INPUT); pinMode(PIN_TILT, INPUT); // external 1 M pull-ups
  pinMode(PIN_DISARM, INPUT); pinMode(PIN_VOUT, INPUT);
  pinMode(PIN_LOOP_A, OUTPUT); pinMode(PIN_LOOP_B, OUTPUT); pinMode(PIN_ALARM, OUTPUT);
  pinMode(PIN_SIREN, OUTPUT); pinMode(PIN_SW, OUTPUT); pinMode(PIN_LED, OUTPUT);
  digitalWrite(PIN_SIREN, LOW); digitalWrite(PIN_SW, LOW);
  ADCSRA &= ~_BV(ADEN);                       // ADC off: the single biggest sleep current
  GIMSK |= _BV(PCIE0);                        // pin change on port A
  PCMSK0 = _BV(PCINT0) | _BV(PCINT1) | _BV(PCINT2) | _BV(PCINT3);
  // power-up with a contact open (box being assembled) waits for it to close, like a house alarm with a door ajar
  chirp(30);
  enter(openLoop() == NONE ? ARMED : WAIT_CLOSE);
}

void loop() {
  uint32_t now = millis();
  switch (state) {
    case ARMED: {
      Loop l = openLoop();
      if (l != NONE) { lastLoop = l; showLoop(l); bootPi(); enter(l == LID ? ENTRY : SIREN); break; }
      applyDisarm(readDisarm());
      if (state == ARMED) sleepNow(false);
      break;
    }
    case ENTRY: {
      applyDisarm(readDisarm());
      if (state != ENTRY) break;
      Loop l = openLoop();
      if (l == PANEL || l == TILT) { lastLoop = l; showLoop(l); enter(SIREN); break; }
      if (now - stateSince >= ENTRY_MS) { enter(SIREN); break; }
      if (now - lastChirp >= 3000) { chirp(50); lastChirp = now; }
      delay(20);
      break;
    }
    case SIREN: {
      applyDisarm(readDisarm());
      if (state != SIREN) break;
      if (now - stateSince >= SIREN_MS) { enter(CHIRP); break; }
      delay(20);
      break;
    }
    case CHIRP: {
      applyDisarm(readDisarm());
      if (state != CHIRP) break;
      if (now - lastChirp >= 5000) { chirp(80); lastChirp = now; }
      delay(20);
      break;
    }
    case BYPASS: {
      uint8_t d = readDisarm();
      if (d) { applyDisarm(d); break; }
      digitalWrite(PIN_LED, HIGH); delay(10); digitalWrite(PIN_LED, LOW);
      if (bypassLeftS <= 8) { enter(openLoop() == NONE ? ARMED : WAIT_CLOSE); break; }
      bypassLeftS -= 8;
      sleepNow(true);
      break;
    }
    case WAIT_CLOSE: {
      uint8_t d = readDisarm();
      if (d) { applyDisarm(d); break; }
      if (openLoop() == NONE) { delay(5000); if (openLoop() == NONE) { enter(ARMED); break; } }
      digitalWrite(PIN_LED, HIGH); delay(10); digitalWrite(PIN_LED, LOW); delay(150);
      digitalWrite(PIN_LED, HIGH); delay(10); digitalWrite(PIN_LED, LOW);
      sleepNow(true);
      break;
    }
  }
}
