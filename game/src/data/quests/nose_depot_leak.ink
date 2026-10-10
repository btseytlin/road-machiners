# view: page
# stat: watches Watches
# stat: money Money
# stat: alarm Talk: quiet, talking, loud
# fact: ledger_read Ledger: cans went missing on the third, seventh and eleventh nights. Pell was on duty each time.
# fact: gate_checked Gate log: Corporal Vance signed out late on the third, seventh and eleventh nights, alone, with an empty truck bed.
# fact: saw_swap Fuel shed: Vance asked Pell to swap shifts tonight. Pell agreed without looking up. Vance has a scar across his chin.
# fact: knows_scar Sabine: a corporal brings her the cans. Big hands, a scar across the chin. Never a name.
# fact: found_seals Barracks: a tin of Army fuel seals under Vance's cot, cut clean.
# fact: saw_handoff Back fence: at dawn Vance passed cans over the wire to a truck with Sabine's mark.
INCLUDE world.ink

VAR watches = 5
VAR alarm = 0
VAR ledger_read = false
VAR gate_checked = false
VAR pell_talked = false
VAR sabine_talked = false
VAR bunk_searched = false
VAR stakeout_done = false
VAR saw_swap = false
VAR knows_scar = false
VAR found_seals = false
VAR saw_handoff = false
VAR sabine_price = 20
VAR reward = 150
VAR envelope = 60

=== function facts_held() ===
~ return ledger_read + gate_checked + saw_swap + knows_scar + found_seals + saw_handoff

=== function knows_whom() ===
~ return gate_checked or saw_swap or knows_scar

=== start ===
# checkpoint: start
{ depot_thief == "open": -> desk }
Kovac shuts the dispatch door before he speaks. # place: Dispatch office
On his desk lies a fuel can, empty, its Army seal cut clean through.
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
The yard lies under dust. The shipment trucks stand fuelled by the gate. # page # place: Dispatch office
{ alarm > 0: Two loaders stop talking as you pass. }
+ {not ledger_read} [Read the depot ledgers.]
  -> ledger
+ {ledger_read and not gate_checked} [Check the gate log for the same nights.]
  -> gate
+ {not pell_talked} [Talk to Pell, the fuel clerk.]
  -> pell
+ {not sabine_talked} [Talk to the trader by the gate.]
  -> sabine
