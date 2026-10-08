INCLUDE world.ink

VAR watches = 5
VAR evidence = 0
VAR alarm = 0
VAR misled = false
VAR ledger_read = false
VAR gate_checked = false
VAR pell_talked = false
VAR sabine_talked = false
VAR bunk_searched = false
VAR stakeout_done = false
VAR sabine_price = 20
VAR reward = 150
VAR envelope = 60

=== start ===
# checkpoint: start
{ depot_thief == "open": -> desk }
Kovac shuts the dispatch door before he speaks.
Fuel is walking out of my depot. A can here, a can there, never enough to miss in a day. # speaker: Kovac
A shipment leaves for the north road soon. Find who sells it before it rolls. Quietly. # speaker: Kovac
+ [I will look into it.]
  ~ depot_thief = "open"
  Good. Do not spook anyone. A thief who hears footsteps buries the evidence. # speaker: Kovac
  -> desk
+ [Not my business.]
  Then forget we talked. # speaker: Kovac
  -> END

=== desk ===
# checkpoint: desk
<b>{watches}</b> {watches == 1: watch|watches} left before the shipment. Evidence: <b>{evidence}</b>. # reveal: all
{ alarm > 0: <color=rust>The depot has started to talk about you.</color> }
+ {not ledger_read} [Read the depot ledgers.]
  -> ledger
+ {ledger_read and not gate_checked} [Check the gate log against the ledgers.]
  -> gate
+ {not pell_talked} [Talk to Pell, the fuel clerk.]
  -> pell
+ {not sabine_talked} [Talk to the trader by the gate.]
  -> sabine
+ {gate_checked and not bunk_searched} [Search Vance's bunk.]
  -> bunk
+ {not stakeout_done} [Watch the depot all night.]
  -> stakeout
+ [Go to Kovac with a name.]
  -> accuse
+ [Let it go.]
  -> let_go

=== after ===
{
  - alarm >= 2: -> trail_lost
  - watches <= 0: -> last_call
  - else: -> desk
}

=== ledger ===
~ ledger_read = true
~ misled = true
~ watches -= 1
The cans go missing on Pell's shifts. Every time. <i>Too neat</i>, maybe.
-> after

=== gate ===
~ gate_checked = true
~ evidence += 1
~ watches -= 1
The gate log tells another story. On each missing night Corporal <b>Vance</b> signed out late, alone, with an empty truck bed.
-> after

=== pell ===
~ pell_talked = true
~ watches -= 1
{ misled:
  ~ evidence += 1
  Pell goes pale at the word ledger. He swaps shifts with Vance whenever Vance asks, he says. Vance asks often.
- else:
  Pell talks about the dust, his bad back and the food. Nothing you can use.
}
-> after

=== sabine ===
~ sabine_talked = true
~ watches -= 1
Sabine sells fuel by the gate, cheap. Too cheap for a trader with no well.
-> haggle

= haggle
# checkpoint: sabine.haggle
+ {money() >= sabine_price} [Pay her {sabine_price} M to talk.]
  ~ pay(sabine_price)
  ~ evidence += 1
  She counts the money twice. A corporal brings the cans, she says. Big hands, a scar across the chin. Never a name.
  -> after
+ [Lean on her.]
  ~ alarm += 1
  She laughs at you. By nightfall half the depot knows someone is asking about fuel.
  -> after
+ {evidence >= 2} [Let her see what you know.]
  Sabine looks at you a long while. Then she slides an envelope across the counter. Forget the fuel, she says. Everybody eats.
  ++ [Take the envelope.]
     -> sold
  ++ [Push it back.]
     ~ alarm += 1
     She shrugs. Her shrug says somebody will hear about this.
     -> after
+ [Leave her be.]
  -> after

=== bunk ===
~ bunk_searched = true
~ alarm += 1
~ evidence += 1
~ watches -= 1
Under Vance's cot sits a tin of Army fuel seals, cut clean. His boots stand by the door, so he is close. You slip out before he walks in.
-> after

=== stakeout ===
~ stakeout_done = true
~ watches -= 1
{ evidence >= 2:
  ~ evidence += 2
  Near dawn a truck stops at the back fence. Vance passes cans over the wire to a trader's driver. <pop>You see every one.</pop>
- else:
  ~ alarm += 1
  You do not know whom to watch. The night passes cold and empty, and a sentry sees you waiting.
}
-> after

=== accuse ===
Who? # speaker: Kovac
+ [Corporal Vance.]
  -> name_vance
+ [Pell, the clerk.]
  -> wrong_man
+ [Not yet.]
  -> desk

=== last_call ===
# checkpoint: last_call
The shipment rolls at dawn. <b>It is now or never.</b>
+ [Name Corporal Vance.]
  -> name_vance
+ [Name Pell, the clerk.]
  -> wrong_man
+ [Let it go.]
  -> too_late

=== name_vance ===
{ evidence >= 3: -> caught }
~ alarm += 1
A corporal with late passes is no thief. Bring me proof, or bring me nothing. # speaker: Kovac
Word of your questions reaches Vance by evening.
-> after

=== caught ===
~ depot_thief = "vance"
~ give_money(reward)
Kovac reads your notes twice. Then he sends soldiers for Vance.
They find the cans under the floor of his bunk, wrapped in Army canvas.
Vance. I shared my water with that man. # speaker: Kovac
The Army pays its debts. Take this, and keep it quiet. # speaker: Kovac
Kovac counts <b>{reward} M</b> into your hand. # reveal: all
-> END

=== wrong_man ===
~ depot_thief = "pell"
Pell sits in the cell by noon, crying into his sleeve.
The shipment rolls out light anyway. <color=blood>The cans kept walking.</color>
-> END

=== sold ===
~ depot_thief = "bought"
~ give_money(envelope)
The envelope holds <b>{envelope} M</b>. You tell Kovac the depot is clean. # reveal: all
He believes you. For now.
-> END

=== trail_lost ===
~ depot_thief = "lost"
Too many questions. By morning the depot is spotless, and whoever was selling has gone quiet. <i>There is nothing left to find.</i>
-> END

=== too_late ===
~ depot_thief = "lost"
The shipment rolls out at dawn, light by a few cans. Whoever sold them will do it again.
-> END

=== let_go ===
~ depot_thief = "lost"
Your call. # speaker: Kovac
-> END
