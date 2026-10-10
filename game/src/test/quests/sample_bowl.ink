INCLUDE world.ink

VAR trust = 0
VAR paid = false

=== start ===
# checkpoint: start
Hattie sets her bucket down by the well.
-> talk

= talk
# checkpoint: start.talk
+ {not sample_wagon_heard} [Heard any rumors?]
  A scavenger came through selling an Army radio. Said he pulled it off a dead wagon north-east of here.
  ~ sample_wagon_heard = true
  ~ trust += 1
  -> talk
+ {trust > 0 and not paid} [Can you spare some coin for the road?]
  Hattie counts out a few coins. "Bring me news from Nose."
  ~ give_money(5)
  ~ paid = true
  -> talk
+ [Leave.]
  -> END
