import LineIcon from "./LineIcon";

// Simple line icons for the roles on the home page ("Start where you stand"), so a visitor finds their own at a glance.
const PATHS = {
  // a sprout on the ground: the steward of the land
  steward: <><path d="M5 20h14" /><path d="M12 20v-8" /><path d="M12 12c0-3.6-2.6-6.2-6.6-6.2 0 3.6 2.6 6.2 6.6 6.2z" /><path d="M12 14.4c0-3.1 2.3-5.6 6.1-5.6 0 3.1-2.3 5.6-6.1 5.6z" /></>,
  // a Life Node: a tilted solar panel and the box on a post
  node: <><path d="M5 6.6l10-3.1 2.2 2.6-10 3.1z" /><path d="M6.1 7.9l10-3.1M10 5.05l2.2 2.6" /><path d="M12 7.7V11" /><rect x="8.5" y="11" width="7" height="5" rx="1" /><path d="M12 16v4.5" /><path d="M7.5 20.5h9" /></>,
  // a clipboard with a tick: visits and what they record
  verifier: <><rect x="5.5" y="4.5" width="13" height="16" rx="2" /><rect x="9" y="3" width="6" height="3" rx="1" /><path d="M9 13.2l2.1 2.1 4-4.6" /></>,
  // an institution: funders, buyers and registries
  funder: <><path d="M4 9.5L12 5l8 4.5" /><path d="M5 9.5h14" /><path d="M7 11.5v5.5M12 11.5v5.5M17 11.5v5.5" /><path d="M4.5 19.5h15" /></>,
  // a flask: method and evidence
  researcher: <><path d="M9.5 3.5h5" /><path d="M10.5 3.5v5.2l-4.9 8.6a2 2 0 0 0 1.7 3h9.4a2 2 0 0 0 1.7-3l-4.9-8.6V3.5" /><path d="M7.6 14.5h8.8" /></>,
  // code brackets: a program reading the API
  agent: <><path d="M8.5 8L4.5 12l4 4" /><path d="M15.5 8l4 4-4 4" /><path d="M13.4 5.8l-2.8 12.4" /></>,
} as const;
export type Persona = keyof typeof PATHS;

export default function PersonaIcon({ persona, className }: { persona: Persona; className?: string }) {
  return <LineIcon className={className}>{PATHS[persona]}</LineIcon>;
}
