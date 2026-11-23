# MoeSekai Story Studio Bilibili PV 配音脚本（首席发布会版 · 花里实乃理 / `pjsk_05_minori`）

- **叙事定位**：**首席发布会发布师（Apple Keynote 纯净功能讲解风）** — 零空洞营销废话，把**「许个愿，就能生成整幕剧情」**置于第 2 幕绝对主角位，逐幕讲透创作者最关心的真实功能。
- **配音引擎**：Fish Audio **Drama 3 INT4** (`fishaudio/drama-3-int4`) on **SGLang-Omni** (Google Colab **A100-40GB / A100-80GB** + 私有 HF Dataset `sm_80` JIT 缓存极速冷启)
- **配音角色**：花里みのり / 花里实乃理 (`pjsk_05_minori`, MORE MORE JUMP!)
- **语言方案**：**地道元气日语配音 (`ja-JP`) + 精校中文主字幕 / 纯净日文副字幕**
- **参考干声**：`pjsk_05_minori/v1/ref.wav`（44.1 kHz 单声道 16-bit PCM，15.981s，`-16.0 LUFS`，SHA-256 `20fc0c53bc82015d81e8dd6668a211a82914f577c6bf51a2e8b879b17303bda5`）
- **总计**：8 幕 / 16 句 / 466 日语朗读字符 / 预计总时长 **~85 秒内**（真实时长以 Colab 合成后的 `timings.json` 为准）
- **交付音频规格**：48 kHz 单声道 16-bit PCM 无损 WAV，经 `ffmpeg` 首尾静音裁剪 + `-16 LUFS / -1.5 dBTP` 响度归一化

---

## 表演与文本规范

1. **纯净功能表达**：严格围绕真实功能步骤展开（许愿 → AI 检索官方设定写 `.msk` → 自动校验与全分支推演 → 快照回滚 → Live2D 实时开演 → 节点画布 × `.msk` 双向同步 → 26 角色素材检视器 → 5 语校对与语音打包 → 导出前自动体检与全平台开源免费）。
2. **情绪舞台指示**：所有情绪/动作指示仅使用**英文方括号**内联在 `text_tts` 中（如 `[excited, bright smile]`、`[laughs softly]`），严禁混入中文括号。
3. **片假名读音对齐**：`text_tts` 中将英文缩写与数字展开为自然日语读音（`モエセカイ・ストーリースタジオ`、`エーアイ`、`ライブツーディー`、`エムエスケー`、`二十六人`、`五つの言語パック`、`ウィンドウズ`），`subtitle_ja` 保留标准拼写。

---

## 分幕台词与双语字幕表

### Scene 1 · `s01_hook` — 从一个脑洞开始（预计 7.72s）
> 画面提示：纯净浅色 Keynote 开场，直击「想把原创剧情搬上舞台，但抠立绘、对口型、剪时间轴太劝退」的真实门槛。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `01_hook_a` | `cheerful, curious, bright smile` | `[cheerful, curious, bright smile] みんなー！オリジナル物語、動かしてみたいよね？` | みんなー！オリジナル物語、動かしてみたいよね？ | 大家——！想把脑海里的原创剧情直接搬上舞台吗？ | 3.92s |
| `02_hook_b` | `lightly troubled, relatable sigh` | `[lightly troubled, relatable sigh] でも切り抜きや口パク編集って大変……` | でも切り抜きや口パク編集って大変…… | 可抠立绘、对口型、剪时间轴实在太劝退了…… | 3.10s |

### Scene 2 · `s02_wish_agent` — 核心主角：许个愿，就能生成整幕剧情！（预计 12.48s）
> 画面提示：纯白画布聚焦步骤条与实机 `06`/`07` 高清特写：输入一句愿望 → AI 检索官方设定 → 编写 `.msk` → 自动校验 `0 errors` 与全分支推演 → 快照一键回滚。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `03_wish_a` | `excited, bright smile` | `[excited, bright smile] モエセカイ・ストーリースタジオなら、願いを伝えるだけで脚本が完成！` | MoeSekai Story Studio なら、願いを伝えるだけで脚本が完成！ | 在 MoeSekai Story Studio，许个愿就能生成整幕剧情！ | 5.56s |
| `04_wish_b` | `earnest, lively, reassuring` | `[earnest, lively, reassuring] エーアイが公式設定を調べて分岐を検証、スナップショットでいつでも戻せるよ！` | AIが公式設定を調べて分岐を検証、スナップショットでいつでも戻せるよ！ | 内置 AI 检索官方设定、自动校验全分支，每一步快照随时回滚！ | 6.22s |

### Scene 3 · `s03_live2d` — 下一秒，Live2D 多角色舞台实时开演（预计 11.33s）
> 画面提示：实机 60fps 录屏 `clip-01`（5 角色同台）与 `clip-02`（天台三路选项分支跳转），演示剧本生成即刻运行。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `05_live2d_a` | `amazed, sparkling with excitement` | `[amazed, sparkling with excitement] 脚本はすぐ再生！ライブツーディーの仲間が衣装や表情つきで動くよ！` | 脚本はすぐ再生！Live2Dの仲間が衣装や表情つきで動くよ！ | 剧本生成即可运行，多位 Live2D 角色带动作表情与服装同台演绎！ | 5.40s |
| `06_live2d_b` | `happy, upbeat, inviting` | `[happy, upbeat, inviting] 立ち位置もカメラも確認できて、選択肢で別ルートもすぐ遊べるの！` | 立ち位置もカメラも確認できて、選択肢で別ルートもすぐ遊べるの！ | 站位与镜头实时呈现，内置分支播放器点击选项立刻体验不同走向！ | 5.23s |

