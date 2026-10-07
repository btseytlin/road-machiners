# Sound

Sound tells the player what happens without making them read the log: where a shot came from, whether it hit, how hot a fight is. Everything sounds physical and recorded, never digital or arcade, the UI included. This page covers how sound is built, how the combat score behaves, and how to add, generate and tune sounds.

## Where things live

- `src/data/sounds.ts` holds the cue catalog, the prompt styles and every mix number in `MIX`. Tune there.
- `public/sfx/` holds the files, one `<cue>-<n>.ogg` per variant. A test fails when a file has no cue or a cue claims a missing file.
- `src/audio/` is the engine: `mixer.ts` builds the buses, `bank.ts` decodes every file at boot, `player.ts` plays cues, `pick.ts` holds pure choices, and `designer.ts` times the combat accents.
- `src/three/sound.ts` turns game events into sound: `SoundDirector` for one-shots, `SoundLoops` for engine, wind and music, and `CombatScore` for the combat music.
- `scripts/sfx-*.mjs` generate and import files. `scripts/sfx-phase.py` measures beat loops.

## The mix

Four buses feed the master: `ui`, `sfx`, `ambient` and `music`. Each has a player-set volume and a low-pass filter. The `sfx` bus also runs through a compressor and a short open-air reverb, so sounds from different sources sit in one place.

- World sounds, like guns, hits and crashes, play where they happen. Pan follows the screen position, and level halves at `MIX.halfGainMeters` from the camera focus. They use the same points as the visual effects, so fog of war silences what the player cannot see.
- Each turn plays at most one result sting, the most important one: defeat, level-up, discovery or money.
- The engine is one recorded loop per chassis. Its pitch and level follow speed over the turn, so speeding up revs and braking drops. Continuous sounds are always bent loops like this, never short clips per state. While heat damages the engine, the loop crossfades to a strained loop, one for light trucks and one for heavy ones, started with it and bent the same way, and falls back to the healthy note over two turns once the damage stops. The source of each strained loop lives in `sounds.ts`.
- A hard slowdown adds the air brake where the truck is. Passing or reaching an order point makes no sound of its own.
- Wind rises near dust storms.
- Calm music plays out of combat, from a playlist shuffled once per session. After each fight it comes back as the next track, so every track plays before any repeats.
- Town music replaces calm music while the player is within guard range of a town gate. Outpost music does the same near the gates of outposts, the trading stalls that are not towns. Abandoned music plays inside territories, the abandoned places like Fallen Sun and Old Orchard. Combat music plays over all of them.
- Between turns, once no turn has played for `MIX.music.pauseDelayMs`, the music bus is muffled a little. The delay keeps the gaps between automatic turns clear.

The volume knobs and the mute switch sit on the radio panel above the log. The whole column under a knob is its handle. Drag it up or right to raise the volume and down or left to lower it, 160px for the whole range. The label shows the level while you use the knob. The wheel and the focused arrow keys turn it in 5% steps. A next key above the radio's screen crossfades to another calm track. The knob and mute settings are stored in local storage. A knob the player never turned follows `MIX.busVolume`, so a new default reaches everyone who kept the old one.

## Combat score

Combat music is built live from a base loop and short accents, so each fight sounds like one song that reacts to the fight. It went through several designs. What works is fixed structure with a little variety inside, few sounds, and each sound tied to its event:

- Per-event dice, like chance rolls, recalled accents and random mode changes, made it sound random.
- Queuing phrases to start on bar lines made sounds late and hard to tie to their events.
- Speeding the base up and down with the fight's intensity felt chaotic.

How it plays:

