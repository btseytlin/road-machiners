INCLUDE world.ink

=== start ===
# checkpoint: start
Not much more. Talk fast, I am burning daylight. # speaker: Driver # reveal: char # speed: fast
-> ask

= ask
# checkpoint: start.ask
+ [Anyone still around the wreck?]
  Tracks all over the hollow. <b>Raider tracks</b>, the wide kind with chains on. Old, though. Rain came through since. # speaker: Driver
  -> ask
+ [What happened to the crew?]
  Walked to Nose, the way I heard it. Lucky. Whoever ran that wagon down was not out for prisoners. # speaker: Driver
  -> ask
+ [Is anything left on it?]
  {
    - searched("story-wagon-seven"):
      You tell me. Sounds like you got there first. # speaker: Driver
    - else:
      Could be. Raiders strip what they can lift, and an Army gun is <shake>heavy</shake>. # speaker: Driver
  }
  -> ask
+ [Over and out.]
  Over and out. <color=sand>Watch the hollows.</color> # speaker: Driver
  -> END
