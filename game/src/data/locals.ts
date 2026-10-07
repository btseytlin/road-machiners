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

// Facts that open a topic. Their logic lives in LOCAL_CONDITIONS in src/sim/locals.ts.
export type LocalConditionId = 'foundBurntConvoy' | 'foundFallenSun' | 'heardWagonBowl' | 'searchedWagon';

// What a local says to "Any work?". offer holds `{terms}`, which the town screen fills with the board contract the
// local names. empty is said when the board has nothing, full when the player already holds the most contracts.
export type WorkLines = { offer: string; empty: string; full: string };

// One question and its answer. notes are written into the journal when it is asked. A topic with work lines offers
// the town board's best contract in the local's words instead of the answer.
export type LocalTopic = { ask: string; when: LocalConditionId[]; answer: string; notes: NoteId[]; work: WorkLines | null };

const topic = (ask: string, answer: string, more: Partial<Omit<LocalTopic, 'ask' | 'answer'>> = {}): LocalTopic => ({
  ask, answer, when: [], notes: [], work: null, ...more,
});

// Topics are keyed by local, so two locals answer the same question their own way and may contradict each other.
export const LOCAL_TOPICS = {
  // Ruben, Bowl's canal warden: the place, who runs it, the Old World and the Fallen Sun. Warm and slow.
  'ruben.place': topic('What is this place?', 'Bowl sits at the low end of the basin, where the old canals still carry water. Water runs downhill, and so do people. Folk came for the canals and stayed for the seed.'),
  'ruben.rulers': topic('Who runs Bowl?', 'The canal families. Every gate has a family, and every family has a say. It is a slow way to decide things, but nobody ever starved waiting on a quick answer. The Farmers keep the roads for us.'),
  'ruben.oldWorld': topic('Tell me about the Old World.', 'My grandmother said the whole basin was orchards, wall to wall, and the canals ran full in every season. Then the sky fell and the fruit went with it. She never could agree with herself on which came first.'),
  'ruben.fallenSun': topic('What about the Fallen Sun?', 'A ship, they say, bigger than Bowl. It came down burning and dug that crater. Some say it brought the end with it. I say the end was already here, and the ship just landed on top of it.'),
  'ruben.fallenSunReal': topic('What is the Fallen Sun really?', 'You have stood in that crater, then. You tell me. Nose calls it a warship. Hattie calls it a seed ship that lost its way. I only know nothing grows near it, and that is the worst thing I can say of any place.', { when: ['foundFallenSun'] }),
  // Hattie keeps the Bowl well house: rumors, strangers and legends. Her rumors run from sound to tall.
  'hattie.rumors': topic('Heard any rumors?', 'Funny you ask. A scavenger came through a few days back, trying to sell a Nose Army radio. Said he pulled it off an Army wagon sitting dead in the hills north-east of here. When the Farmers asked him where, exactly, he filled his tank and left for Nose in a hurry.', { notes: ['wagonBowl'] }),
  'hattie.strangers': topic('Seen any strangers come through?', 'Every day. Traders, couriers, folk with a tank of fuel and a story. The ones that worry me are the quiet ones who ask where the seed stores are.'),
  'hattie.legends': topic('Any local legends?', 'You know Glass Flats, out east? There is an Old World tank out there that still runs. Rolls out at night with its lights off. My cousin saw it. Well. Heard it.', { notes: ['glassTank'] }),
  'hattie.nose': topic('What do you make of Nose?', 'Soldiers playing at a town. They eat our grain and send us orders back. Polite enough, mind you, whenever they want something.'),
  // Dag rides with the Bowl Farmers patrol: trouble, raiders, Nose and work.
  'dag.trouble': topic('Any trouble around here?', 'Raiders sniffing at the roads again. Nothing we cannot run off. The dust is worse. A truck that breaks down out there waits a long while for a friendly face.'),
  'dag.raiders': topic('What about the raiders?', 'Kiln Camp sits out east, south of the crater. Scrapjaw is far up north, beyond Dustwell. Most days they would rather rob you than kill you. Pay them or outrun them, but do not shoot first if you want to grow old.'),
  'dag.nose': topic('What do you make of Nose?', 'The Army is all right on the road. Off it, they act like the basin is theirs and we are only borrowing it. Bowl was feeding people long before Nose put up its first fence.'),
  'dag.work': topic('Any work?', '', {
    work: { offer: 'Could be. {terms} Interested?', empty: 'Nothing on the board today. Come back in a couple of days.', full: 'You are carrying enough promises already. Finish a few first.' },
  }),
  // Sergeant Kovac runs Nose dispatch: who runs Nose, work and the Army wagon. Short and military.
  'kovac.place': topic('What is this place?', 'Nose. Army post, now a town. We hold the north-east road and the canyon crossing. Anyone moves freight through here, we know.'),
  'kovac.rulers': topic('Who runs Nose?', 'The Army. Command gives orders, dispatch hands them out, everyone else follows. Simple. Works.'),
  'kovac.work': topic('Any work?', '', {
    work: { offer: 'Board has this. {terms} Yes or no?', empty: 'Board is empty. Try tomorrow.', full: 'You are overcommitted. Clear your sheet first.' },
  }),
  'kovac.wagon': topic('About that scavenger with the Army radio.', 'Him. Sold us our own radio back, the nerve. That set came off wagon Seven. She went dark on the Pump Station run down to Bowl. Crew walked in with raiders on their heels, no wagon. The scavenger swore she sits a short hop off the track. Nobody went to look. Too far off our road to spare a truck.', { when: ['heardWagonBowl'], notes: ['wagonNose'] }),
  'kovac.wagonFound': topic('We found wagon Seven.', 'Heard. Wagon Seven is written off. Whatever was left on her is yours. Do not make a habit of picking over Army property.', { when: ['searchedWagon'], notes: ['wagonFound'] }),
  // Lena, the Nose mechanic: trucks and parts, the Salvage Yard and rumors. Her rumor is sound.
  'lena.trucks': topic('Tell me about trucks and parts.', 'Every part does one job and fails at another. Heavy plate stops rounds and kills your speed. Big guns eat your deck. Pick what you need, not what shines.'),
  'lena.salvageYard': topic('What is at the Salvage Yard?', 'South down the road from Broken Wing. Scrappers strip whatever gets towed in. Good place for a cheap part, if you can stand the smell of burnt oil.'),
  'lena.rumors': topic('Heard any rumors?', 'One worth knowing. The water at Green Pit runs clean, and nobody guards it. Fill your cans if you are out that way.', { notes: ['greenPit'] }),
  'lena.fallenSun': topic('What about the Fallen Sun?', 'Best metal in the basin and the worst place to get it. That hull is no warship, whatever the brass says. No gun mounts anywhere. Cargo holds, all of it.'),
  // Old Ibo works the Nose radio: the Old World, J.J.'s mast, Bowl and Burnt Convoy. His news is old.
  'ibo.oldWorld': topic('Tell me about the Old World.', 'Bowl folk will tell you it was all orchards. Rubbish. There were highways, power lines, towns bigger than both of ours put together. The orchards were only what they could see from the canals.'),
  'ibo.mast': topic('Where does J.J. broadcast from?', 'Jill Jane\'s mast? Everybody wants to know. Her signal is strongest at night and drifts like it is on wheels. I would wager she moves it. Do not tell the Sergeant I listen.'),
  'ibo.bowl': topic('What do you make of Bowl?', 'Good people, slow talkers. They would hold a meeting to decide whether to hold a meeting. Their grain keeps us fed, so the Army minds its manners.'),
  'ibo.onAir': topic('Heard anything on the air?', 'Scavengers chatter about Burnt Convoy now and then. Picked clean, they say. Nothing left there but ash and bent rims. Not worth the fuel.', { notes: ['burntConvoy'] }),
  'ibo.burntConvoy': topic('What happened at Burnt Convoy?', 'A whole convoy went up in one night. Some say raiders, some say a fuel truck blew and took the rest with it. I heard the last calls on the air. Nobody said who started it.', { when: ['foundBurntConvoy'] }),
} satisfies Record<string, LocalTopic>;

