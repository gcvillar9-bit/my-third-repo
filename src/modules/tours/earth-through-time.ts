/**
 * Earth through time: from Pangaea to tonight's city lights. Every stop is a bookmark that sets
 * its own date (paleo, life and cities modules); the last stop returns the clock to now.
 * Reconstructions are approximate and say so; ages and figures are rounded textbook values.
 */
import type { TourDef } from '../../core/contracts';

export const EARTH_THROUGH_TIME_ID = 'earth-through-time';

export const EARTH_THROUGH_TIME: TourDef = {
  id: EARTH_THROUGH_TIME_ID,
  title: 'Earth Through Time',
  description: 'From Pangaea and the dinosaurs to the first cities and today (about 4 minutes).',
  steps: [
    {
      type: 'caption',
      text: 'Earth through time: 250 million years in four minutes. Continents, climates and creatures are reconstructions, and approximate.',
    },
    { type: 'goto', target: 'earth-pangaea-250ma', duration: 6 },
    {
      type: 'caption',
      text: 'About 250 million years ago nearly all land is joined in one supercontinent, Pangaea, surrounded by a single world ocean.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'life-permian-252ma', duration: 7 },
    {
      type: 'caption',
      text: 'On the ground at the end of the Permian: armoured pareiasaurs, tusked dicynodonts and sabre-toothed gorgonopsians. Most of them are about to vanish in the largest mass extinction known.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'life-jurassic-150ma', duration: 8 },
    {
      type: 'caption',
      text: 'The Late Jurassic, 150 million years ago: Stegosaurus and long-necked sauropods among conifers and ferns. There are no flowers and no grass yet.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'earth-seaway-90ma', duration: 8 },
    {
      type: 'caption',
      text: 'About 90 million years ago, in a hot world without polar ice, the seas stand so high that a shallow seaway splits North America in two.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'life-trex-66ma', duration: 8 },
    {
      type: 'caption',
      text: 'The last days of the Cretaceous, 66 million years ago: Tyrannosaurus, Triceratops and duck-billed hadrosaurs, shortly before an asteroid impact ends the age of the dinosaurs.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'life-lucy-3ma', duration: 8 },
    {
      type: 'caption',
      text: 'Hadar, Ethiopia, 3.2 million years ago: Australopithecus afarensis, the species of the fossil "Lucy", walks upright among elephants and giraffes.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'life-mammoth-45ka', duration: 8 },
    {
      type: 'caption',
      text: 'The mammoth steppe, 45,000 years ago: woolly mammoths and wild horses, Neanderthals, and the first modern humans to reach Europe.',
    },
    { type: 'wait', seconds: 11 },
    { type: 'goto', target: 'earth-lgm-21ka', duration: 8 },
    {
      type: 'caption',
      text: 'The peak of the last ice age, 21,000 years ago: ice sheets kilometres thick cover Canada and northern Europe, and the sea stands about 120 m lower than today.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'city-giza-2450bc', duration: 8 },
    {
      type: 'caption',
      text: 'Giza, around 2450 BC: the three great pyramids are new, cased in polished white limestone.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'city-rome-117ad', duration: 8 },
    {
      type: 'caption',
      text: 'Rome in AD 117, under Trajan: about a million people, the largest city the world had yet seen.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'city-newyork-1935', duration: 8 },
    {
      type: 'caption',
      text: 'New York, 1935: steel-framed towers, electric light, and the Empire State Building four years old.',
    },
    { type: 'wait', seconds: 10 },
    { type: 'goto', target: 'earth-now', duration: 9 },
    {
      type: 'caption',
      text: 'And now: eight billion people, on the same planet. All of recorded history fits in the last blink of this journey.',
      seconds: 9,
    },
    { type: 'wait', seconds: 9 },
  ],
};
