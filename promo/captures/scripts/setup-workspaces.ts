import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
    compileStoryGraph,
    detectOutdatedBeats,
    extractTalkBeatsForVoice,
    extractTranslatableSource,
    matchVoiceManifestToDoc,
    parseStoryScript,
    STORY_I18N_SCHEMA_VERSION,
    STORY_VOICE_MANIFEST_SCHEMA_VERSION,
    type StoryDocument,
    type StoryLocalePack,
    type StoryVoiceManifest,
} from "../../../packages/story-core/src/index.ts";
import { STARTER_STORY_ZH } from "../../../packages/story-core/src/story/starters/zh.ts";

export const PROMO_TEMP_ROOT = path.join(os.tmpdir(), "moesekai-promo-capture");
export const WORKSPACES_ROOT = path.join(PROMO_TEMP_ROOT, "workspaces");
export const USER_DATA_DIR = path.join(PROMO_TEMP_ROOT, "userdata");
export const MMJ_WORKSPACE_DIR = path.join(WORKSPACES_ROOT, "mmj-stage-encore");
export const NIGHTCORD_WORKSPACE_DIR = path.join(WORKSPACES_ROOT, "nightcord-unspoken-echo");

export const MMJ_STORY_MSK = `# MORE MORE JUMP! 原创互动剧情展示脚本 (moesekai-story/2)
# 使用 MoeSekai Story Studio 可视化节点编排与 Live2D 多角色实时舞台制作

@story "闪耀吧！屋顶与舞台的安可曲" region=jp id="mmj_stage_encore" author="MoeSekai Studio" summary="放学后的宫益坂屋顶微风正好，花里实乃理与 MORE MORE JUMP! 的伙伴们正在筹备新一场粉丝感谢 Live 的特别安可演出。从屋顶合练到「舞台的世界」，你的每一次选择都将点亮不一样的四叶草奇迹！"

@var cheers: number = 10 "应援热度"
@var sync_rate: number = 5 "默契值"
@var sekai_encore: boolean = false "造访舞台世界"

@cast minori "花里实乃理" model="v2_05minori_unit" char=5
@cast haruka "桐谷遥" model="v2_06haruka_unit" char=6
@cast airi "桃井爱莉" model="v2_07airi_unit" char=7
@cast shizuku "日野森雫" model="v2_08shizuku_unit" char=8
@cast miku "初音未来" model="v2_21miku_idol" char=21

start -> scene_01_rooftop

scene scene_01_rooftop "宫益坂屋顶的安可企划" {
  bg set "bg_a000801"
  bgm play "bgm00020" vol=0.72
  place set "宫益坂女子学园·屋顶"
  transition fadeWhite 0.5
  cast set [
    airi at farLeft facial="face_smile_02"
    haruka at left facial="face_smile_01"
    minori at right facial="face_sparkling_01"
    shizuku at farRight facial="face_smile_01"
  ]

  telop "放学后的屋顶 —— 安可曲特别会议"
  cue se "se_pack00001_b/se00001_b" vol=0.75
  talk minori "遥酱、爱莉酱、雫酱！下周末的粉丝感谢 Live，大家已经收到超多期待安可曲的留言啦！" motion="w-cute01-glad" facial="face_sparkling_01" react(haruka motion="w-cute01-nod04" facial="face_smile_02") react(airi motion="w-cute01-pose" facial="face_smile_02")
  talk haruka "嗯，我也看了大家发来的应援信。既然是特别安可舞台，我想把四叶草的希望传递到每一个角落。" motion="w-cute01-nod04" facial="face_smile_02"
  talk airi "哼哼，那就更不能按部就班了！一定要拿出让全场荧光棒瞬间沸腾的杀手锏才行！" motion="w-cute01-pose" facial="face_smile_04" react(shizuku motion="w-cute01-tilthead02" facial="face_smile_02")
  talk shizuku "呵呵，大家干劲满满的样子真好呢。不过实乃理，你心里是不是已经有最想尝试的方案了？" motion="w-cute01-tilthead02" facial="face_smile_01"
  talk minori "嘿嘿，被雫酱看穿啦！其实我想到了三个超棒的点子，大家一起来决定吧！" motion="w-cute01-wink04" facial="face_smile_06"
} -> choice_01_encore

choice choice_01_encore "决定安可曲的舞台演出方案！" {
  opt_sekai: "前往「舞台的世界」与未来彩排安可" [cheers += 5, sekai_encore = true] -> scene_02a_stage_sekai
  opt_dance: "留在屋顶加练高难度四叶草星光队形" [sync_rate += 4, cheers += 2] -> scene_02b_rehearsal
  opt_stream: "开启直播间，和粉丝们一起票选互动口号" [cheers += 4, sync_rate += 2] -> scene_02c_livestream
}

scene scene_02a_stage_sekai "舞台世界的闪耀彩排" {
  bg set "bg_b001001"
  bgm play "bgm00020" vol=0.76
  place set "舞台的「世界」·主舞台"
  transition fadeWhite 0.6
  cast set [
    airi at farLeft facial="face_smile_02"
    haruka at left facial="face_smile_02"
    minori at center z=10 facial="face_sparkling_01"
    shizuku at right facial="face_smile_01"
    miku at farRight facial="face_idol_smile_02"
  ]

  cue flash white 0.35
  telop "舞台的「世界」 —— 璀璨聚光灯下"
  talk miku "实乃理、大家欢迎回来！今天「世界」里的荧光棒也亮得格外耀眼哦！" motion="w-cute01-wink04" facial="face_idol_sparkling_01" react(minori motion="w-cute01-glad" facial="face_sparkling_02")
  talk minori "哇啊——！好棒！有未来酱和大家并肩站在舞台上，我觉得无论多难的舞步都能一次跳好！" motion="w-cute01-glad" facial="face_sparkling_01" react(haruka motion="w-cute01-nod04" facial="face_sparkling_01") react(airi motion="w-cute01-glad03" facial="face_smile_04")
  talk haruka "节奏很稳。接下来副歌前的四拍，我们一起迈向前台把歌声送给远处的观众吧。" motion="w-cute-wink01" facial="face_smile_02"
  talk airi "好嘞！跟紧我的节拍——三、二、一，MORE MORE JUMP! 出发！" motion="w-cute01-pose" facial="face_smile_04"
  talk shizuku "荧光海像绿色的星河一样泛起波浪了呢……真是令人心动的景色。" motion="w-cute01-glad" facial="face_sparkling_01"
} -> scene_03_climax_encore

scene scene_02b_rehearsal "夕阳前的特训室合练" {
  bg set "bg_b000601"
  bgm play "bgm00020" vol=0.72
  place set "实乃理的房间·编舞笔记前"
  transition fadeBlack 0.5
  cast set [
    haruka at left facial="face_smile_01"
    minori at center z=10 facial="face_smile_02"
    airi at right facial="face_smile_02"
  ]

  talk airi "实乃理，转身那一拍的视线别低下去，抬起头直接看向前排的镜头！" motion="w-cute01-pose" facial="face_smile_04" react(minori motion="w-cute01-nod04" facial="face_smile_02")
  talk minori "明白！再试一次——把最灿烂的笑容送到大家面前！" motion="w-cute01-glad" facial="face_sparkling_01"
  talk haruka "很棒的进步，实乃理。大家的动作已经完全融为一体了。" motion="w-cute01-nod04" facial="face_smile_02"
} -> scene_03_climax_encore

scene scene_02c_livestream "剧场后台的粉丝连线" {
  bg set "bg_b001301"
  bgm play "bgm00020" vol=0.74
  place set "演播剧场·灯光测试中"
  transition fadeBlack 0.5
  cast set [
    airi at farLeft facial="face_smile_02"
    minori at left facial="face_sparkling_01"
    haruka at right facial="face_smile_02"
    shizuku at farRight facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00001_b" vol=0.78
  talk minori "大家晚上好——！这里是 MORE MORE JUMP! 今天的安可互动口号就由屏幕前的你们来决定哦！" motion="w-cute01-wink04" facial="face_sparkling_01" react(airi motion="w-cute01-glad03" facial="face_smile_04")
  talk shizuku "哇，弹幕一瞬间刷满了绿色的四叶草表情呢！" motion="w-cute01-glad" facial="face_sparkling_01"
  talk haruka "谢谢大家的热情，我们一定会把这份心意带到正式舞台上。" motion="w-cute01-nod04" facial="face_smile_02"
} -> scene_03_climax_encore

scene scene_03_climax_encore "万众瞩目的四叶草安可" {
  bg set "bg_b001001"
  bgm play "bgm00020" vol=0.80
  place set "舞台的「世界」·安可高潮"
  transition fadeWhite 0.6
  cast set [
    airi at farLeft facial="face_smile_04"
    haruka at left facial="face_sparkling_01"
    minori at center z=10 facial="face_sparkling_01"
    shizuku at right facial="face_sparkling_01"
    miku at farRight facial="face_idol_sparkling_01"
  ]

  cue flash white 0.4
  cue se "se_pack00001_b/se00001_b" vol=0.85
  narration "聚光灯在瞬间汇聚成翠绿与金色的光束，全场应援热度飙升至 {{cheers}}，欢呼声响彻整个舞台！"
  talk minori "大家准备好了吗——！？用今天最响亮的笑容，把希望送到世界每个角落吧！MORE MORE JUMP! 安可开始！" motion="w-cute01-glad" facial="face_sparkling_01" react(haruka motion="w-cute-wink01" facial="face_sparkling_01") react(airi motion="w-cute01-pose" facial="face_smile_06") react(shizuku motion="w-cute01-glad" facial="face_sparkling_02") react(miku motion="w-cute01-wink04" facial="face_idol_sparkling_01")
  talk haruka "无论前方有多少挑战，只要四个人牵起手，就一定能跳向更高的天空。" motion="w-cute01-nod04" facial="face_smile_02"
  talk airi "这就是我们的全力以赴——听好了，绝不会让任何一位粉丝失望！" motion="w-cute01-glad03" facial="face_smile_06"
  talk shizuku "愿这份温柔又闪耀的旋律，长久地留在大家的记忆里。" motion="w-cute01-tilthead02" facial="face_sparkling_01"
} -> cond_encore_ending

condition cond_encore_ending "安可演出结局判定" {
  rule_sekai: if sekai_encore == true "舞台世界闪耀奇迹" -> end_clover_miracle
  rule_sync: if sync_rate >= 8 "屋顶默契星光" -> end_rooftop_promise
  else -> end_next_dream
}

end end_clover_miracle "结局A：四叶草奇迹安可" subtitle="与初音未来在舞台世界点亮满分欢呼（应援热度：{{cheers}} / 默契值：{{sync_rate}}）"
end end_rooftop_promise "结局B：屋顶微风与星光" subtitle="汗水与完美队形铸就的无瑕安可舞台（应援热度：{{cheers}} / 默契值：{{sync_rate}}）"
end end_next_dream "结局C：奔向下一个梦想" subtitle="粉丝连线凝聚起的崭新约定（应援热度：{{cheers}} / 默契值：{{sync_rate}}）"
`;

