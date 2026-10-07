# Release post

Prepare a public release post in the Telegram channel.

## What you have

- `releasePost` in the state file holds the release day, the shipped changelog and the screenshot that goes out with the post.
- Each changelog line names its issue. Read the issue and its merge to learn what changed for a player.
- The play link is the itch.io page of `ITCH_TARGET` in `factory/settings.env`. Players vote on what comes next in the GitHub issues of `FACTORY_REPO`.
- `factory_release_draft` sends your draft to the committee chat with a Publish button. Publish posts your text to the channel exactly as you wrote it, under the screenshot. Pass `image` with the path of a picture under the factory home to post it instead of the release candidate screenshot.

## The post

- Write for players, in English, as plain text.
- Lead with what is new that a player will notice most.
- Go through the changelog and find the core and key changes, and think about how they will impact the player. Make 2 paragraphs about the release.
- Obtain a screenshot that best depicts the soul of this release, and that will catch attention. You can check the screenshots obtained by each involved issue first: perhaps the right picture is already taken. If not, you can take a screenshot yourself.
- Say where to play and how to suggest or vote on the next changes.
- Match the game in tone: a dark, dry but living wasteland. No hype, no marketing words, no emoji, no "hello fellow kids", no pretense roleplay. Write for adults.
- Keep it short. Under 1024 characters it goes out as one message with the screenshot.

## Steps

1. Write the draft and send it to the committee chat with `factory_release_draft`. Then respond with [SILENT].
2. A member's reply to the draft reaches you with a header. Change the draft as they ask, send it again with the tool, and answer in one short sentence.
3. Never post to the channel yourself unless explicitly asked, and even in this case ask for confirmation.

