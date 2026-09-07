# Game catalog

This directory now contains game identity and display metadata only. It must not
contain bundled phrases, proper nouns, OCR corrections, fuzzy matchers, or
generated game datasets.

General and game-specific dictionaries are versioned `GameDictionaryPack`
objects delivered by the community server and cached through
`services/dictionaryPacks.ts`. The general pack is infrastructure: it is always
downloaded, is not a selectable game, and includes untranslated common
katakana entries used only to suppress unnecessary entity searches. Selecting
a game changes the `gameId` used to isolate its downloaded pack, local
translation memory, learned entities, and opt-in community contributions.

To add a game category, add its id and display metadata to `registry.ts`. Do not
add its terminology to the client bundle.
