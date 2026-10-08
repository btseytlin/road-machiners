INCLUDE world.ink

=== start ===
# checkpoint: start
Eh? Pull up a crate. Ibo. I listen to the air for the Army, and to everything else for myself.
-> hub

= hub
# checkpoint: start.hub
+ [Tell me about the Old World.]
  Bowl folk will tell you it was all orchards. Rubbish. There were highways, power lines, towns bigger than both of ours put together. The orchards were only what they could see from the canals.
  -> hub
+ [Where does J.J. broadcast from?]
  Jill Jane's mast? Everybody wants to know. Her signal is strongest at night and <i>drifts like it is on wheels</i>. I would wager she moves it. Do not tell the Sergeant I listen.
  -> hub
+ [What do you make of Bowl?]
  Good people, slow talkers. They would hold a meeting to decide whether to hold a meeting. Their grain keeps us fed, so the Army minds its manners.
  -> hub
+ [Heard anything on the air?]
  Scavengers chatter about Burnt Convoy now and then. Picked clean, they say. Nothing left there but ash and bent rims. Not worth the fuel.
  ~ note("burntConvoy")
  -> hub
+ {found("burnt-convoy")} [What happened at Burnt Convoy?]
  A whole convoy went up in one night. Some say raiders, some say a fuel truck blew and took the rest with it. I heard the last calls on the air. Nobody said who started it.
  -> hub
+ [Goodbye.]
  -> END