// Japanese translations keyed by substring / beat order for 100% authentic ja-JP pack
const JA_BEAT_TEXTS: Record<string, string> = {
    "放学后的屋顶 —— 安可曲特别会议": "放課後の屋上 —— アンコール曲特別ミーティング",
    "遥酱、爱莉酱、雫酱！下周末的粉丝感谢 Live，大家已经收到超多期待安可曲的留言啦！": "遥ちゃん、愛莉ちゃん、雫ちゃん！来週末のファン感謝ライブ、アンコールを待ち望むメッセージがこんなにたくさん届いてるよ！",
    "嗯，我也看了大家发来的应援信。既然是特别安可舞台，我想把四叶草的希望传递到每一个角落。": "うん、私もみんなからの応援メッセージを読んだよ。特別なアンコールステージだからこそ、クローバーの希望を隅々まで届けたいな。",
    "哼哼，那就更不能按部就班了！一定要拿出让全场荧光棒瞬间沸腾的杀手锏才行！": "ふふん、だったらなおさら型通りじゃダメよね！会場のペンライトが一気に沸き立つ切り札を用意しなくちゃ！",
    "呵呵，大家干劲满满的样子真好呢。不过实乃理，你心里是不是已经有最想尝试的方案了？": "ふふっ、みんなやる気いっぱいで素敵だわ。でもみのりちゃん、本当は一番やってみたい案があるんじゃない？",
    "嘿嘿，被雫酱看穿啦！其实我想到了三个超棒的点子，大家一起来决定吧！": "えへへ、雫ちゃんに見抜かれちゃった！実はとっておきのアイデアを三つ考えてきたんです、みんなで決めましょう！",
    "舞台的「世界」 —— 璀璨聚光灯下": "ステージの「セカイ」 —— まばゆいスポットライトの下で",
    "实乃理、大家欢迎回来！今天「世界」里的荧光棒也亮得格外耀眼哦！": "みのりちゃん、みんなおかえりなさい！今日も「セカイ」のペンライト、すごくキラキラ輝いてるよ！",
    "哇啊——！好棒！有未来酱和大家并肩站在舞台上，我觉得无论多难的舞步都能一次跳好！": "わあ——っ！すごい！ミクちゃんやみんなと並んでステージに立つと、どんな難しいステップも一回で決められそうな気がするよ！",
    "节奏很稳。接下来副歌前的四拍，我们一起迈向前台把歌声送给远处的观众吧。": "リズムも安定してるね。次のサビ前の4カウント、みんなで前に踏み出して遠くの客席まで歌声を届けよう。",
    "好嘞！跟紧我的节拍——三、二、一，MORE MORE JUMP! 出发！": "よしっ！あたしのカウントについてきて——さん、にー、いち、MORE MORE JUMP! いくわよ！",
    "荧光海像绿色的星河一样泛起波浪了呢……真是令人心动的景色。": "ペンライトの海が緑の天の川みたいに波打っているわ……本当に胸が高鳴る景色ね。",
    "实乃理，转身那一拍的视线别低下去，抬起头直接看向前排的镜头！": "みのり、ターンの瞬間に視線を落とさないで！顔を上げて最前列のカメラをまっすぐ見るのよ！",
    "明白！再试一次——把最灿烂的笑容送到大家面前！": "はいっ！もう一回やります——一番キラキラした笑顔をみんなに届けます！",
    "很棒的进步，实乃理。大家的动作已经完全融为一体了。": "すごく上達したよ、みのり。みんなの呼吸もぴったり合ってきたね。",
    "大家晚上好——！这里是 MORE MORE JUMP! 今天的安可互动口号就由屏幕前的你们来决定哦！": "みんなこんばんは——っ！MORE MORE JUMP! です！今日のアンコールコールは画面の前のあなたに決めてもらいます！",
    "哇，弹幕一瞬间刷满了绿色的四叶草表情呢！": "まあ、コメント欄が一瞬で緑のクローバーでいっぱいになったわ！",
    "谢谢大家的热情，我们一定会把这份心意带到正式舞台上。": "たくさんの温かい声をありがとう。この想い、必ず本番のステージへ連れて行くね。",
    "聚光灯在瞬间汇聚成翠绿与金色的光束，全场应援热度飙升至 {{cheers}}，欢呼声响彻整个舞台！": "スポットライトが瞬く間にエメラルドと金色の光束となって降り注ぎ、会場の熱気は {{cheers}} まで急上昇！歓声がステージ中に響き渡る！",
    "大家准备好了吗——！？用今天最响亮的笑容，把希望送到世界每个角落吧！MORE MORE JUMP! 安可开始！": "みんな準備はいいですか——っ！？今日いちばんの笑顔で、世界の隅々まで希望を届けよう！MORE MORE JUMP! アンコール、スタート！",
    "无论前方有多少挑战，只要四个人牵起手，就一定能跳向更高的天空。": "どんな壁が待っていても、4人で手を取り合えば、きっともっと高い空へジャンプできる。",
    "这就是我们的全力以赴——听好了，绝不会让任何一位粉丝失望！": "これが私たちの全力よ——聞いててね、誰ひとり絶対にがっかりさせないから！",
    "愿这份温柔又闪耀的旋律，长久地留在大家的记忆里。": "この優しくてまばゆいメロディが、いつまでもみんなの記憶に寄り添いますように。",
};