+ {(gate_checked or saw_swap) and not bunk_searched} [Search Vance's bunk.]
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
~ watches -= 1
The ledger lies open on Pell's desk. Each loss is written in the same careful hand. # place: Dispatch office
Night; Missing; On duty # head
3rd; 2 cans; Pell # row
7th; 3 cans; Pell # row
11th; 2 cans; Pell # row
The ink on the last line is still wet.
-> after

=== gate ===
~ gate_checked = true
~ watches -= 1
The gate sentry hands over the log without a word. # place: Gatehouse
Night; Signed out late; Truck bed # head
3rd; Ostrow; water drums # row
3rd; Vance; empty # row
7th; Vance; empty # row
11th; Ruiz; scrap # row
11th; Vance; empty # row
Every one of Vance's lines ends the same way: <i>back before dawn</i>.
-> after

=== pell ===
~ pell_talked = true
~ watches -= 1
{ ledger_read: -> swap }
Pell talks about the dust, his bad back and the food. He never looks at the ledger on his desk. # place: Fuel shed
-> after

= swap
You mention the ledger. Pell's pen stops. # place: Fuel shed
The door bangs open. A corporal fills it, big hands, a scar across the chin.
Pell. Tonight again. Swap with me. # speaker: Vance
Pell nods at his desk.
Vance looks at you a moment longer than he needs to. Then he is gone.
~ saw_swap = true
-> after

=== sabine ===
~ sabine_talked = true
~ watches -= 1
-> haggle

= haggle
# checkpoint: sabine.haggle
Sabine's stall leans on the depot fence. Her board is chalked in a neat hand. # place: The gate
; Sabine; Depot pump # head
Diesel, per can; 9 M; 16 M # row
Her cans are Army green. The stencils have been scraped off.
Buying, or looking? # speaker: Sabine
+ [Pay her {sabine_price} M to talk. # cost: {sabine_price}]
  ~ knows_scar = true
  She counts the money twice.
  A corporal brings the cans. Big hands, a scar across the chin. Never says his name, and I never ask. # speaker: Sabine
  -> after
+ [Lean on her.]
  ~ alarm += 1
  She laughs and waves the next customer up. By nightfall half the depot knows someone is asking about fuel.
  -> after
+ {facts_held() >= 2} [Let her see what you know.]
  Sabine looks at you a long while. Then she slides an envelope across the counter.
  Forget the fuel. Everybody eats. # speaker: Sabine
  ++ [Take the envelope.]
     -> sold
  ++ [Push it back.]
     ~ alarm += 1
     She shrugs and looks past you, at the sentry by the gate.
     -> after
+ [Leave her be.]
  -> after

=== bunk ===
~ bunk_searched = true
~ found_seals = true
~ alarm += 1
~ watches -= 1
The barracks are empty at noon. Vance's cot is made tight, Army style. # place: Barracks
Under it sits a tin of Army fuel seals, every one cut clean.
His boots stand by the door, still wet from the wash trough. Footsteps sound on the boards outside, and you slip out the back.
-> after

=== stakeout ===
~ stakeout_done = true
~ watches -= 1
{ knows_whom(): -> seen }
You do not know whom to watch. The night passes cold and empty. # place: Back fence, night
At dawn a sentry finds you behind the fuel shed and asks what you are waiting for.
~ alarm += 1
-> after

= seen
Near dawn a truck stops at the back fence, lights off. Its door carries Sabine's mark. # place: Back fence, night
A corporal with a scar across his chin passes cans over the wire, one by one. <pop>You count every one.</pop>
~ saw_handoff = true
-> after

=== function vance_proof() ===
~ return gate_checked + saw_swap + knows_scar + found_seals + 2 * saw_handoff

=== accuse ===
Kovac looks up from the duty roster. # place: Dispatch office
Who? # speaker: Kovac
+ [Corporal Vance.]
  -> name_vance
+ [Pell, the clerk.]
  -> name_pell
+ [Not yet.]
  -> desk

=== last_call ===
# checkpoint: last_call
The shipment rolls at dawn. Kovac waits at his desk with the duty roster. # page # place: Dispatch office
+ [Name Corporal Vance.]
  -> name_vance
+ [Name Pell, the clerk.]
  -> name_pell
+ [Let it go.]
  -> too_late

=== name_vance ===
You lay out what you have.
{ gate_checked: Kovac reads the late passes twice. His jaw sets. }
{ saw_swap:
  So he picks his own nights. # speaker: Kovac
}
{ knows_scar: At the word scar, Kovac touches his own chin and says nothing. }
{ found_seals: Kovac picks up the cut seal on his desk and rolls it between his fingers. }
{ saw_handoff: Kovac asks if you saw the cans pass the wire yourself. You nod. He is quiet a long time. }
{ vance_proof() >= 3: -> caught }
-> no_proof

=== name_pell ===
{ not ledger_read: -> no_proof }
Kovac runs a finger down the ledger. Pell, Pell, Pell.
That is plain enough. # speaker: Kovac
-> wrong_man

=== no_proof ===
~ alarm += 1
A name with nothing behind it. Bring me proof, or bring me nothing. # speaker: Kovac
By evening the whole depot knows who you asked about.
-> after

=== caught ===
~ depot_thief = "vance"
~ give_money(reward)
Kovac sends a pair of soldiers to the barracks. # page # place: Dispatch office
They come back with the cans, dug out from under the floor of Vance's bunk, wrapped in Army canvas.
Vance. I shared my water with that man. # speaker: Kovac
The Army pays its debts. Take this, and keep it quiet. # speaker: Kovac
Kovac counts <b>{reward} M</b> into your hand. # reveal: all
-> END

=== wrong_man ===
~ depot_thief = "pell"
Pell sits in the cell by noon, crying into his sleeve. # page # place: Dispatch office
The shipment rolls out light anyway. <color=blood>The cans kept walking.</color>
-> END

=== sold ===
~ depot_thief = "bought"
~ give_money(envelope)
The envelope holds <b>{envelope} M</b>. You tell Kovac the depot is clean. # reveal: all # page # place: Dispatch office
He believes you. For now.
-> END

=== trail_lost ===
~ depot_thief = "lost"
By morning the depot is spotless. # page # place: Dispatch office
The ledger has a new page. The gate log has no late passes. Sabine's stall stands empty.
-> END

=== too_late ===
~ depot_thief = "lost"
The shipment rolls out at dawn, light by a few cans. # page # place: The gate
Vance waves it through the gate himself.
-> END

=== let_go ===
~ depot_thief = "lost"
Your call. # speaker: Kovac # place: Dispatch office
-> END
