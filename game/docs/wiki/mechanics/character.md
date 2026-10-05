# Character

Skills, XP and perks. The principles behind them are in [DESIGN.md](../../DESIGN.md).

The character has five skills. These are the durable upgrades that persist across trucks. Each skill is broad: it touches several activities, and several activities earn XP in its family.

- Driving improves handling, crash damage, rough ground and crawling. It earns XP from driving off the road, rams and escapes from hostiles.
- Perception improves aim, sight, hearing and contact circles. It earns XP from hits, new contacts and discovered places.
- Machining improves repair and refit time, the field repair cap, search time and engine heat. It earns XP from field repairs, patches for other trucks and searches. Refits teach nothing, because a part can move back and forth forever.
- Toughness raises max health, and cuts health lost to cab damage, supply use and heat drain. It earns XP from driving in heat, health lost and knockouts with a hostile truck in sight.
- Social improves prices, tow fees and patch prices, and makes robbers see the truck as stronger. It earns XP from trade profit, agreed deals, finished contracts, radio calls, honks, free tows and free fuel or supplies given to drivers.

XP comes from use and goes into one shared pool. The player spends the pool on ranks of any skill on the character screen [C]. Each skill has five ranks, bought in order, and each rank costs more XP than the last. A bought rank is permanent, and spent XP is never refunded. Each XP source belongs to the activity family of one skill, as listed above. A hard action pays more than an easy one: a hit at a low chance pays more than a sure hit. Each activity family earns full XP up to a daily cap, and much less after it until the next day. Every XP event also has a target, like a driver, a truck, a pile, a map region or a trade good. Each repeat on the same target pays less, and the target recovers slowly with game time. Some targets pay only once, like a question to one driver or a found place. So grinding one easy action on one target does not pay, even when it takes no turn.

At rank 2 and rank 4 of each skill the player picks one of two perks. The bought rank is the perk's only cost. A pick is permanent. Each pair splits the skill into two playstyles. A perk adds an action, breaks a rule or shows hidden information. It never multiplies a number the skill ranks already grow, and it never fires only after the player fails.

- Driving 2, rammer or ghost. Rammer: a ram on a hostile truck stalls its engine for one turn. Cold running: below half speed, your engine is heard only inside sight.
- Driving 4, run and gun or run away. Steady aim: your own speed adds no scatter to your shots. Dust screen: at top speed on dusty ground, your dust blocks sight like a hill.
- Perception 2, read people or track trucks. Read the driver: you see the traits of other drivers. Spotter: the N key marks a seen truck, and it stays tracked for a day.
- Perception 4, loot sight or night sight. Cargo eye: you see the goods and spare parts in any seen truck. Night eyes: night does not halve your sight.
- Machining 2, builder or scrapper. Welder: a field job turns 3 scrap metal into a scrap armor plate. Cannibal: removing a part from a wreck or a knocked-out truck takes one turn.
- Machining 4, pristine hunter or hired mechanic. Rebuild: a town garage can repair a junk part back to its last wear step, once per part. Road mechanic: stranded drivers radio you for patches and pay double.
- Toughness 2, heat runner or storm runner. Desert rat: noon sun heats your engine like morning sun. Storm rider: dust storms do not cut your sight or aim.
- Toughness 4, brawler or long hauler. Fight through: a broken cab, or a hit on a cab below half, does not knock you out while health is above half. Hits on any part then hurt you. Long haul: you heal while driving, not only while parked.
- Social 2, trader or explorer. Market ears: a trader you call tells you the prices of the last town it left, as they were then, for a day after it left. Rumor mill: a driver you call marks a wreck or site it passed on your map.
- Social 4, peacemaker or bounty hunter. Paid truce: you can pay a hostile driver a tenth of its truck's value to end its feud with you. Bounty talk: a raider that gives up to your demand counts for bounty contracts.
