INCLUDE world.ink

=== start ===
# checkpoint: start
Sergeant Kovac, dispatch. <b>Be brief.</b>
-> hub

= hub
# checkpoint: start.hub
+ [What is this place?]
  Nose. Army post, now a town. We hold the north-east road and the canyon crossing. Anyone moves freight through here, we know.
  -> hub
+ [Who runs Nose?]
  The Army. Command gives orders, dispatch hands them out, everyone else follows. Simple. Works.
  -> hub
+ [Any work?]
  {
    - board_full():
      You are overcommitted. Clear your sheet first.
      -> hub
    - not has_work() and has_offers():
      Nothing on the board fits you right now.
      -> hub
    - not has_work():
      Board is empty. Try tomorrow.
      -> hub
  }
  Board has this. Yes or no? # work_offer
  ++ [Yes.]
     ~ take_work()
     Logged. Do not be late.
     -> hub
  ++ [No.]
     -> hub
+ {has_note("wagonBowl")} [About that scavenger with the Army radio.]
  Him. Sold us our own radio back, the nerve. That set came off <b>wagon Seven</b>. She went dark on the Pump Station run down to Bowl. Crew walked in with raiders on their heels, no wagon. The scavenger swore she sits a short hop off the track. Nobody went to look. Too far off our road to spare a truck.
  ~ note("wagonNose")
  -> hub
+ {searched("story-wagon-seven")} [We found wagon Seven.]
  Heard. Wagon Seven is written off. Whatever was left on her is yours. Do not make a habit of picking over Army property.
  ~ note("wagonFound")
  -> hub
+ [Goodbye.]
  -> END
