INCLUDE world.ink

=== start ===
# checkpoint: start
Lena. If it is broken, put it on the bench. If it is talk, keep it quick. My hands are busy.
-> hub

= hub
# checkpoint: start.hub
+ [Tell me about trucks and parts.]
  Every part does one job and fails at another. Heavy plate stops rounds and kills your speed. Big guns eat your deck. Pick what you need, not what shines.
  -> hub
+ [What is at the Salvage Yard?]
  South down the road from Broken Wing. Scrappers strip whatever gets towed in. Good place for a cheap part, if you can stand the smell of burnt oil.
  -> hub
+ [Heard any rumors?]
  One worth knowing. The water at Green Pit runs <color=sky>clean</color>, and nobody guards it. Fill your cans if you are out that way.
  ~ note("greenPit")
  -> hub
+ [What about the Fallen Sun?]
  Best metal in the basin and the worst place to get it. That hull is no warship, whatever the brass says. No gun mounts anywhere. <b>Cargo holds, all of it.</b>
  -> hub
+ [Goodbye.]
  -> END
