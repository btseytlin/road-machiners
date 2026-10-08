INCLUDE world.ink

=== start ===
# checkpoint: start
Sergeant Kovac looks up from the dispatch board.
+ {sample_wagon_heard} [About that scavenger with the Army radio.]
  "That set came off wagon Seven. Nobody went to look."
  -> END
+ {money() > 0} [I have coin. Any work?]
  "Board is empty. Try tomorrow."
  -> END
+ [Nothing. Bye.]
  -> END