export type LocalTopicId = keyof typeof LOCAL_TOPICS;
export type LocalId = 'ruben' | 'hattie' | 'dag' | 'kovac' | 'lena' | 'ibo';

// A person of a town. They never drive, fight or show in the world: the town screen's People tab is where they live.
export type LocalDef = { id: LocalId; name: string; role: string; town: 'bowl' | 'nose'; greeting: string; topics: LocalTopicId[] };

export const LOCALS: Record<LocalId, LocalDef> = {
  ruben: {
    id: 'ruben', name: 'Ruben', role: 'Canal warden', town: 'bowl',
    greeting: 'Sit a while, the shade is free. I am Ruben. I keep the canal gates. What is on your mind?',
    topics: ['ruben.place', 'ruben.rulers', 'ruben.oldWorld', 'ruben.fallenSun', 'ruben.fallenSunReal'],
  },
  hattie: {
    id: 'hattie', name: 'Hattie', role: 'Keeps the well house', town: 'bowl',
    greeting: 'Water is for paying folk, but talk is free. I am Hattie. Bucket down, ears open.',
    topics: ['hattie.rumors', 'hattie.strangers', 'hattie.legends', 'hattie.nose'],
  },
  dag: {
    id: 'dag', name: 'Dag', role: 'Bowl Farmers patrol', town: 'bowl',
    greeting: 'Dag, Farmers patrol. Keep your guns cold inside the gates and we will get along fine.',
    topics: ['dag.trouble', 'dag.raiders', 'dag.nose', 'dag.work'],
  },
  kovac: {
    id: 'kovac', name: 'Sergeant Kovac', role: 'Dispatcher', town: 'nose',
    greeting: 'Sergeant Kovac, dispatch. Be brief.',
    topics: ['kovac.place', 'kovac.rulers', 'kovac.work', 'kovac.wagon', 'kovac.wagonFound'],
  },
  lena: {
    id: 'lena', name: 'Lena', role: 'Mechanic', town: 'nose',
    greeting: 'Lena. If it is broken, put it on the bench. If it is talk, keep it quick. My hands are busy.',
    topics: ['lena.trucks', 'lena.salvageYard', 'lena.rumors', 'lena.fallenSun'],
  },
  ibo: {
    id: 'ibo', name: 'Old Ibo', role: 'Radio man', town: 'nose',
    greeting: 'Eh? Pull up a crate. Ibo. I listen to the air for the Army, and to everything else for myself.',
    topics: ['ibo.oldWorld', 'ibo.mast', 'ibo.bowl', 'ibo.onAir', 'ibo.burntConvoy'],
  },
};