const EN_BEAT_TEXTS: Record<string, string> = {
    "放学后的屋顶 —— 安可曲特别会议": "After-School Rooftop — Special Encore Planning",
    "遥酱、爱莉酱、雫酱！下周末的粉丝感谢 Live，大家已经收到超多期待安可曲的留言啦！": "Haruka, Airi, Shizuku! Fans have sent in SO many messages excited for next weekend's Encore Live!",
    "嗯，我也看了大家发来的应援信。既然是特别安可舞台，我想把四叶草的希望传递到每一个角落。": "Yes, I read every letter too. For a special encore like this, I want to send our clover's hope to every single seat.",
    "哼哼，那就更不能按部就班了！一定要拿出让全场荧光棒瞬间沸腾的杀手锏才行！": "Heh, all the more reason not to play it safe! We need a showstopper that lights up every penlight at once!",
    "呵呵，大家干劲满满的样子真好呢。不过实乃理，你心里是不是已经有最想尝试的方案了？": "Hehe, everyone looks so inspired. Minori, it sounds like you already have a few favorite ideas in mind?",
    "嘿嘿，被雫酱看穿啦！其实我想到了三个超棒的点子，大家一起来决定吧！": "Ehehe, you caught me, Shizuku! I came up with three awesome plans—let's pick one together!",
    "舞台的「世界」 —— 璀璨聚光灯下": "Stage SEKAI — Beneath the Dazzling Spotlights",
    "实乃理、大家欢迎回来！今天「世界」里的荧光棒也亮得格外耀眼哦！": "Welcome back, Minori and everyone! The penlights in SEKAI are shining extra bright today!",
    "哇啊——！好棒！有未来酱和大家并肩站在舞台上，我觉得无论多难的舞步都能一次跳好！": "Whoa—amazing! Standing side by side with Miku and everyone, I feel like I can nail any routine on the first try!",
    "节奏很稳。接下来副歌前的四拍，我们一起迈向前台把歌声送给远处的观众吧。": "Our rhythm is rock-solid. On the four counts before the chorus, let's step forward together and reach the back row.",
    "好嘞！跟紧我的节拍——三、二、一，MORE MORE JUMP! 出发！": "Alright! Follow my count—three, two, one, MORE MORE JUMP! Let's go!",
    "荧光海像绿色的星河一样泛起波浪了呢……真是令人心动的景色。": "The ocean of glowsticks ripples like an emerald Milky Way... what a breathtaking view.",
    "实乃理，转身那一拍的视线别低下去，抬起头直接看向前排的镜头！": "Minori, keep your chin up on the pivot beat—look straight into the front camera!",
    "明白！再试一次——把最灿烂的笑容送到大家面前！": "Got it! One more time—delivering our brightest smile to everyone!",
    "很棒的进步，实乃理。大家的动作已经完全融为一体了。": "Incredible progress, Minori. Our timing is completely in sync now.",
    "大家晚上好——！这里是 MORE MORE JUMP! 今天的安可互动口号就由屏幕前的你们来决定哦！": "Good evening everyone—! We're MORE MORE JUMP!, and tonight YOU decide our live encore call!",
    "哇，弹幕一瞬间刷满了绿色的四叶草表情呢！": "Oh my, the live chat filled up with green clovers in an instant!",
    "谢谢大家的热情，我们一定会把这份心意带到正式舞台上。": "Thank you all for the love—we'll carry every cheer onto the main stage.",
    "聚光灯在瞬间汇聚成翠绿与金色的光束，全场应援热度飙升至 {{cheers}}，欢呼声响彻整个舞台！": "Emerald and golden spotlights converge as the crowd hype surges to {{cheers}}, shaking the entire arena!",
    "大家准备好了吗——！？用今天最响亮的笑容，把希望送到世界每个角落吧！MORE MORE JUMP! 安可开始！": "Is everyone ready—?! Let's deliver hope across the entire world with our brightest smiles! MORE MORE JUMP! Encore, START!",
    "无论前方有多少挑战，只要四个人牵起手，就一定能跳向更高的天空。": "No matter what awaits ahead, as long as the four of us hold hands, we can leap even higher.",
    "这就是我们的全力以赴——听好了，绝不会让任何一位粉丝失望！": "This is everything we've got—listen up, we'll never let a single fan down!",
    "愿这份温柔又闪耀的旋律，长久地留在大家的记忆里。": "May this gentle, radiant melody stay warmly in everyone's heart forever.",
};

