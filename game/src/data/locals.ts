// The people of Bowl and Nose the player can talk to, what they talk about, and the notes their rumors leave in
// the journal. src/sim/locals.ts runs the talk and src/sim/notes.ts keeps the notes.
// Lines are in character: no numbers but day counts and clock hours, and no words from outside the world
// (src/data/locals.test.ts checks every line). docs/lore.md keeps the voices.

// A rumor or clue the player was told. Lore answers leave no note.
export type NoteId = 'wagonBowl' | 'wagonNose' | 'wagonRoad' | 'wagonFound' | 'greenPit' | 'glassTank' | 'burntConvoy';

// A journal note: its title, who told it and where, and what it says, as information rather than an order.
export type NoteDef = { title: string; from: string; text: string };

export const NOTES: Record<NoteId, NoteDef> = {
  wagonBowl: {
    title: 'A scavenger with an Army radio',
    from: 'Hattie, at the Bowl well house',
    text: 'A scavenger came through Bowl selling a Nose Army radio. He said he pulled it off an Army wagon sitting dead in the hills north-east of Bowl. When the Farmers asked where, he left for Nose in a hurry.',
  },
  wagonNose: {
    title: 'Wagon Seven',
    from: 'Sergeant Kovac, Nose dispatch',
    text: 'The radio came off Nose Army wagon Seven, which went dark on the Pump Station run down to Bowl. Its crew walked home with raiders on their heels. The scavenger swore the wagon sits a short hop off the track. Nose never sent anyone to look.',
  },
  wagonRoad: {
    title: 'A dead Army wagon in a hollow',
    from: 'A driver on the radio',
    text: 'A driver saw a dead Army wagon lying in a hollow, closer to the Bowl north road than to the Pump Station track, south of an old farm with a water tower.',
  },
  wagonFound: {
    title: 'Wagon Seven written off',
    from: 'Sergeant Kovac, Nose dispatch',
    text: 'Kovac heard wagon Seven was found and searched. The Army wrote it off long ago, and he does not ask for anything back.',
  },
  greenPit: {
    title: 'Clean water at Green Pit',
    from: 'Lena, Nose mechanic',
    text: 'Lena says the water at Green Pit runs clean and nobody guards it.',
  },
  glassTank: {
    title: 'A tank at Glass Flats',
    from: 'Hattie, at the Bowl well house',
    text: 'Hattie swears an Old World tank still runs out at Glass Flats, and that it rolls out at night.',
  },
  burntConvoy: {
    title: 'Burnt Convoy picked clean',
    from: 'Old Ibo, Nose radio shack',
    text: 'Old Ibo says Burnt Convoy was picked clean long ago and nothing is left there worth the fuel.',
  },
};
