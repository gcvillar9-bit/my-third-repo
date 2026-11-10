/**
 * Grand Tour: the Sun and every planet from the inside out, then the whole system in motion.
 * Stops are bookmarks and body ids of other modules; missing ones are skipped with their captions.
 * Figures are rounded textbook values (see docs/modules/tours.md for sources).
 */
import type { TourDef } from '../../core/contracts';

export const GRAND_TOUR_ID = 'grand-tour';

export const GRAND_TOUR: TourDef = {
  id: GRAND_TOUR_ID,
  title: 'Grand Tour of the Solar System',
  description: 'The Sun and all eight planets from the inside out (about 4 minutes).',
  steps: [
    { type: 'caption', text: 'Grand Tour: the Sun and its worlds, from the inside out.' },
    { type: 'goto', target: 'sun-closeup', duration: 6 },
    {
      type: 'caption',
      text: 'The Sun: 1.39 million km across, holding 99.86% of the mass of the Solar System. Each bright granule on its surface is a rising column of hot gas about 1,000 km wide.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'mercury', duration: 7 },
    {
      type: 'caption',
      text: 'Mercury: the smallest planet and the closest to the Sun, with a year of 88 days. Almost airless, it swings from 430 °C by day to −180 °C at night.',
    },
    { type: 'orbit', target: 'mercury', degrees: 20, duration: 8 },
    { type: 'goto', target: 'venus', duration: 7 },
    {
      type: 'caption',
      text: 'Venus: nearly the size of Earth, wrapped in clouds of sulphuric acid. The ground below is about 465 °C under 92 times the pressure of our air.',
    },
    { type: 'orbit', target: 'venus', degrees: 20, duration: 8 },
    { type: 'goto', target: 'earth-limb-400km', duration: 7 },
    {
      type: 'caption',
      text: 'Earth: liquid water over 71% of its surface, and the only world known to carry life.',
    },
    { type: 'wait', seconds: 8 },
    { type: 'goto', target: 'moon-low-orbit', duration: 6 },
    {
      type: 'caption',
      text: 'The Moon: most likely born from a giant impact about 4.5 billion years ago. It keeps the same face turned toward Earth.',
    },
    { type: 'wait', seconds: 8 },
    { type: 'goto', target: 'mars', duration: 7 },
    {
      type: 'caption',
      text: 'Mars: half the width of Earth, a cold desert with the tallest volcano known (Olympus Mons, about 22 km high) and a canyon system 4,000 km long.',
    },
    { type: 'orbit', target: 'mars', degrees: 25, duration: 9 },
    { type: 'goto', target: 'asteroid-belt-3au', duration: 7 },
    {
      type: 'caption',
      text: 'The asteroid belt, brightened here so it can be seen: millions of rocky bodies that together weigh only about 3% of the Moon.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'jupiter-io-shadow', duration: 7 },
    {
      type: 'caption',
      text: 'Jupiter: more than twice the mass of all the other planets put together. The dark spot crossing its clouds is the shadow of its moon Io.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'saturn', duration: 7 },
    {
      type: 'caption',
      text: 'Saturn: its main rings span about 280,000 km yet are mostly only some ten metres thick, countless pieces of water ice from dust to boulders.',
    },
    { type: 'orbit', target: 'saturn', degrees: 30, duration: 10 },
    { type: 'goto', target: 'uranus-rings', duration: 7 },
    {
      type: 'caption',
      text: 'Uranus: an ice giant tipped over by 98 degrees, so each pole spends decades in sunlight and then decades in darkness during its 84-year orbit.',
    },
    { type: 'wait', seconds: 9 },
    { type: 'goto', target: 'neptune', duration: 7 },
    {
      type: 'caption',
      text: 'Neptune: 30 times farther from the Sun than Earth, with the fastest winds measured on any planet, about 2,000 km/h.',
    },
    { type: 'orbit', target: 'neptune', degrees: 20, duration: 8 },
    { type: 'goto', target: 'pluto', duration: 7 },
    {
      type: 'caption',
      text: 'Pluto: a dwarf planet of the Kuiper belt, with plains of nitrogen ice and a moon, Charon, half as wide as Pluto itself.',
    },
    { type: 'orbit', target: 'pluto', degrees: 20, duration: 8 },
    { type: 'goto', target: 'solar-system-overview', duration: 8 },
    { type: 'timeRate', rate: 2e6 },
    {
      type: 'caption',
      text: 'All of it in motion, at 23 days per second. Sunlight takes 8 minutes to reach Earth and more than 4 hours to reach Neptune.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'timeRate', rate: 1 },
    { type: 'goto', target: 'earth-now', duration: 9 },
    { type: 'caption', text: 'And back to the one with oceans. Welcome home.', seconds: 7 },
    { type: 'wait', seconds: 7 },
  ],
};
