import { vocabulary } from "./core.js";
export function installEnglishDictionary(text) {
  const words = new Set(
    text
      .split(/\r?\n/)
      .map((line) => line.split(/\s+/)[0])
      .filter((word) => word.length <= 32 && /^[a-z]+(?:'[a-z]+)*$/.test(word)),
  );
  if (words.size < 40000)
    throw new Error("Английский словарь повреждён или неполон");
  // OpenSubtitles tokenizes apostrophes into fragments. Restore common forms
  // explicitly rather than treating fragments such as 's as keyboard words.
  const contractions =
    "aren't can't couldn't didn't doesn't don't hadn't hasn't haven't isn't mustn't needn't shouldn't wasn't weren't won't wouldn't I'm I'll I've I'd you're you'll you've you'd he's he'll he'd she's she'll she'd it's it'll it'd we're we'll we've we'd they're they'll they've they'd that's there's here's let's"
      .toLowerCase()
      .split(" ");
  const ranked = [...words];
  vocabulary.en = [
    ...new Set([
      ...ranked.slice(0, 200),
      ...contractions,
      ...ranked.slice(200),
    ]),
  ];
  return vocabulary.en.length;
}
