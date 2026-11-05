// Background village of Hollow Creek — a fictional Massachusetts mill town.
// The street is dense; the fen west of the bridge and the far ridge are kept
// as open nature stretches. Purely visual: no collision, doors or tasks.
// Assets and placements live in public/art/town/ and are editable as data.
import town from "../../public/art/town/houses.json";

export interface TownHouse {
  x: number;
  asset: string;
  w: number;
  h: number;
  flip: boolean;
}

export const TOWN_HOUSES: TownHouse[] = (town as { houses: TownHouse[] }).houses;
