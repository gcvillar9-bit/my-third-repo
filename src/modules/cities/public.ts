/** Cross-module API of the cities module (import only this file from other modules). */
export { CITIES_MODULE_ID, CITY_BOOKMARK_IDS } from './ids';
export { loadCities, citiesLoaded, citiesAtJd, settlementsNear, monumentsNear, type Monument } from './state';
export { yearOfJd, formatPop, type City, type CityStyle } from './data';