function buildLocalePack(doc: StoryDocument, locale: "ja-JP" | "en-US"): StoryLocalePack {
    const src = extractTranslatableSource(doc);
    const dict = locale === "ja-JP" ? JA_BEAT_TEXTS : EN_BEAT_TEXTS;
    const beats: StoryLocalePack["beats"] = {};
    for (const b of src.beats) {
        beats[b.beatId] = {
            srcHash: b.srcHash,
            body: dict[b.body] ?? b.body,
        };
    }

    if (locale === "ja-JP") {
        return {
            schema: STORY_I18N_SCHEMA_VERSION,
            storyId: doc.id,
            locale: "ja-JP",
            translationMeta: {
                origin: "human",
                modelHint: "MoeSekai Studio Editor",
                note: "MORE MORE JUMP! 公式口調準拠・全セリフ校正済み",
                updatedAt: new Date().toISOString(),
            },
            meta: {
                title: "輝け！屋上とステージのアンコール曲",
                summary: "放課後の宮益坂屋上から「ステージのセカイ」へ。花里みのりと MORE MORE JUMP! の特別アンコール公演を描くインタラクティブストーリー。",
            },
            cast: {
                minori: "花里みのり",
                haruka: "桐谷遥",
                airi: "桃井愛莉",
                shizuku: "日野森雫",
                miku: "初音ミク",
            },
            places: {
                scene_01_rooftop: "宮益坂女子学園・屋上",
                scene_02a_stage_sekai: "ステージの「セカイ」・メインステージ",
                scene_02b_rehearsal: "みのりの部屋・レッスンノート前",
                scene_02c_livestream: "ライブシアター・照明チェック中",
                scene_03_climax_encore: "ステージの「セカイ」・アンコール最高潮",
            },
            beats,
            choices: {
                choice_01_encore: {
                    opt_sekai: "「ステージのセカイ」へ行き、ミクと新アンコールをリハーサルする",
                    opt_dance: "屋上に残って高難度クローバーフォーメーションを特訓する",
                    opt_stream: "生配信を開いてファンと一緒にコールを投票で決める",
                },
            },
            ends: {
                end_clover_miracle: {
                    title: "エンディングA：クローバー奇跡のアンコール",
                    subtitle: "初音ミクとセカイで満点の歓声を灯した（熱気：{{cheers}} / 絆：{{sync_rate}}）",
                },
                end_rooftop_promise: {
                    title: "エンディングB：屋上の風と星光",
                    subtitle: "汗と完璧なフォーメーションが紡いだ舞台（熱気：{{cheers}} / 絆：{{sync_rate}}）",
                },
                end_next_dream: {
                    title: "エンディングC：次の夢へジャンプ",
                    subtitle: "ファンと繋いだ新しい約束（熱気：{{cheers}} / 絆：{{sync_rate}}）",
                },
            },
        };
    }

    return {
        schema: STORY_I18N_SCHEMA_VERSION,
        storyId: doc.id,
        locale: "en-US",
        translationMeta: {
            origin: "ai_assisted",
            modelHint: "Claude / MoeSekai i18n Assistant",
            note: "Proofread English localization preserving PJSK character tone & placeholders",
            updatedAt: new Date().toISOString(),
        },
        meta: {
            title: "Shine On! Rooftop & Stage Encore",
            summary: "From Miyamasuzaka's breezy rooftop to Stage SEKAI—guide Minori Hanasato and MORE MORE JUMP! through an interactive fan-thanksgiving encore.",
        },
        cast: {
            minori: "Minori Hanasato",
            haruka: "Haruka Kiritani",
            airi: "Airi Momoi",
            shizuku: "Shizuku Hinomori",
            miku: "Hatsune Miku",
        },
        places: {
            scene_01_rooftop: "Miyamasuzaka Girls Academy · Rooftop",
            scene_02a_stage_sekai: "Stage SEKAI · Main Stage",
            scene_02b_rehearsal: "Minori's Room · Choreography Desk",
            scene_02c_livestream: "Live Theater · Lighting Check",
            scene_03_climax_encore: "Stage SEKAI · Encore Climax",
        },
        beats,
        choices: {
            choice_01_encore: {
                opt_sekai: "Head to Stage SEKAI to rehearse the new encore with Miku",
                opt_dance: "Stay on the rooftop to drill the Clover Star formation",
                opt_stream: "Go live and let fans vote on the encore cheer",
            },
        },
        ends: {
            end_clover_miracle: {
                title: "Ending A: Clover Miracle Encore",
                subtitle: "Lit up Stage SEKAI with Hatsune Miku (Hype: {{cheers}} / Sync: {{sync_rate}})",
            },
            end_rooftop_promise: {
                title: "Ending B: Rooftop Breeze & Starlight",
                subtitle: "A flawless encore forged through teamwork (Hype: {{cheers}} / Sync: {{sync_rate}})",
            },
            end_next_dream: {
                title: "Ending C: Leap to the Next Dream",
                subtitle: "A brand-new promise shared with fans (Hype: {{cheers}} / Sync: {{sync_rate}})",
            },
        },
    };
}

