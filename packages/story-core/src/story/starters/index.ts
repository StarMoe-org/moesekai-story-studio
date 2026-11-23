/**
 * Built-in localized MoeSekai Script (`.msk`) starter templates (`zh` / `en` / `ja`).
 *
 * Official showcase story ("25时的未名余音" / "Unspoken Echo at 25:00" / "25時の名もなき余韻")
 * featuring 25-ji, Nightcord de. (Kanade, Mafuyu, Ena, Mizuki, Empty SEKAI Miku) with
 * verified Project SEKAI assets, 19 nodes (12 scenes, 2 choices, 1 condition, 3 endings),
 * 21 edges, 79 beats, 3 variables, explicit stage slots (0 errors, 0 warnings), and 3 reachable endings.
 */
import { STARTER_STORY_EN } from "./en";
import { STARTER_STORY_JA } from "./ja";
import { STARTER_STORY_ZH } from "./zh";

export { STARTER_STORY_EN, STARTER_STORY_JA, STARTER_STORY_ZH };

export type StarterLocale = "zh" | "en" | "ja";

export const STARTER_STORY_SCRIPTS: Record<StarterLocale, string> = {
    zh: STARTER_STORY_ZH,
    en: STARTER_STORY_EN,
    ja: STARTER_STORY_JA,
};
