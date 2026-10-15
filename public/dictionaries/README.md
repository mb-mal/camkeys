# Russian word frequencies

Unmodified `ru_50k.txt` from Hermit Dave's FrequencyWords, OpenSubtitles 2018:
https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/ru/ru_50k.txt

Data license: Creative Commons Attribution-ShareAlike 4.0 (CC BY-SA 4.0):
https://creativecommons.org/licenses/by-sa/4.0/
Author attribution and license declaration: https://github.com/hermitdave/FrequencyWords#license

Retrieved 2026-10-15. SHA256:
6095f507cc167488ec66ada5a85ac50433503a08ad24a07c6eabdf54352c4e7f

At runtime Camkeys retains 48,249 distinct Cyrillic words of 1–32 letters.
Filtering is general: no word is inserted for the recorded recognition test.
This is a frequency corpus, not a normative spelling dictionary; it includes
names, inflected forms, slang and corpus noise. The file is served locally.

# English word frequencies

Unmodified `en_50k.txt` from the same author and OpenSubtitles 2018 source:
https://github.com/hermitdave/FrequencyWords/blob/master/content/2018/en/en_50k.txt

Data license and attribution: CC BY-SA 4.0, Hermit Dave / FrequencyWords,
https://github.com/hermitdave/FrequencyWords#license . Retrieved 2026-10-15.
SHA256: `5351ff405b1126ef555791dd4d9798a48e3e9a501a9fc481a9da957752cfb458`.

The source corpus splits many contractions into fragments. Camkeys keeps
lowercase ASCII words and internal apostrophes (maximum 32 characters), excludes
apostrophe fragments, and adds a project-maintained list of common English
contractions. These forms follow the 200 most frequent corpus entries; their
position is a heuristic, not a measured corpus frequency. The resulting English
lexicon contains 46,763 entries. Apostrophes are restored in output and require
no separate swipe key. Ambiguous forms remain selectable candidates.

Both full-word and prefix analysis use only the manually selected layout.
English and Russian load independently; failure of one corpus is shown explicitly
and does not disable the other. Neither corpus includes personal camera data.