function buildVoiceManifest(doc: StoryDocument): StoryVoiceManifest {
    const slots = extractTalkBeatsForVoice(doc);
    const lines: StoryVoiceManifest["lines"] = {};
    let idx = 1;
    for (const slot of slots) {
        const stem = `${String(idx).padStart(2, "0")}_${slot.beatId}`;
        lines[slot.beatId] = {
            url: `https://story.pjsk.moe/demo-voices/mmj-encore/${stem}.ogg`,
            durationMs: 2400 + (idx % 4) * 650,
            locale: "zh-CN",
            speaker: slot.speakerName,
            codec: "opus",
            sizeBytes: 38_400 + idx * 1420,
        };
        idx += 1;
    }
    return {
        schema: STORY_VOICE_MANIFEST_SCHEMA_VERSION,
        storyId: doc.id,
        locale: "zh-CN",
        title: "MORE MORE JUMP! 社区定制配音包 (Opus 48kHz)",
        baseUrl: "https://story.pjsk.moe/demo-voices/mmj-encore/",
        storyRev: 3,
        generatedAt: new Date().toISOString(),
        lines,
    };
}

function writeSnapshot(workspaceDir: string, id: string, script: string, createdAt: string, reason: string, toolName: string, nodeCount: number, beatCount: number): void {
    const snapDir = path.join(workspaceDir, ".moesekai-studio", "snapshots");
    fs.mkdirSync(snapDir, { recursive: true });
    fs.writeFileSync(path.join(snapDir, `${id}.msk`), script, "utf8");
    fs.writeFileSync(
        path.join(snapDir, `${id}.meta.json`),
        JSON.stringify(
            {
                id,
                createdAt,
                reason,
                toolName,
                storyFile: "story.msk",
                nodeCount,
                beatCount,
                byteLength: Buffer.byteLength(script, "utf8"),
                sha256: crypto.createHash("sha256").update(script, "utf8").digest("hex"),
            },
            null,
            2,
        ),
        "utf8",
    );
}

