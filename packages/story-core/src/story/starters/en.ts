/**
 * Official English (`en`) showcase MoeSekai Script (`.msk`) starter story.
 *
 * Cast: Nightcord at 25:00 (Kanade, Mafuyu, Ena, Mizuki, Empty SEKAI Miku).
 * Graph: 19 nodes (1 start, 12 scenes, 2 choices, 1 condition, 3 endings), 21 edges, 79 beats.
 * Every BG, BGM, SE, Live2D model, motion, and facial clip matches `nightcord_unspoken_echo`.
 */
export const STARTER_STORY_EN = `# Nightcord at 25:00 Interactive Story Script (moesekai-story/2)
# Paste directly into Moesekai Story Maker (https://pjsk.moe/story-maker/edit) Code mode to run

@story "Unspoken Echo at 25:00" region=jp id="nightcord_unspoken_echo" author="Moesekai" summary="At 25:00, Kanade hits a wall on the four-bar transition leading into the chorus. As Mafuyu, Ena, and Mizuki gather on Nightcord, every choice of stillness, color, or the Empty SEKAI guides their unfinished song toward a different dawn."

@var resonance: number = 0 "Resonance"
@var warmth: number = 0 "Warmth"
@var entered_sekai: boolean = false "Visited Empty SEKAI"

@cast kanade "Kanade Yoisaki" model="v2_17kanade_casual" char=17
@cast mafuyu "Mafuyu Asahina" model="v2_18mafuyu_casual" char=18
@cast ena "Ena Shinonome" model="v2_19ena_casual" char=19
@cast mizuki "Mizuki Akiyama" model="v2_20mizuki_casual" char=20
@cast miku "Hatsune Miku" model="v2_21miku_night" char=21

start -> scene_01_demo

scene scene_01_demo "Stalled Midnight Demo" {
  bg set "bg_e000102"
  bgm play "bgm00169" vol=0.72
  place set "Kanade's Room - Late Night"
  transition fadeBlack 0.6
  cast set [
    kanade at center motion="w-kanade07-tilthead" facial="face_sad_01"
  ]

  telop "25:00 — Kanade Yoisaki's Room"
  cue se "se_pack00001/se00124" vol=0.75
  narration "Faint cool light from the monitor washes over the desk as the synthesizer's tail fades into the quiet room."
  talk kanade "(No... These four bars from the verse into the chorus are still too crowded, too rushed.)" motion="w-kanade16-lookdown" facial="face_sad_02"
  talk kanade "(That feeling I want to reach them with—a space where someone can finally catch their breath—it's still just out of reach...)" motion="w-normal03-trouble" facial="face_sad_03"
  cue se "se_pack00001_b/se00043_b" vol=0.75
  stage move kanade to left dur=0.45 motion="w-kanade07-tilthead" facial="face_smallmouth_01"
  stage enter mafuyu at right motion="w-normal16-nod" facial="face_normal_01"
  talk mafuyu "Kanade, it's already 25:00. I brought some hot tea." motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "Ah... thank you, Mafuyu. Ena and Mizuki should be online by now too." motion="w-normal15-tilthead" facial="face_smile_01"
  talk mafuyu "Yeah. I could hear that phrase you kept looping from outside the door." motion="w-normal07-tilthead" facial="face_smallmouth_01"
  cue se "se_pack00001_b/se00084_b" vol=0.8
  talk kanade "Good timing. Let me drop this rough demo on Nightcord so everyone can listen." motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_02_call

scene scene_02_call "Late-Night Listening Call" {
  bg set "bg_h000309"
  bgm play "bgm00169" vol=0.70
  place set "Nightcord - Voice Call"
  transition fadeBlack 0.5
  cast set [
    kanade at farLeft facial="face_normal_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_normal_01"
    mizuki at farRight facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00183_b" vol=0.75
  talk mizuki "Yahoo—good evening! I'm already playing 'demo_v4_bridge.wav' that K just uploaded!" motion="w-normal01-nod" facial="face_smile_01" react(ena motion="w-cool02-tilthead" facial="face_smile_01")
  talk ena "I just listened through it twice too. How do I put it... the verse pulls you right in, then the bridge slams straight into a wall." motion="w-normal01-tilthead" facial="face_trouble_02" react(kanade motion="w-kanade16-tilthead" facial="face_sad_01")
  talk mizuki "Mm-hmm! If I cut an MV transition right there, there's barely any room left to breathe." motion="w-normal01-tilthead" facial="face_smallmouth_01"
  talk mafuyu "...It feels like standing before a closed door, reaching out only to freeze halfway." motion="w-normal15-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01") react(ena motion="w-adult01-tilthead" facial="face_smallmouth_01")
  talk kanade "Standing before a closed door... Yes, Mafuyu put it into words. Where should we open up this bridge?" motion="w-kanade16-lookdown" facial="face_sad_02"
} -> choice_01_direction

choice choice_01_direction "How should we rework the four-bar pre-chorus?" {
  opt_melody: "Drop the strings, leaving solo piano notes and quiet space" [resonance += 2] -> scene_03a_sparse
  opt_illustration: "Check Ena's new color rough and shape the bridge by hue" [resonance += 1, warmth += 1] -> scene_03b_sketch
  opt_lyrics: "Ask Mafuyu to turn that image into two bridge lines" [warmth += 2] -> scene_03c_lyric
}

scene scene_03a_sparse "Room to Breathe" {
  bg set "bg_e000102"
  bgm play "bgm00173" vol=0.72
  place set "Kanade's Room - Synth Desk"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "I'll mute the synth pad and strings completely, leaving just a fragile line of high piano notes..." motion="w-kanade07-nod" facial="face_normal_01"
  cue se "se_pack00001/se00124" vol=0.8
  talk mafuyu "...Ah. That tight pressure in my chest just lifted." motion="w-normal07-tilthead" facial="face_smallmouth_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "Right—not forcing the door open, just pausing quietly in front of it for one beat." motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "'Whoa! Everything in my headphones just opened up, like a cool night breeze blew right through!'" se="se_pack00001_b/se00007_b" seVol=0.65
  talk kanade "Yes, this is the right direction (Resonance rose to {{resonance}})." motion="w-kanade07-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03b_sketch "Blue-Gray Dawn Sketch" {
  bg set "bg_e000303"
  bgm play "bgm00180" vol=0.72
  place set "Ena's Room - Drawing Tablet"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  cue se "se_pack00001_b/se00084_b" vol=0.75
  talk ena "I dropped the color rough I just painted into chat. It's still messy, so no nitpicking!" motion="w-normal01-tilthead" facial="face_trouble_02" react(mizuki motion="w-cute02-nod" facial="face_smile_01")
  talk mizuki "Ooh, Enanan! That pale ultramarine brushed into the deep gray shadow is gorgeous!" motion="w-normal01-nod" facial="face_smile_02"
  talk ena "W-really? Hearing you praise it like that is kinda embarrassing..." motion="w-cute01-tilthead" facial="face_smile_01"
  talk kanade "'...So that's the color. That blue-gray right before dawn—no sunlight yet, yet no longer pitch dark.'"
  talk ena "Exactly! If the bridge could seep in gently like this shade of blue-gray, it'd fit right into place." motion="w-cute02-nod" facial="face_smile_01"
} -> scene_04_pause

scene scene_03c_lyric "Whisper at the Door" {
  bg set "bg_e000102"
  bgm play "bgm00171" vol=0.72
  place set "Kanade's Room - Late Night"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  talk kanade "Mafuyu, what you said about 'standing before a closed door'... could you try writing that as two short lines?" motion="w-kanade07-tilthead" facial="face_smile_01"
  talk mafuyu "I'll try. ...Here, I typed it into the memo." motion="w-normal15-nod" facial="face_normal_01"
  stage move kanade to center dur=0.45 overlap motion="w-normal15-tilthead" facial="face_smile_01"
  stage move mafuyu to center dur=0.45 overlap motion="w-normal15-shy" facial="face_normal_01"
  narration "Leaning shoulder to shoulder toward the screen, warm steam from their teacup drifts softly through the monitor's glow."
  talk kanade "'Even before my fingertips reach the door, the wind has already slipped through the keyhole'... Mafuyu, that line is wonderful." motion="w-normal07-nod" facial="face_smile_01" react(mafuyu motion="w-normal15-tilthead" facial="face_smallmouth_01")
  talk mafuyu "...As long as it helps you, Kanade." motion="w-normal16-nod" facial="face_normal_01"
} -> scene_04_pause

scene scene_04_pause "Crossroads at 2:30 AM" {
  bg set "bg_e000102"
  bgm stop
  place set "Kanade's Room - 02:30 AM"
  transition fadeBlack 0.5
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at right facial="face_normal_01"
  ]

  telop "02:30 — Deep in the Quiet Night"
  talk mizuki "'Yaaawn... It's already two-thirty! K, are you pushing through to finish tonight, or calling it a night?'" se="se_pack00001_b/se00007_b" seVol=0.65
  talk ena "'If Mafuyu catches you pulling another all-nighter, we're all getting lectured tomorrow too.'"
  cue se "se_pack00001/se00091" vol=0.75
  narration "Just then, a faint white glow blooms across the phone on the desk as 'Untitled' flickers gently inside the playlist."
  talk mafuyu "...Kanade, your phone is glowing. And it's about time you decide." motion="w-normal16-tilthead" facial="face_normal_01" react(kanade motion="w-kanade07-tilthead" facial="face_smallmouth_01")
  talk kanade "Right... While this feeling is still clear in my mind, what should I do next?" motion="w-kanade16-tilthead" facial="face_sad_01"
} -> choice_02_late_night

choice choice_02_late_night "Before finishing the final mix, what should we do?" {
  opt_sekai: "Tap 'Untitled' while the spark is fresh and visit Empty SEKAI" [resonance += 2, entered_sekai = true] -> scene_05a_sekai
  opt_rest: "Take everyone's advice to rest and meet at the cafe tomorrow" [warmth += 2] -> scene_05b_cafe
}

scene scene_05a_sekai "Echoes of the Silent World" {
  bg set "bg_e000501"
  bgm play "bgm_area00005" vol=0.75
  place set "Empty SEKAI"
  transition fadeWhite 0.7
  cast set [
    kanade at left facial="face_normal_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_normal_01"
  ]

  cue se "se_pack00001/se00092" vol=0.8
  telop "Empty SEKAI"
  talk miku "Kanade, Mafuyu... you came." motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk kanade "Miku, I reworked a melody back in my room, and I felt like I had to check it here once more." motion="w-kanade07-tilthead" facial="face_smile_01"
  talk miku "Mm... I've been listening. Older songs felt like walking alone in the dark, but this part today..." motion="w-normal03-tilthead" facial="face_night_smallmouth_01"
  talk miku "Inside that single silent beat, you can hear someone else's footsteps drawing near." motion="w-normal01-tilthead" facial="face_night_smile_01" react(mafuyu motion="w-normal07-tilthead" facial="face_smallmouth_01") react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk mafuyu "The sound of someone else drawing near... So that's what it was." motion="w-normal15-nod" facial="face_normal_01"
  talk kanade "Thank you, Miku! Now I know exactly how that final note should land." motion="w-normal15-nod" facial="face_smile_01"
} -> scene_06_climax

scene scene_05b_cafe "Afternoon Sweetness on the Corner" {
  bg set "bg_a001401"
  bgm play "bgm00180" vol=0.74
  place set "Corner Cafe - Next Afternoon"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "Next Afternoon — Corner Cafe"
  talk mizuki "Ta-da! Limited strawberry parfait with double whipped cream—quick, Enanan, snap a photo!" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute02-nod" facial="face_smile_01")
  cue se "se_pack00001_b/se00075_b" vol=0.8
  talk ena "Wait a second, Mizuki, your finger's in the shot! ...Though the afternoon sun in here really does feel nice." motion="w-cool02-tilthead" facial="face_smile_01"
  talk mafuyu "Kanade, your hot cocoa is going to get cold if you don't drink it." motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "Mm... Listening to everyone banter after getting real sleep makes me feel the pre-chorus chords can be a little warmer." motion="w-normal15-tilthead" facial="face_smile_01"
  talk mizuki "Hehe, that's the magic of work-life balance! Tonight at 25:00, we'll be waiting for K's final mix!" motion="w-cool10-tilthead" facial="face_smile_06"
} -> scene_06_climax

scene scene_06_climax "Final Mix at 25:00" {
  bg set "bg_h000309"
  bgm play "bgm00171" vol=0.76
  place set "Nightcord - Next Night 25:00"
  transition fadeBlack 0.6
  cast set [
    kanade at farLeft facial="face_smile_01"
    mafuyu at left facial="face_normal_01"
    ena at right facial="face_smile_01"
    mizuki at farRight facial="face_smile_01"
  ]

  telop "Next Night 25:00 — Final Mix Playback"
  cue se "se_pack00001_b/se00183_b" vol=0.8
  talk kanade "Thanks for waiting, everyone. 'demo_final_25ji.wav' is uploaded now." motion="w-normal15-nod" facial="face_smile_01"
  cue se "se_pack00001/se00124" vol=0.85
  narration "Clear solo piano notes tap softly into the still night; after one tender beat of silence, the chorus blossoms like pale light."
  talk ena "...Yes! That suffocating wall before the door is completely gone—my head is already full of new compositions to draw!" motion="w-cute02-nod" facial="face_smile_01" react(mizuki motion="w-normal01-nod" facial="face_smile_02")
  talk mizuki "Mm-hmm! It keeps Nightcord's quiet depth, while adding a gentle warmth that makes you want to take a step forward!" motion="w-cute02-nod" facial="face_smile_01"
  talk mafuyu "...Yeah. Somewhere deep in my chest, it felt like something gently stirred." motion="w-normal15-nod" facial="face_normal_01" react(kanade motion="w-normal07-nod" facial="face_smile_01")
  talk kanade "Hearing you say that, Mafuyu... means this song has already found its answer." motion="w-kanade07-nod" facial="face_smile_01"
} -> cond_ending

condition cond_ending "Ending Route Check" {
  rule_sekai: if entered_sekai == true "Empty SEKAI Resonance" -> scene_07a_epilogue_sekai
  rule_warm: if warmth >= 3 "Everyday Warmth" -> scene_07b_epilogue_warm
  else -> scene_07c_epilogue_quiet
}

scene scene_07a_epilogue_sekai "A Song Across the Pale Expanse" {
  bg set "bg_e000501"
  bgm play "bgm00024" vol=0.74
  place set "Empty SEKAI - Lingering Echo"
  transition fadeWhite 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at center facial="face_normal_01"
    miku at right facial="face_night_smile_01"
  ]

  cue se "se_pack00001/se00091" vol=0.75
  talk miku "Do you hear it? The echo of this new song is still ringing far across SEKAI." motion="w-normal01-nod" facial="face_night_smile_01" react(kanade motion="w-normal15-nod" facial="face_smile_01")
  talk mafuyu "Yes... Even though there's still nothing here, this quietness feels reassuring now." motion="w-normal15-tilthead" facial="face_normal_01"
  talk kanade "As long as I can keep writing melodies like this, no matter how many nights pass, we'll always meet here." motion="w-kanade07-nod" facial="face_smile_01"
} -> end_sekai_dawn

scene scene_07b_epilogue_warm "Unfading Glow by the Headphones" {
  bg set "bg_e000403"
  bgm play "bgm00024" vol=0.74
  place set "Mizuki's Room - Midnight Editing"
  transition fadeBlack 0.5
  cast set [
    ena at left facial="face_smile_01"
    mizuki at right facial="face_smile_01"
  ]

  talk mizuki "All set! Layering Enanan's blue-gray dawn art onto the first chorus frame—perfection!" motion="w-normal01-nod" facial="face_smile_02" react(ena motion="w-cute01-tilthead" facial="face_smile_01")
  talk ena "Hmph, I'll admit your editing taste is spot-on this time. With Mafuyu's lyrics and K's music, this release won't lose to anyone!" motion="w-cute02-nod" facial="face_smile_01"
  talk mizuki "Hehe, for our wrap party next time, we're definitely getting strawberry parfaits again!" motion="w-cool10-tilthead" facial="face_smile_06"
} -> end_warm_chorus

scene scene_07c_epilogue_quiet "A Breath That Belongs to 25:00" {
  bg set "bg_e000101"
  bgm play "bgm00024" vol=0.72
  place set "Kanade's Room - First Light"
  transition fadeBlack 0.6
  cast set [
    kanade at left facial="face_smile_01"
    mafuyu at right facial="face_normal_01"
  ]

  narration "The first cool sliver of dawn slips between the curtains as the looping headphones come to rest on a final overtone."
  talk mafuyu "Kanade, morning's here. Get some real sleep today." motion="w-normal16-nod" facial="face_normal_01" react(kanade motion="w-normal15-shy" facial="face_smile_06")
  talk kanade "Mm... Good night, Mafuyu. See you tomorrow at 25:00." motion="w-normal15-nod" facial="face_smile_01"
} -> end_quiet_morning

end end_sekai_dawn "Ending A: Melody Through Pale Silence" subtitle="Found the unspoken echo inside Empty SEKAI (Resonance: {{resonance}} / Warmth: {{warmth}})"
end end_warm_chorus "Ending B: Warmth Shared by Four" subtitle="Everyday warmth became the chords of the chorus (Resonance: {{resonance}} / Warmth: {{warmth}})"
end end_quiet_morning "Ending C: Lingering Echo at Dawn" subtitle="Finished the new song in stillness and breath (Resonance: {{resonance}} / Warmth: {{warmth}})"`;
