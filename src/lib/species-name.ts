// What counts as a species. Besides animals, a classifier names sounds: BirdNET's classes Engine, Dog, Siren, Fireworks,
// Gun, Noise, Environmental, Human vocal, Human whistle, Power tools, and their like in Perch and BirdNET+ V3.0. They reach
// the oracle as detections like any other, with the class name in both name fields. They stay in the data, as sound
// heard, but they are not life: no species count, list, reading or open feed counts them. On node 1 between 9 and 23
// November 2026 they were Engine 36 times, Dog 5, Siren 1 and Fireworks 1 at 0.7 or more, and the open feed showed a dog
// among the four species the climatecleanup.org home page lists.
//
// A species is a Latin binomial: a genus with a capital and an epithet in lower case ("Pica pica"). A sound class is one
// English word, or a phrase that happens to look like a binomial, which the list below names.

/** the multi-word sound classes that pass the binomial test */
/** BirdNET v2.4's, and BirdNET+ V3.0's (whose 16 sound classes include these three; checked on its Central Europe labels) */
export const NOT_SPECIES = ["Human vocal", "Human whistle", "Human non-vocal", "Power tools", "Motor vehicle", "Power tool", "Vehicle horn"];

/** the binomial test, as a Postgres regular expression too: `coalesce(scientific, species) ~ ${SPECIES_RE}` */
export const SPECIES_RE = "^[A-Z][a-z]+ [a-z]";

export function isSpecies(name: string | null | undefined): boolean {
  const n = (name ?? "").trim();
  return new RegExp(SPECIES_RE).test(n) && !NOT_SPECIES.includes(n);
}
