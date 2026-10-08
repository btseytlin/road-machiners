// Pictures quests show with `# img: <key>`. Each key names a file under public/quest-art/.

export const QUEST_ART: Record<string, string> = {};

export function questArtUrl(key: string): string {
  const file = QUEST_ART[key];
  if (file === undefined) throw new Error(`No quest art ${key}. Known: ${Object.keys(QUEST_ART).join(', ') || 'none yet'}`);
  return `${import.meta.env.BASE_URL}quest-art/${file}`;
}