1. The player entering combat, as the HUD combat readout shows it, starts a battle. A hostile that only sits or drives by in sight does not. One random base loop plays, drums, bass, horns or trombone, from its first beat. It stops when that combat ends.
2. Heat is a fading sum of event weights. It sets the base's level and muffle once per bar, so a quiet fight sounds low and dull and a hot one sounds full and open.
3. Each event plays a stab: its accent, started early by the take's measured peak, so the loudest moment lands exactly when the shot lands or the crash happens.
4. A short tail of the same accent may follow on the beat grid, from the half-beat nearest the event. Calm tails are the stab alone. Hot tails add one hit.
5. Heavy events, like a crash, a crit, a sighting or being hit, go to the lead line, centered, and always sound. Light events, your hits and misses, go to the secondary line: quieter, to one side, and only by chance.
6. A stab too soon after another on its line is dropped, so a burst makes one sound, not a pile.
7. In a turn pause, the last lead phrase repeats once from a bar line, then only the base plays.
8. Outside a battle, accents are ignored, so a crash in peacetime makes only its normal crash sound.

Randomness only changes how a sound plays: which take, which rhythm variant, a rare fill, a few milliseconds of timing and a little level. It never changes when the structure moves.

Volley accents are timed from the volley's own plan, when the first round lands. Crash accents are known at turn start, so their peak lands on the physics step of the crash. Crash sparks and sound play when playback reaches that step. A collision with no physics step, like a far truck breaking a fence, plays when movement ends.

To hear a fight without looking for one, open the console with the backquote key and type `battle`. It spawns a random hostile raider near the truck. The score starts once the raider closes in or fires. `__ROAM__.sound.log` in dev lists recent cues and what the score did with each accent, like `accent-hit skipped heat1.2`.

## Adding a sound

1. Add a cue to `DEFS` in `src/data/sounds.ts`: its bus, volume, voices and loop flag, and for generation a `setup` and prompts.
2. Import files with `npm run sfx:import -- <cue> <file...>`, or generate them. Import makes every file one format and loudness per bus. It trims one-shots, keeps loops seamless, and matches each variant's tone to the cue's first file.
3. Play it from `src/three/sound.ts`. A world sound goes through `SoundDirector.at()` with its position.
4. Listen with `npm run sfx:board`, which plays every cue through the game's mixer, beside a reference cue for buses that have one in `MIX.anchors`.

A cue with several prompts is a family of different sounds, one prompt per variant, and skips tone matching.

Every music loop also gets the palette finish at import, so tracks from different generations sound like one set. Its tone moves part of the way toward one target curve, taken from the town and outpost tracks. Its stereo width goes to one level. All loops share the same glue compression, one short room and one soft top end. The settings are at the end of `scripts/sfx-lib.mjs`. The finish changes timing by a few milliseconds, so measure the phase of a combat base again after it.

## Generating with ElevenLabs

`npm run sfx:gen -- <cue> <count>` generates variants and imports them. It costs credits, so ask before running it. `SFX_MAX_GENERATIONS` in `.env` caps one run.

- Every prompt starts with the `SOUND_STYLE` of the cue's setup, so a set of sounds shares one microphone and place. Combat accents use the `stinger` style, and base loops use `score`.
- Prompt style plus subject must stay under 450 characters, or the API refuses it.
- Generated heavy sounds come out thin. Check the spectrogram and process the take with ffmpeg rather than generating again. The horn and air brake comments in `sounds.ts` show the processing used.
- Raw takes stay in `tmp/sfx-raw/`, and each file's tag names its source. After an import change, `npm run sfx:reimport` rebuilds every file from those sources.

## Beat loops

A cue with a `beat` is a bar-exact loop. It is generated at exactly its bar length with the sound API's loop mode, and import stretches it by under 1% so its sample count is exact. That keeps its beat grid true over any number of repeats.

A new beat loop needs its first-beat offset before the game will play it:

```bash
uv run --with librosa python scripts/sfx-phase.py 32 public/sfx/score-bass-1.ogg
```

The first argument is the loop's beats, bars times 4. Put the printed phase in `SCORE_PHASES`. On-grid strength well above the mean shows the loop holds its tempo. A combat base needs exactly one file.

Accents are cut to 1.5 s at import, with soft edges and a warmer top end, so they sit inside the music instead of cutting in.