export function setupDemoWorkspaces(): void {
    // Preserve asset-cache if it already exists so repeated runs reuse cached Live2D models!
    fs.mkdirSync(MMJ_WORKSPACE_DIR, { recursive: true });
    fs.mkdirSync(NIGHTCORD_WORKSPACE_DIR, { recursive: true });
    fs.mkdirSync(USER_DATA_DIR, { recursive: true });

    // 1. Validate MMJ story strictly
    const parsedMmj = parseStoryScript(MMJ_STORY_MSK);
    if (!parsedMmj.ok) {
        console.error("MMJ parse errors:", parsedMmj.errors);
        throw new Error("MMJ story failed to parse!");
    }
    const mmjDoc: StoryDocument = { ...parsedMmj.doc, sourceLocale: "zh-CN" };
    const compiledMmj = compileStoryGraph(mmjDoc);
    const mmjErrors = compiledMmj.diagnostics.filter(d => d.severity === "error");
    const mmjWarnings = compiledMmj.diagnostics.filter(d => d.severity === "warning");
    console.log(`[setup] MMJ story compiled: nodes=${Object.keys(mmjDoc.nodes).length}, edges=${mmjDoc.edges.length}, errors=${mmjErrors.length}, warnings=${mmjWarnings.length}`);
    if (mmjErrors.length > 0 || mmjWarnings.length > 0) {
        console.error("MMJ diagnostics:", compiledMmj.diagnostics);
        throw new Error("MMJ story must have 0 errors and 0 warnings!");
    }

    const jaPack = buildLocalePack(mmjDoc, "ja-JP");
    const enPack = buildLocalePack(mmjDoc, "en-US");
    const jaReport = detectOutdatedBeats(mmjDoc, jaPack);
    const enReport = detectOutdatedBeats(mmjDoc, enPack);
    console.log(`[setup] MMJ i18n ja-JP: ${jaReport.translatedCount}/${jaReport.totalCount}, outdated=${jaReport.outdatedBeatIds.length}`);
    console.log(`[setup] MMJ i18n en-US: ${enReport.translatedCount}/${enReport.totalCount}, outdated=${enReport.outdatedBeatIds.length}`);

    const voiceManifest = buildVoiceManifest(mmjDoc);
    const voiceMatch = matchVoiceManifestToDoc(mmjDoc, voiceManifest);
    console.log(`[setup] MMJ voice manifest matched: ${voiceMatch.matchedCount}/${voiceMatch.totalTalkBeats}`);

    // Write MMJ workspace
    fs.mkdirSync(path.join(MMJ_WORKSPACE_DIR, "locales"), { recursive: true });
    fs.mkdirSync(path.join(MMJ_WORKSPACE_DIR, "voices"), { recursive: true });
    fs.mkdirSync(path.join(MMJ_WORKSPACE_DIR, ".moesekai-studio", "snapshots"), { recursive: true });

    fs.writeFileSync(path.join(MMJ_WORKSPACE_DIR, "story.msk"), MMJ_STORY_MSK, "utf8");
    fs.writeFileSync(path.join(MMJ_WORKSPACE_DIR, "locales", "ja-JP.i18n.json"), JSON.stringify(jaPack, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(MMJ_WORKSPACE_DIR, "locales", "en-US.i18n.json"), JSON.stringify(enPack, null, 2) + "\n", "utf8");
    fs.writeFileSync(path.join(MMJ_WORKSPACE_DIR, "voices", "manifest.json"), JSON.stringify(voiceManifest, null, 2) + "\n", "utf8");
    fs.writeFileSync(
        path.join(MMJ_WORKSPACE_DIR, ".moesekai-studio", "project.json"),
        JSON.stringify({ id: "mmj_stage_encore", createdAt: Date.now() - 86_400_000, updatedAt: Date.now() }, null, 2),
        "utf8",
    );

    const now = Date.now();
    writeSnapshot(
        MMJ_WORKSPACE_DIR,
        "2026-11-23T14-42-10-a1b2c3",
        MMJ_STORY_MSK,
        new Date(now - 600_000).toISOString(),
        "Agent: 优化 scene_03_climax_encore 五人站位与表情联动",
        "story_patch_msk",
        10,
        24,
    );
    writeSnapshot(
        MMJ_WORKSPACE_DIR,
        "2026-11-23T14-18-05-d4e5f6",
        MMJ_STORY_MSK,
        new Date(now - 2_400_000).toISOString(),
        "Agent: 生成 ja-JP / en-US 双语字幕包并校验占位符",
        "story_generate_i18n",
        10,
        24,
    );
    writeSnapshot(
        MMJ_WORKSPACE_DIR,
        "2026-11-23T13-50-00-112233",
        MMJ_STORY_MSK,
        new Date(now - 5_400_000).toISOString(),
        "手动保存：屋顶与舞台世界分支主线初稿",
        "manual",
        10,
        21,
    );

    // 2. Write Nightcord starter workspace
    const parsedN25 = parseStoryScript(STARTER_STORY_ZH);
    if (!parsedN25.ok) throw new Error("Nightcord starter failed to parse");
    fs.mkdirSync(path.join(NIGHTCORD_WORKSPACE_DIR, "locales"), { recursive: true });
    fs.mkdirSync(path.join(NIGHTCORD_WORKSPACE_DIR, "voices"), { recursive: true });
    fs.mkdirSync(path.join(NIGHTCORD_WORKSPACE_DIR, ".moesekai-studio", "snapshots"), { recursive: true });
    fs.writeFileSync(path.join(NIGHTCORD_WORKSPACE_DIR, "story.msk"), STARTER_STORY_ZH, "utf8");
    fs.writeFileSync(
        path.join(NIGHTCORD_WORKSPACE_DIR, ".moesekai-studio", "project.json"),
        JSON.stringify({ id: "nightcord_unspoken_echo", createdAt: now - 172_800_000, updatedAt: now - 3_600_000 }, null, 2),
        "utf8",
    );
    writeSnapshot(
        NIGHTCORD_WORKSPACE_DIR,
        "2026-11-23T14-35-00-998877",
        STARTER_STORY_ZH,
        new Date(now - 900_000).toISOString(),
        "Agent: 润色 scene_06_climax 中奏与真冬的对话停顿与表情切换",
        "story_patch_msk",
        19,
        79,
    );
    writeSnapshot(
        NIGHTCORD_WORKSPACE_DIR,
        "2026-11-23T13-40-00-665544",
        STARTER_STORY_ZH,
        new Date(now - 4_200_000).toISOString(),
        "Agent: 补全 25时官方活动剧情对白风格参考",
        "story_mine_official",
        19,
        76,
    );
    writeSnapshot(
        NIGHTCORD_WORKSPACE_DIR,
        "2026-11-23T12-15-00-332211",
        STARTER_STORY_ZH,
        new Date(now - 9_000_000).toISOString(),
        "手动保存：25时的未名余音 完整三结局版本",
        "manual",
        19,
        72,
    );

    // 3. Seed recent-projects.json & settings.json inside USER_DATA_DIR
    const recentProjects = [
        {
            path: MMJ_WORKSPACE_DIR,
            rootDir: MMJ_WORKSPACE_DIR,
            mskFilePath: path.join(MMJ_WORKSPACE_DIR, "story.msk"),
            title: "闪耀吧！屋顶与舞台的安可曲",
            region: "jp",
            lastOpenedAt: now - 60_000,
            isSingleFile: false,
        },
        {
            path: NIGHTCORD_WORKSPACE_DIR,
            rootDir: NIGHTCORD_WORKSPACE_DIR,
            mskFilePath: path.join(NIGHTCORD_WORKSPACE_DIR, "story.msk"),
            title: "25时的未名余音",
            region: "jp",
            lastOpenedAt: now - 3_600_000,
            isSingleFile: false,
        },
    ];
    fs.writeFileSync(path.join(USER_DATA_DIR, "recent-projects.json"), JSON.stringify(recentProjects, null, 2) + "\n", "utf8");

    const settings = {
        themeSeed: "21",
        themeMode: "light",
        locale: "zh-CN",
        assetLine: "main",
        agentPanelOpen: false,
        agentPanelWidth: 400,
        updateChannel: "auto",
        autoCheckUpdates: false,
        ignoredUpdateVersion: null,
        assetCacheEnabled: true,
        assetCacheMaxMb: 2048,
        stageRenderQuality: "high",
    };
    fs.writeFileSync(path.join(USER_DATA_DIR, "desktop-settings.json"), JSON.stringify(settings, null, 2) + "\n", "utf8");

    const agentConfig = {
        mode: "sdk",
        provider: "anthropic",
        model: "claude-opus-5-5",
        baseUrl: "",
        thinkingLevel: "medium",
        authoringMode: "edit",
        planFirst: true,
        apiKeyPlainFallback: "sk-ant-demo-showcase-key",
        apiKeyHint: "sk-a••••-key",
        rpcCliPath: "pi",
        rpcArgs: [],
    };
    fs.writeFileSync(path.join(USER_DATA_DIR, "agent-config.json"), JSON.stringify(agentConfig, null, 2) + "\n", "utf8");

    console.log("[setup] Workspaces ready at:", PROMO_TEMP_ROOT);
}

if (import.meta.main) {
    setupDemoWorkspaces();
}
