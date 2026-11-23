/**
 * Official Japanese (`ja`) showcase MoeSekai Script (`.msk`) starter story.
 *
 * Cast: 25時、ナイトコードで。(宵崎奏, 朝比奈まふゆ, 東雲絵名, 暁山瑞希, 誰もいないセカイの初音ミク).
 * Graph: 19 nodes (1 start, 12 scenes, 2 choices, 1 condition, 3 endings), 21 edges, 79 beats.
 * Every BG, BGM, SE, Live2D model, motion, and facial clip matches `nightcord_unspoken_echo`.
 */
export const STARTER_STORY_JA = `# 25時、ナイトコードで。 中規模インタラクティブストーリー脚本 (moesekai-story/2)
# Moesekai Story Maker (https://pjsk.moe/story-maker/edit) の「コード」モードにそのまま貼り付けて再生可能

@story "25時の名もなき余韻" region=jp id="nightcord_unspoken_echo" author="Moesekai" summary="深夜25時、奏はサビ前の4小節のつなぎで行き詰まっていた。まふゆ・絵名・瑞希とナイトコードで合流し、余白・色彩・誰もいないセカイを巡る選択が、未完成の新曲をそれぞれの夜明けへと導く。"

@var resonance: number = 0 "共鳴度"
@var warmth: number = 0 "ぬくもり"
@var entered_sekai: boolean = false "誰もいないセカイへ"

@cast kanade "宵崎奏" model="v2_17kanade_casual" char=17
@cast mafuyu "朝比奈まふゆ" model="v2_18mafuyu_casual" char=18
@cast ena "東雲絵名" model="v2_19ena_casual" char=19
@cast mizuki "暁山瑞希" model="v2_20mizuki_casual" char=20
@cast miku "初音ミク" model="v2_21miku_night" char=21

start -> scene_01_demo

scene scene_01_demo "深夜のデモ行き詰まり" {
  bg set "bg_e000102"
  bgm play "bgm00169" vol=0.72
  place set "奏の部屋・深夜"
  transition fadeBlack 0.6
  cast set [
    kanade at center motion="w-kanade07-tilthead" facial="face_sad_01"
  ]

  telop "25:00 ―― 宵崎奏の部屋"
  cue se "se_pack00001/se00124" vol=0.75
  narration "モニターの淡い光が机を照らし、シンセサイザーの余韻が静かな部屋へと溶けていく。"
  talk kanade "（違う……Aメロからサビへ入るこの4小節、まだ音が詰まりすぎて急ぎすぎてる。）" motion="w-kanade16-lookdown" facial="face_sad_02"
  talk kanade "（届けたい人に、ほんの少しだけ息をつけるような感覚……あと一歩なのに……）" motion="w-normal03-trouble" facial="face_sad_03"
  cue se "se_pack00001_b/se00043_b" vol=0.75
  stage move kanade to left dur=0.45 motion="w-kanade07-tilthead" facial="face_smallmouth_01"
  stage enter mafuyu at right motion="w-normal16-nod" facial="face_normal_01"
  talk mafuyu "奏、もう25時。温かいお茶、淹れてきた。" motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "あ……ありがとう、まふゆ。絵名と瑞希もそろそろ入ってる頃かな。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mafuyu "うん。さっき何度も弾いていたところ、廊下まで聴こえてた。" motion="w-normal07-tilthead" facial="face_smallmouth_01"
  cue se "se_pack00001_b/se00084_b" vol=0.8
  talk kanade "ちょうどよかった。ひとまずこのデモ、ナイトコードに上げてみんなにも聴いてもらおう。" motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_02_call

scene scene_02_call "4人の深夜試聴会" {
  bg set "bg_h000309"
  bgm play "bgm00169" vol=0.70
  place set "ナイトコード・通話中"
  transition fadeBlack 0.5
  cast set [
    kanade at farLeft facial="face_normal_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_normal_01"
    mizuki at farRight facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00183_b" vol=0.75
  talk mizuki "やっほー、こんばんは！Kが上げてくれた『demo_v4_bridge.wav』、もう再生してるよー！" motion="w-normal01-nod" facial="face_smile_01" react(ena motion="w-cool02-tilthead" facial="face_smile_01")
  talk ena "あたしも今2回聴き終わったところ。なんていうか……Aメロはすごく引き込まれるのに、つなぎに入った瞬間、壁にぶつかる感じがするんだよね。" motion="w-normal01-tilthead" facial="face_trouble_02" react(kanade motion="w-kanade16-tilthead" facial="face_sad_01")
  talk mizuki "うんうん、このままMVのカットを入れようとすると、一息つく余白がぎゅうぎゅうになっちゃうかも。" motion="w-normal01-tilthead" facial="face_smallmouth_01"
  talk mafuyu "……閉じた扉の前で、手を伸ばしかけて止まってしまったみたい。" motion="w-normal15-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01") react(ena motion="w-adult01-tilthead" facial="face_smallmouth_01")
  talk kanade "閉じた扉の前……うん、まふゆの言う通りかもしれない。このつなぎ、どこからほどいていこう……" motion="w-kanade16-lookdown" facial="face_sad_02"
} -> choice_01_direction

choice choice_01_direction "サビ前の4小節、どう組み直す？" {
  opt_melody: "ストリングスを抜き、ピアノ単音と息づく余白だけ残す" [resonance += 2] -> scene_03a_sparse
  opt_illustration: "絵名のラフ画を見て、色彩からつなぎを探る" [resonance += 1, warmth += 1] -> scene_03b_sketch
  opt_lyrics: "まふゆに、さっきの感覚を短い歌詞にしてもらう" [warmth += 2] -> scene_03c_lyric
}

scene scene_03a_sparse "余白の呼吸" {
  bg set "bg_e000102"
  bgm play "bgm00173" vol=0.72
  place set "奏の部屋・デスク前"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "シンセパッドとストリングスを全部ミュートして、高音のピアノ単音だけにしてみるね……" motion="w-kanade07-nod" facial="face_normal_01"
  cue se "se_pack00001/se00124" vol=0.8
  talk mafuyu "……あ。さっきの胸が苦しくなる感じ、すっと引いた。" motion="w-normal07-tilthead" facial="face_smallmouth_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "そうだね、無理に扉を押し開けるんじゃなくて、その前で静かに一拍だけ立ち止まるみたいに。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "『おおっ！ヘッドホンの中が一気に澄んで、夜風が吹き抜けたみたいだよ！』" se="se_pack00001_b/se00007_b" seVol=0.65
  talk kanade "うん、この方向で合ってるみたい（共鳴度が {{resonance}} に上がった）。" motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03b_sketch "灰青の夜明けラフ" {
  bg set "bg_e000303"
  bgm play "bgm00180" vol=0.72
  place set "絵名の部屋・液タブ前"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00084_b" vol=0.75
  talk ena "さっき試し塗りしたカラーラフ、送ったから。まだラフだし、細かいツッコミは禁止だからね！" motion="w-normal01-tilthead" facial="face_trouble_02" react(mizuki motion="w-cute02-nod" facial="face_smile_01")
  talk mizuki "わぁ、えななん！濃いグレーの影に淡い群青をひと刷毛入れてるの、すっごく綺麗！" motion="w-normal01-nod" facial="face_smile_02"
  talk ena "えっ、そう？そんなに褒められると、なんか照れるんだけど……" motion="w-cute01-tilthead" facial="face_smile_01"
  talk kanade "『……こういう色なんだね。夜明け前、まだ光はないのに真っ暗でもない灰青色。』"
  talk ena "そう！つなぎの部分も、この色がじわっと滲むみたいに鳴ったら絶対ぴったりだよ。" motion="w-cute02-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03c_lyric "扉の前のささやき" {
  bg set "bg_e000102"
  bgm play "bgm00171" vol=0.72
  place set "奏の部屋・深夜"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "まふゆ、さっきの『閉じた扉の前で』って言葉……短い2行くらいの歌詞にしてみてもらえるかな？" motion="w-kanade07-tilthead" facial="face_smile_01"
  talk mafuyu "やってみる。……はい、メモに書いた。" motion="w-normal15-nod" facial="face_normal_01"
  stage move kanade to center dur=0.45 overlap motion="w-normal15-tilthead" facial="face_smile_01"
  stage move mafuyu to center dur=0.45 overlap motion="w-normal15-shy" facial="face_normal_01"
  narration "画面を覗き込むふたりの肩が並び、カップから立ち上る湯気がモニターの光に淡く溶け合う。"
  talk kanade "『指先がまだ扉に触れなくても、風は鍵穴をすり抜けている』……まふゆ、すごくいい言葉だよ。" motion="w-normal07-nod" facial="face_smile_01" react(mafuyu motion="w-normal15-tilthead" facial="face_smallmouth_01")
  talk mafuyu "……奏の役に立てたなら、よかった。" motion="w-normal16-nod" facial="face_normal_01"
} -> scene_04_pause

scene scene_04_pause "午前二時半の岐路" {
  bg set "bg_e000102"
  bgm stop
  place set "奏の部屋・午前02:30"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  telop "02:30 ―― 静まり返った深夜"
  talk mizuki "『ふぁ……気づいたらもう二時半だぁ。K、今夜一気に仕上げちゃう？それとも一回寝る？』" se="se_pack00001_b/se00007_b" seVol=0.65
  talk ena "『これ以上徹夜してまふゆに怒られたら、明日あたし達までとばっちり食らうんだけど。』"
  cue se "se_pack00001/se00091" vol=0.75
  narration "その瞬間、机の上のスマホが淡い白い光を放ち、プレイリストの『Untitled』が静かに明滅した。"
  talk mafuyu "……奏、スマホが光ってる。それに、そろそろ決める時間。" motion="w-normal16-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01")
  talk kanade "うん……今の感覚が消えないうちに、どうするのがいいかな……" motion="w-kanade16-tilthead" facial="face_sad_01"
} -> choice_02_late_night

choice choice_02_late_night "最終ミックスの前に、次はどうする？" {
  opt_sekai: "感覚が鮮明なうちに『Untitled』を再生してセカイへ行く" [resonance += 2, entered_sekai = true] -> scene_05a_sekai
  opt_rest: "みんなの言う通り休んで、明日カフェで落ち合う" [warmth += 2] -> scene_05b_cafe
}

scene scene_05a_sekai "静寂のセカイに響く音" {
  bg set "bg_e000501"
  bgm play "bgm_area00005" vol=0.75
  place set "誰もいないセカイ"
  transition fadeWhite 0.7
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_normal_01"
  ]

  cue se "se_pack00001/se00092" vol=0.8
  telop "誰もいないセカイ"
  talk miku "奏、まふゆ……来てくれたんだね。" motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "ミク、さっき部屋で直したメロディ、もう一度ここで確かめてみたくて。" motion="w-kanade07-tilthead" facial="face_smile_01"
  talk miku "うん……ずっと聴いてたよ。前の曲は暗闇をひとりで歩いているみたいだったけど、今日のは……" motion="w-normal03-tilthead" facial="face_night_smallmouth_01"
  talk miku "立ち止まった一拍の中で、誰かが近づいてくる足音が聴こえるの。" motion="w-normal01-tilthead" facial="face_night_smile_01" react(mafuyu motion="w-normal07-tilthead" facial="face_smallmouth_01") react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk mafuyu "誰かが近づいてくる足音……そうか、そういう音だったんだ。" motion="w-normal15-nod" facial="face_normal_01"
  talk kanade "ありがとう、ミク！最後の余韻をどう落とせばいいか、ようやくわかったよ。" motion="w-normal15-nod" facial="face_smile_01"
} -> scene_06_climax

scene scene_05b_cafe "午後の街角、ほんのり甘く" {
  bg set "bg_a001401"
  bgm play "bgm00180" vol=0.74
  place set "街角のカフェ・翌日の午後"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "翌日の午後 ―― 街角のカフェ"
  talk mizuki "お待たせー！期間限定のいちごパフェ・クリーム増量だよ、えななん早く撮って撮って！" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute02-nod" facial="face_smile_01")
  cue se "se_pack00001_b/se00075_b" vol=0.8
  talk ena "ちょっと瑞希、指が写り込んでるってば！……でも、このお店の日差し、たしかに気持ちいいかも。" motion="w-cool02-tilthead" facial="face_smile_01"
  talk mafuyu "奏、ホットココア、冷めてしまうよ。" motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "うん……ちゃんと眠ってからみんなのやり取りを聴いてたら、サビ前の和音、もう少し温かくしてもいい気がしてきた。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "えへへ、これぞメリハリの魔法ってやつだね！今夜25時、Kの完成版を楽しみにしてるよー！" motion="w-cool10-tilthead" facial="face_smile_06"
} -> scene_06_climax

scene scene_06_climax "25時の完成版試聴" {
  bg set "bg_h000309"
  bgm play "bgm00171" vol=0.76
  place set "ナイトコード・翌日25:00"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "翌日 25:00 ―― 最終版試聴"
  cue se "se_pack00001_b/se00183_b" vol=0.8
  talk kanade "みんな、お待たせ。『demo_final_25ji.wav』、今アップロードしたよ。" motion="w-normal15-nod" facial="face_smile_01"
  cue se "se_pack00001/se00124" vol=0.85
  narration "澄んだピアノの単音が静かな夜をそっと叩き、優しい一拍の余白のあと、サビが淡い光のように広がっていく。"
  talk ena "……よかった。扉の前で詰まる息苦しさが綺麗に消えて、頭の中に新しい構図がどんどん浮かんでくる！" motion="w-cute02-nod" facial="face_smile_01" react(mizuki motion="w-normal01-nod" facial="face_smile_02")
  talk mizuki "うんうん！いつもの25時らしい静けさのまま、一歩踏み出したくなる温もりが増えてるね！" motion="w-cute02-nod" facial="face_smile_01"
  talk mafuyu "……うん。胸の奥のほうで、何かが小さく動いた気がする。" motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk kanade "まふゆにそう言ってもらえたなら……この曲はもう、答えを見つけられたんだね。" motion="w-kanade07-nod" facial="face_smile_01"
} -> cond_ending

condition cond_ending "エンディング分岐" {
  rule_sekai: if entered_sekai == true "誰もいないセカイ共鳴ルート" -> scene_07a_epilogue_sekai
  rule_warm: if warmth >= 3 "日常のぬくもりルート" -> scene_07b_epilogue_warm
  else -> scene_07c_epilogue_quiet
}

scene scene_07a_epilogue_sekai "灰白の野を越える歌" {
  bg set "bg_e000501"
  bgm play "bgm00024" vol=0.74
  place set "誰もいないセカイ・余韻"
  transition fadeWhite 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_smile_01"
  ]

  cue se "se_pack00001/se00091" vol=0.75
  talk miku "聴こえる？新しい曲の響き、セカイの遠くでまだ消えずに残ってるよ。" motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk mafuyu "うん……ここにはまだ何もないけれど、今の静けさは、少し安心する。" motion="w-normal15-tilthead" facial="face_normal_01"
  talk kanade "こんな旋律を書き続けられるなら、何度夜が来ても、またここでみんなと会えるね。" motion="w-kanade07-nod" facial="face_smile_01"
} -> end_sekai_dawn

scene scene_07b_epilogue_warm "ヘッドホンに灯る微光" {
  bg set "bg_e000403"
  bgm play "bgm00024" vol=0.74
  place set "瑞希の部屋・深夜編集中"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  talk mizuki "よーし！えななんが描いた灰青の夜明けイラストをサビ頭に重ねて――完璧！" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute01-tilthead" facial="face_smile_01")
  talk ena "ふん、今回はセンス認めてあげる。まふゆの詞にKの曲だもん、誰にも負けるわけないよね！" motion="w-cute02-nod" facial="face_smile_01"
  talk mizuki "えへへ、次の打ち上げもまたいちごパフェ食べに行こうね！" motion="w-cool10-tilthead" facial="face_smile_06"
} -> end_warm_chorus

scene scene_07c_epilogue_quiet "25時だけの呼吸" {
  bg set "bg_e000101"
  bgm play "bgm00024" vol=0.72
  place set "奏の部屋・夜明けの気配"
  transition fadeBlack 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at right facial="face_normal_01"
  ]

  narration "カーテンの隙間から涼やかな朝日が差し込み、ヘッドホンのループ再生が最後の倍音で静かに止まった。"
  talk mafuyu "奏、もう朝だよ。今日はちゃんと眠って。" motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "うん……おやすみ、まふゆ。また明日の25時に。" motion="w-normal15-nod" facial="face_smile_01"
} -> end_quiet_morning

end end_sekai_dawn "エンドA：灰白の静寂を抜ける旋律" subtitle="誰もいないセカイで名もなき音を見つけた（共鳴度：{{resonance}} / ぬくもり：{{warmth}}）"
end end_warm_chorus "エンドB：4人分のぬくもりと甘い午後" subtitle="日常の温度がサビの和音になった（共鳴度：{{resonance}} / ぬくもり：{{warmth}}）"
end end_quiet_morning "エンドC：夜明けの窓辺に残る余韻" subtitle="余白と呼吸の中で新曲を完成させた（共鳴度：{{resonance}} / ぬくもり：{{warmth}}）"`;