### Scene 4 · `s04_flow_msk` — 可视化节点画布 × `.msk` 剧本实时双向同步（预计 11.00s）
> 画面提示：实机 `clip-03`（节点画布拖拽连线）与 `clip-04`（`.msk` 源码实时联动），展示可视化与文本双向即时同步。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `07_flow_a` | `bright, explaining clearly` | `[bright, explaining clearly] こだわりたいときは、ノードキャンバスで線をつないで分岐を整理！` | こだわりたいときは、ノードキャンバスで線をつないで分岐を整理！ | 想亲手精修？在可视化节点画布上拖拽连线梳理多结局分支！ | 5.40s |
| `08_msk_b` | `impressed, clear, upbeat` | `[impressed, clear, upbeat] エムエスケー画面とも双方向同期、直した瞬間にすぐ反映だよ！` | .msk テキスト画面とも双方向同期、直した瞬間にすぐ反映だよ！ | 与 .msk 纯文本视图实时双向同步，画布或代码修改即刻生效！ | 4.90s |

### Scene 5 · `s05_assets_cast` — 内置 26 角色素材与演出检视器（预计 10.67s）
> 画面提示：实机 `08`（角色演出检视器）与 `09`（26 角色服装/动作/背景选择器）高清展示，直接点选编排演出与 BGM。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `09_assets_a` | `cheerful, proud, enthusiastic` | `[cheerful, proud, enthusiastic] 二十六人の衣装・動き・背景を収録、素材探しはいらないよ！` | 26人の衣装・モーション・背景を収録、素材探しはいらないよ！ | 内置 26 位角色服装、动作、表情与舞台背景，不用手动找图抠图！ | 4.74s |
| `10_assets_b` | `warm, focused, friendly` | `[warm, focused, friendly] インスペクターで選ぶだけで、セリフごとの演技や曲も組めるんだ！` | インスペクターで選ぶだけで、セリフごとの演技やBGMも組めるんだ！ | 在演出检视器中直接点选，轻松为每句对白编排专属表演与 BGM！ | 5.23s |

### Scene 6 · `s06_i18n_voice` — 多语言字幕校对与自定义配音打包（预计 10.01s）
> 画面提示：实机 `10`/`11`（5 语言本地化双语校对与日文播放）与 `12`（自定义配音/TTS 清单自动匹配与打包器）。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `11_i18n_a` | `warm, upbeat, clear` | `[warm, upbeat, clear] 五つの言語パック対応、字幕の対訳校閲も一画面で完結！` | 5言語パック対応、字幕の対訳校閲も1画面で完結！ | 内置 5 语言本地化双语校对界面，同一视图完成多语字幕校对！ | 4.41s |
| `12_voice_b` | `cheerful, excited` | `[cheerful, excited] ボイスや音声リストを入れれば、自動対応して一括パッケージ！` | ボイスやTTS音声リストを入れれば、自動対応して一括パッケージ！ | 导入自有配音或 TTS 语音清单，自动匹配对白并一键打包完整作品！ | 4.90s |

### Scene 7 · `s07_preflight_open` — 导出前自动体检零报错，全平台开源免费（预计 10.83s）
> 画面提示：实机 `13` 导出预检对话框（`0 errors, 0 warnings`）与 `01`/`16` 桌面全貌，展示与 `pjsk.moe` 网页端互通及 Win/Mac/Linux MPL-2.0 开源免费。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `13_preflight_a` | `reassuring, clear, helpful` | `[reassuring, clear, helpful] 書き出し前に素材抜けや分岐エラーを自動検査して安全に出力！` | 書き出し前に素材抜けや分岐エラーを自動検査して出力！ | 导出前自动排查缺失素材与断链分支，一键导出 .msk 或独立资源包！ | 4.90s |
| `14_open_b` | `bright, warm, generous` | `[bright, warm, generous] ウェブ版とも互換、ウィンドウズもマックも無料のオープンソース！` | pjsk.moe Web版互換！Windows・macOS・Linux 対応の無料オープンソース！ | 与 pjsk.moe 网页端互通，全平台覆盖且 MPL-2.0 开源免费！ | 5.23s |

### Scene 8 · `s08_cta` — 前往 `story.pjsk.moe` 开始创作 + 一键三连（预计 10.96s）
> 画面提示：纯白 Keynote 终幕：`story.pjsk.moe` 网址主视觉 + B 站标志性点赞投币收藏三连动效收尾。

| ID | 情绪标签 | 日语朗读文本 (`text_tts`) | 日文副字幕 (`subtitle_ja`) | 中文主字幕 (`subtitle_zh`) | 预计时长 |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `15_cta_a` | `enthusiastic, warm, inviting` | `[enthusiastic, warm, inviting] さあ公式サイトから体験して、あなたの願いを本物のステージに！` | さあ story.pjsk.moe から体験して、あなたの願いを本物のステージに！ | 前往 story.pjsk.moe 下载体验，把你的愿望变成真实的舞台！ | 5.07s |
| `16_cta_b` | `joyful, sparkling idol energy, laughs softly` | `[joyful, sparkling idol energy] よかったら、[laughs softly] いいね、コイン、お気に入りの三連もお願いね！` | よかったら、いいね・コイン・お気に入りの三連もお願いね！ | 喜欢的话别忘了点赞、投币、收藏一键三连支持我们！ | 4.74s |
