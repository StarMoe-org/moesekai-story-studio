/**
 * Live2D model catalog entry derived from the canonical asset site's
 * `/<region>/live2d/model/` and `/<region>/live2d/motion/` directory listings.
 * `asset` and `motion` match `SekaiLive2DViewer` / `SekaiLive2DStage` 0.2.x `model` options.
 */

/** How the game uses a model: one of the 26 characters, a supporting character, a collaboration character, or a mob. */
export type Live2DModelKind = "character" | "sub" | "collab" | "mob";

export interface Live2DModelEntry {
    /** The model directory name, e.g. `v2_01ichika_casual`. */
    id: string;
    /** Canonical model asset path on the asset site (`live2d/model/<id>`). */
    asset: string;
    /** Default motion asset path (`live2d/motion/<x>_motion_base`); null for a model without one. */
    motion: string | null;
    /** Optional ordered motion asset paths associated with the model, the default first. */
    motions?: string[];
    kind?: Live2DModelKind;
    /** MasterCharacter id, for a character's model. */
    characterId?: number | null;
    /** SubGameCharacter id, when `characterType == "sub_game_character"`. */
    subCharacterId?: number | null;
    character2dIds?: number[];
    /** `character2ds.assetName`, when present. */
    assetName?: string;
    /** Deterministic grouping key for non-character models (e.g. `anfather`, `sanrio_kitty`). */
    ownerKey?: string;
    /** `character2ds.unit`, when it is not `none`. */
    unit?: string;
    /** `character2ds.characterIconAssetbundleName`, when present. */
    iconBundle?: string;
    /** Server-native story display name. */
    name?: string;
    /** Additional non-placeholder story speaker aliases. */
    aliases?: string[];
    /** Multi-region localized names keyed by region (`jp`, `cn`, `tw`, `en`, `kr`). */
    names?: Partial<Record<string, string>>;
    /** Number of story episodes this model appears in. */
    episodeCount?: number;
    /** Representative story episode selectors (`event:1/1`, `unit:1/2`, etc.). */
    episodes?: string[];
}

/** Alias matching Moesekai web's naming for seamless imports from `@moesekai/story-core`. */
export type ILive2DModelEntry = Live2DModelEntry;
