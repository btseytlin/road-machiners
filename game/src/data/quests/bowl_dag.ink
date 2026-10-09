INCLUDE world.ink

=== start ===
# checkpoint: start
Dag, Farmers patrol. Keep your guns cold inside the gates and we will get along fine.
-> hub

= hub
# checkpoint: start.hub
+ [Any trouble around here?]
  Raiders sniffing at the roads again. Nothing we cannot run off. The dust is worse. A truck that breaks down out there waits a long while for a friendly face.
  -> hub
+ [What about the raiders?]
  Kiln Camp sits out east, south of the crater. Scrapjaw is far up north, beyond Dustwell. Most days they would rather rob you than kill you. Pay them or outrun them, but <b>do not shoot first</b> if you want to grow old.
  -> hub
+ [What do you make of Nose?]
  The Army is all right on the road. Off it, they act like the basin is theirs and we are only borrowing it. Bowl was feeding people long before Nose put up its first fence.
  -> hub
+ [Any work?]
  {
    - board_full():
      You are carrying enough promises already. Finish a few first.
      -> hub
    - not has_work() and has_offers():
      Nothing on the board you could take on right now. Make some room and ask again.
      -> hub
    - not has_work():
      Nothing on the board today. Come back in a couple of days.
      -> hub
  }
  Could be. Interested? # work_offer
  ++ [I will take it.]
     ~ take_work()
     Good. Bowl remembers who delivers.
     -> hub
  ++ [Not now.]
     -> hub
+ [Goodbye.]
  -> END
