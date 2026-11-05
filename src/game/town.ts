// Background village of Hollow Creek — modeled on Malye Korely's ~100 buildings.
// Purely visual: these houses have no collision, no doors, no tasks; nothing
// pinned in tests depends on them. The asset files and placement list are
// authored by scripts/author-town-houses.mjs into public/art/town/.
import town from "../../public/art/town/houses.json";

export interface TownHouse {
  x: number;
  asset: string;
  w: number;
  h: number;
  flip: boolean;
}

export const TOWN_HOUSES: TownHouse[] = (town as { houses: TownHouse[] }).houses;
