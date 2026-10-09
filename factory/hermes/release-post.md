# Release post

Prepare a public release post in the Telegram channel.

## What you have

- `releasePost` in the state file holds the release day, the shipped changelog and the screenshot that goes out with the post.
- Each changelog line names its issue. Read the issue and its merge to learn what changed for a player.
- The play link is the itch.io page of `ITCH_TARGET` in `factory/settings.env`. Players vote on what comes next in the GitHub issues of `FACTORY_REPO`.
- `factory_release_draft` sends your draft to the committee chat with a Publish button. Publish posts your text to the channel exactly as you wrote it, under the screenshot. Pass `image` with the path of a picture under the factory home to post it instead of the release candidate screenshot.

## The post

- Write for players, in English, as plain text.
- Pick the 3 or 4 changes that most change how a run plays. Leave the rest out. A post that names every feature tells a player nothing.
- Give each picked change its context: what a player now does or meets in play because of it. "Destroyed cargo racks spill their goods" is a bare fact. "Shoot up a trader's cargo rack and the load spills on the road, and every raider nearby comes for it" is a moment a player can picture.
- Changes that serve one moment of play can share a sentence. Never string unrelated changes into a row of short sentences.
- Most readers of the channel have never played ROAM. They do not know the Fallen Sun or J.J. Describe each place and thing as it is. Never write "X is now Y" or compare with how it was.
- The first sentence gives a stranger a reason to read on. Say what you do in ROAM and what this release adds to that. Then lead with the change a player will notice most.
- Say where to play and how to suggest or vote on the next changes.
- Match the game in tone: a dark, dry but living wasteland. No hype, no marketing words, no emoji, no "hello fellow kids", no pretense roleplay. Write for adults.
- Keep it short. Under 1024 characters it goes out as one message with the screenshot.

## The screenshot

- It shows one change from the post in the middle of play, close enough to read on a phone. A fight, a wreck, a new location seen up close.
- No tutorial hints, dialogs or start-of-game screens. Hide the HUD panels if the game lets you.
- Check the screenshots taken by each issue of the release first. If none fits, take one yourself.
- Look at the picture before you send it. If it shows mostly UI and empty ground, take another.

## Steps

1. Write the draft and send it to the committee chat with `factory_release_draft`. Then respond with [SILENT].
2. A member's reply to the draft reaches you with a header. Change the draft as they ask, send it again with the tool, and answer in one short sentence.
3. Never post to the channel yourself unless explicitly asked, and even in this case ask for confirmation.
