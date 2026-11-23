/**
 * Official Simplified Chinese (`zh`) showcase MoeSekai Script (`.msk`) starter story.
 *
 * Cast: 25-ji, Nightcord de. (Kanade, Mafuyu, Ena, Mizuki, Empty SEKAI Miku).
 * Graph: 19 nodes (1 start, 12 scenes, 2 choices, 1 condition, 3 endings), 21 edges, 79 beats.
 * Every BG, BGM, SE, Live2D model, motion, and facial clip is verified (`0 errors, 0 warnings`).
 */
export const STARTER_STORY_ZH = `# 25-ji, Nightcord de. 中等规模互动剧情脚本 (moesekai-story/2)
# 可直接粘贴至 Moesekai Story Maker (https://pjsk.moe/story-maker/edit)「代码」模式运行

@story "25时的未名余音" region=jp id="nightcord_unspoken_echo" author="Moesekai" summary="深夜25时，奏在编曲副歌前的过渡段陷入瓶颈。随着真冬、绘名与瑞希在Nightcord汇合，每一次关于留白、色彩与无人『世界』的抉择，都将把这首未完成的新曲引向不同的拂晓。"

@var resonance: number = 0 "共鸣度"
@var warmth: number = 0 "温度感"
@var entered_sekai: boolean = false "造访无人世界"

@cast kanade "宵崎奏" model="v2_17kanade_casual" char=17
@cast mafuyu "朝比奈真冬" model="v2_18mafuyu_casual" char=18
@cast ena "东云绘名" model="v2_19ena_casual" char=19
@cast mizuki "晓山瑞希" model="v2_20mizuki_casual" char=20
@cast miku "初音未来" model="v2_21miku_night" char=21

start -> scene_01_demo

scene scene_01_demo "深夜的Demo卡壳" {
  bg set "bg_e000102"
  bgm play "bgm00169" vol=0.72
  place set "奏的房间·深夜"
  transition fadeBlack 0.6
  cast set [
    kanade at center motion="w-kanade07-tilthead" facial="face_sad_01"
  ]

  telop "25:00 —— 宵崎奏的房间"
  cue se "se_pack00001/se00124" vol=0.75
  narration "显示器幽微的冷光映在桌面，合成器的尾音在空旷的房间里缓缓消散。"
  talk kanade "（不对……从主歌进副歌的这四小节，还是太满太急了。）" motion="w-kanade16-lookdown" facial="face_sad_02"
  talk kanade "（想要传达给那个人、能让人稍微喘口气的感觉，还差一点点……）" motion="w-normal03-trouble" facial="face_sad_03"
  cue se "se_pack00001_b/se00043_b" vol=0.75
  stage move kanade to left dur=0.45 motion="w-kanade07-tilthead" facial="face_smallmouth_01"
  stage enter mafuyu at right motion="w-normal16-nod" facial="face_normal_01"
  talk mafuyu "奏，已经二十五点了。我泡了热茶过来。" motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "啊……谢谢你，真冬。绘名和瑞希应该也上线了。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mafuyu "嗯。刚才你反复弹的那一段，我在门外也听见了。" motion="w-normal07-tilthead" facial="face_smallmouth_01"
  cue se "se_pack00001_b/se00084_b" vol=0.8
  talk kanade "正好，先把这一版小样发到Nightcord上听听看吧。" motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_02_call

scene scene_02_call "四人的深夜听歌会" {
  bg set "bg_h000309"
  bgm play "bgm00169" vol=0.70
  place set "Nightcord·语音通话中"
  transition fadeBlack 0.5
  cast set [
    kanade at farLeft facial="face_normal_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_normal_01"
    mizuki at farRight facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00183_b" vol=0.75
  talk mizuki "呀吼——晚上好！K刚上传的『demo_v4_bridge.wav』我已经点开咯！" motion="w-normal01-nod" facial="face_smile_01" react(ena motion="w-cool02-tilthead" facial="face_smile_01")
  talk ena "我也刚听完两遍。怎么说呢……主歌的氛围明明很抓人，但一到过渡段就像突然撞上了一堵墙。" motion="w-normal01-tilthead" facial="face_trouble_02" react(kanade motion="w-kanade16-tilthead" facial="face_sad_01")
  talk mizuki "嗯嗯，如果立刻要配MV转场的话，这里连呼吸的空隙都快塞不下啦。" motion="w-normal01-tilthead" facial="face_smallmouth_01"
  talk mafuyu "……就像站在紧闭的门前，想伸手却又停在半空一样。" motion="w-normal15-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01") react(ena motion="w-adult01-tilthead" facial="face_smallmouth_01")
  talk kanade "站在紧闭的门前……嗯，真冬形容得很准。那这一段过渡，该从哪里破局呢……" motion="w-kanade16-lookdown" facial="face_sad_02"
} -> choice_01_direction

choice choice_01_direction "如何调整副歌前的四小节过渡？" {
  opt_melody: "抽走弦乐铺底，只留钢琴单音与呼吸留白" [resonance += 2] -> scene_03a_sparse
  opt_illustration: "先看绘名刚画完的草图，从色彩寻找过渡" [resonance += 1, warmth += 1] -> scene_03b_sketch
  opt_lyrics: "请真冬试着把刚才那句感受写成过渡词" [warmth += 2] -> scene_03c_lyric
}

scene scene_03a_sparse "留白的呼吸" {
  bg set "bg_e000102"
  bgm play "bgm00173" vol=0.72
  place set "奏的房间·编曲台前"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "我试着把合成器垫音和弦乐全部静音，只留下高音区的一串单音……" motion="w-kanade07-nod" facial="face_normal_01"
  cue se "se_pack00001/se00124" vol=0.8
  talk mafuyu "……啊。刚才那种让人胸口发闷的压迫感，散开了。" motion="w-normal07-tilthead" facial="face_smallmouth_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "对，不是强行推开门，而是先在门前安静地停顿一拍。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "『哦哦！耳机里一下子变得好通透，像夜风吹进来了一样！』" se="se_pack00001_b/se00007_b" seVol=0.65
  talk kanade "嗯，这个方向是对的（共鸣度提升至 {{resonance}}）。" motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03b_sketch "灰蓝色的拂晓草图" {
  bg set "bg_e000303"
  bgm play "bgm00180" vol=0.72
  place set "绘名的房间·数位屏前"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00084_b" vol=0.75
  talk ena "我把刚才随手涂的色稿发到群里了。还只是草稿，不准挑刺啊！" motion="w-normal01-tilthead" facial="face_trouble_02" react(mizuki motion="w-cute02-nod" facial="face_smile_01")
  talk mizuki "哇，绘名这次在深灰的阴影里抹了一道很淡的群青色耶，好漂亮！" motion="w-normal01-nod" facial="face_smile_02"
  talk ena "え、真的？听到你这么夸，总觉得有点不好意思……" motion="w-cute01-tilthead" facial="face_smile_01"
  talk kanade "『……原来是这种颜色。天快亮之前、还没有阳光却已经不再漆黑的灰蓝色。』"
  talk ena "没错！如果过渡段也能像这抹灰蓝色一样慢慢渗进来就好了。" motion="w-cute02-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03c_lyric "门前的低语" {
  bg set "bg_e000102"
  bgm play "bgm00171" vol=0.72
  place set "奏的房间·深夜"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "真冬，你刚才说的『站在紧闭的门前』……能不能试着写成两句短词？" motion="w-kanade07-tilthead" facial="face_smile_01"
  talk mafuyu "我试试看。……给你，写在备忘录上了。" motion="w-normal15-nod" facial="face_normal_01"
  stage move kanade to center dur=0.45 overlap motion="w-normal15-tilthead" facial="face_smile_01"
  stage move mafuyu to center dur=0.45 overlap motion="w-normal15-shy" facial="face_normal_01"
  narration "两人并肩凑在屏幕前，茶杯升起的温热白雾在显示器光影间轻轻交融。"
  talk kanade "『即使指尖还没有触碰门扉，风声也已经穿过了锁孔』……真冬，这句词太棒了。" motion="w-normal07-nod" facial="face_smile_01" react(mafuyu motion="w-normal15-tilthead" facial="face_smallmouth_01")
  talk mafuyu "……只要能帮上奏的忙就好。" motion="w-normal16-nod" facial="face_normal_01"
} -> scene_04_pause

scene scene_04_pause "凌晨两点的分岔" {
  bg set "bg_e000102"
  bgm stop
  place set "奏的房间·凌晨02:30"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  telop "02:30 —— 寂静的深夜"
  talk mizuki "『呼啊……不知不觉已经两点半啦。K，今晚是准备一口气收尾，还是先休息呀？』" se="se_pack00001_b/se00007_b" seVol=0.65
  talk ena "『要是再熬通宵被真冬抓到，明天我们可都要跟着挨训了。』"
  cue se "se_pack00001/se00091" vol=0.75
  narration "就在此时，桌上的手机屏幕忽然泛起一圈淡淡的白光，播放列表里的『Untitled』轻轻闪烁。"
  talk mafuyu "……奏，手机在发光。而且你也差不多该做决定了。" motion="w-normal16-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01")
  talk kanade "嗯……趁现在的感觉还没有消散，该怎么做才好呢？" motion="w-kanade16-tilthead" facial="face_sad_01"
} -> choice_02_late_night

choice choice_02_late_night "在完成最终混音前，接下来要如何行动？" {
  opt_sekai: "趁灵光未散，点击『Untitled』前往无人世界" [resonance += 2, entered_sekai = true] -> scene_05a_sekai
  opt_rest: "听大家的劝告先去休息，明天约在街角甜品店汇合" [warmth += 2] -> scene_05b_cafe
}

scene scene_05a_sekai "寂静世界的回响" {
  bg set "bg_e000501"
  bgm play "bgm_area00005" vol=0.75
  place set "无人「世界」"
  transition fadeWhite 0.7
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_normal_01"
  ]

  cue se "se_pack00001/se00092" vol=0.8
  telop "无人「世界」"
  talk miku "奏，真冬……你们来了呀。" motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "未来，刚才在房间里改的那段旋律，总觉得还想在这里确认一次。" motion="w-kanade07-tilthead" facial="face_smile_01"
  talk miku "嗯……我一直听着哦。以前的歌像是在黑暗里独自走路，但今天这一段……" motion="w-normal03-tilthead" facial="face_night_smallmouth_01"
  talk miku "在停顿的那一拍里，能听见另一个人走近的脚步声。" motion="w-normal01-tilthead" facial="face_night_smile_01" react(mafuyu motion="w-normal07-tilthead" facial="face_smallmouth_01") react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk mafuyu "另一个人走近的声音……原来是这样。" motion="w-normal15-nod" facial="face_normal_01"
  talk kanade "谢谢你，未来！我明白最后那一个尾音该怎么落下了。" motion="w-normal15-nod" facial="face_smile_01"
} -> scene_06_climax

scene scene_05b_cafe "午后街角的微甜" {
  bg set "bg_a001401"
  bgm play "bgm00180" vol=0.74
  place set "街角咖啡甜品店·次日午后"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "次日午后 —— 街角甜品店"
  talk mizuki "久等啦！限定版草莓芭菲加双份奶油，绘名快拍快拍！" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute02-nod" facial="face_smile_01")
  cue se "se_pack00001_b/se00075_b" vol=0.8
  talk ena "等一下啦瑞希，你的手指入镜了！……不过这家店的阳光还真是舒服。" motion="w-cool02-tilthead" facial="face_smile_01"
  talk mafuyu "奏，你的热可可再不喝就要凉了哦。" motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "嗯……睡饱之后再听大家拌嘴的声音，忽然觉得副歌前的和弦可以更温暖一点。" motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "嘿嘿，这就是劳逸结合的魔法嘛！今晚25时，我们就等着听K的最终版咯！" motion="w-cool10-tilthead" facial="face_smile_06"
} -> scene_06_climax

scene scene_06_climax "25时的成品试听" {
  bg set "bg_h000309"
  bgm play "bgm00171" vol=0.76
  place set "Nightcord·次日25:00"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "次日 25:00 —— 最终版试听"
  cue se "se_pack00001_b/se00183_b" vol=0.8
  talk kanade "大家久等了。『demo_final_25ji.wav』已经上传好了。" motion="w-normal15-nod" facial="face_smile_01"
  cue se "se_pack00001/se00124" vol=0.85
  narration "清澈的钢琴单音在寂静的夜色中轻轻叩响，经历一拍温柔的留白后，副歌如微光般层层绽放。"
  talk ena "……太好了。那种卡在门前的窒息感完全消失了，现在我脑子里全是新画面的构图！" motion="w-cute02-nod" facial="face_smile_01" react(mizuki motion="w-normal01-nod" facial="face_smile_02")
  talk mizuki "嗯嗯！既有25时一贯的静谧，又多了一丝让人想往前迈一步的余温呢！" motion="w-cute02-nod" facial="face_smile_01"
  talk mafuyu "……嗯。胸口深处，好像也有什么地方轻轻动了一下。" motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk kanade "能听到真冬这么说……这首歌，就已经找到它的答案了。" motion="w-kanade07-nod" facial="face_smile_01"
} -> cond_ending

condition cond_ending "曲终走向判定" {
  rule_sekai: if entered_sekai == true "无人世界共鸣路线" -> scene_07a_epilogue_sekai
  rule_warm: if warmth >= 3 "日常微光路线" -> scene_07b_epilogue_warm
  else -> scene_07c_epilogue_quiet
}

scene scene_07a_epilogue_sekai "穿过灰白原野的歌" {
  bg set "bg_e000501"
  bgm play "bgm00024" vol=0.74
  place set "无人「世界」·余音"
  transition fadeWhite 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_smile_01"
  ]

  cue se "se_pack00001/se00091" vol=0.75
  talk miku "听见了吗？这首新歌的回声，在『世界』的远处一直没有散去哦。" motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk mafuyu "嗯……虽然这里依然什么都没有，但现在的安静，让人觉得很安心。" motion="w-normal15-tilthead" facial="face_normal_01"
  talk kanade "只要还能写出这样的旋律，无论多少个夜晚，我们都能在这里相聚。" motion="w-kanade07-nod" facial="face_smile_01"
} -> end_sekai_dawn

scene scene_07b_epilogue_warm "不曾熄灭的耳机微光" {
  bg set "bg_e000403"
  bgm play "bgm00024" vol=0.74
  place set "瑞希的房间·深夜剪辑中"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  talk mizuki "好嘞！把绘名画的灰蓝色拂晓插图叠进副歌第一帧——完美！" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute01-tilthead" facial="face_smile_01")
  talk ena "哼，这次算你剪得有品味。真冬的词加上K的曲子，这次的作品绝对不会输给任何人！" motion="w-cute02-nod" facial="face_smile_01"
  talk mizuki "嘿嘿，下次庆功会还要再去吃一次草莓芭菲哦！" motion="w-cool10-tilthead" facial="face_smile_06"
} -> end_warm_chorus

scene scene_07c_epilogue_quiet "独属于25时的呼吸" {
  bg set "bg_e000101"
  bgm play "bgm00024" vol=0.72
  place set "奏的房间·拂晓微光"
  transition fadeBlack 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at right facial="face_normal_01"
  ]

  narration "窗帘缝隙透进第一缕微凉的晨光，耳机里的循环播放终于停在了最后一个泛音。"
  talk mafuyu "奏，天已经亮了。今天好好睡一觉吧。" motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "嗯……晚安，真冬。明天25时再见。" motion="w-normal15-nod" facial="face_smile_01"
} -> end_quiet_morning

end end_sekai_dawn "结局A：穿破灰白寂静的旋律" subtitle="在无人『世界』寻回了未名之音（共鸣度：{{resonance}} / 温度感：{{warmth}}）"
end end_warm_chorus "结局B：四人份的微光与甜点" subtitle="日常的温度化作了副歌的和弦（共鸣度：{{resonance}} / 温度感：{{warmth}}）"
end end_quiet_morning "结局C：拂晓窗边的余音" subtitle="在留白与呼吸间完成了新曲（共鸣度：{{resonance}} / 温度感：{{warmth}}）"`;
