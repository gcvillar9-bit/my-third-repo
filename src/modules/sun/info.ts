/**
 * Simulated-activity lines for the Sun's info card (three-free). The card itself comes from solar-system;
 * index.ts decorates it so the procedural sunspots, prominences and filaments are labelled "simulated".
 */
import type { InfoCard, InfoFact } from '../../core/contracts';
import { activeGroups, sunspotNumber } from './activity';
import data from './sun-data.json';

export const SIMULATED_NOTE =
  'Sunspots, pores, faculae, prominences, filaments and flares are simulated: their number, latitudes ' +
  'and rotation follow the solar cycle (Hathaway cycle shape, Sporer and Joy laws, Snodgrass rotation), ' +
  'but their positions and shapes are not real observations.';

/** Activity facts at `jd` (all marked approximate and simulated). */
export function activityFacts(jd: number, filter: 'off' | 'halpha'): InfoFact[] {
  const groups = activeGroups(jd);
  return [
    {
      label: 'Sunspot number (simulated cycle)',
      value: Math.round(sunspotNumber(jd)),
      approximate: true,
      source: data.cycle.source,
    },
    {
      label: 'Spot groups on the whole Sun',
      value: `${groups.length} (simulated)`,
      approximate: true,
      source: data.spots.source,
    },
    { label: 'Sunspots, prominences, filaments', value: 'simulated (not real positions)', approximate: true },
    {
      label: 'Solar filter',
      value: filter === 'halpha' ? 'H-alpha 656.3 nm (simulated look)' : 'Off (white light)',
    },
  ];
}

/** The Sun's card with the simulated-activity facts appended and the note in its description. */
export function withActivity(card: InfoCard, jd: number, filter: 'off' | 'halpha'): InfoCard {
  return {
    ...card,
    facts: [...card.facts, ...activityFacts(jd, filter)],
    description: card.description ? `${card.description} ${SIMULATED_NOTE}` : SIMULATED_NOTE,
  };
}
