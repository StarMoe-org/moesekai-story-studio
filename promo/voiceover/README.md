# MoeSekai Story Studio Bilibili PV — `mnr` Drama 3 配音生产套件

本目录包含面向 **Bilibili 宣传片（8 幕 / 16 句，约 78 秒）** 的花里实乃理（花里みのり / `pjsk_05_minori`）**Fish Audio Drama 3 INT4** 配音脚本、一键 Google Colab A100 推理 Notebook、本地安全解包与视频自动合成脚本，以及清晰隔离的临时节奏预览轨。

---

## 目录结构

| 路径 | 用途 |
| :--- | :--- |
| `script.json` | 机器可读的 8 幕 / 16 句主脚本与双语字幕合同（`text_tts`、`subtitle_ja`、`subtitle_zh`、A/B 对比样本、Drama 3 API 约束） |
| `script.md` | 导演向双语配音脚本、发音与情绪舞台指示规范 |
| `mnr_drama3_colab.ipynb` | **1-Click Google Colab A100 Notebook**（完整复刻 `moesekai-tts` 实测 Colab 2026 五大避坑方案） |
| `unpack_colab_voice.py` | 解包 `mnr_voiceover_pack.zip`、校验 Zip Slip / SHA-256 / PCM WAV、生成精确 `timings.json` 并可选自动触发视频最终合成 |
| `audio/` | **仅存放正式 Drama 3 `mnr` 无损 WAV**（运行 Colab 并解包后自动填充 `01_hook_a.wav`..`16_cta_b.wav`） |
| `guide_audio/` & `timings.estimated.json` | **仅作视频节奏预览用的临时提示音轨**（明确标记 `is_real_mnr_tts: false`，绝不冒充正式配音） |
| `generate_guide_audio.py` | 临时节奏预览音轨生成脚本 |

---

## 一键生成正式 `mnr` 配音步骤（Google Colab A100）

### 1. 打开 Notebook 并选择 A100 GPU
1. 将 `promo/voiceover/mnr_drama3_colab.ipynb` 上传到 [Google Colab](https://colab.research.google.com/)。
2. 点击顶部菜单：**代码执行程序 → 更改运行时类型 → 选择 `A100 GPU`（A100-40GB 或 A100-80GB）**。
   > `fishaudio/drama-3-int4` 显存硬底线为 **`>= 32 GiB`**，L4 (24GB) 与 T4 (16GB) 必 OOM，Notebook 第一格会自动拦截以防空烧 CCU。

### 2. 自动恢复 `sm_80` JIT 缓存与加载花里实乃理参考干声 (`pjsk_05_minori/v1/ref.wav`)
- **Step 2 (`JIT_CACHE_SOURCE = "hf"`)**：默认自动从私有 HF Dataset `exmeaning/moesekai-pjsk-tts-voices` 拉取并校验已归档的 `jit-cache/sglang-0.5.23-cu130-sm80.tar.gz`（16.34 MiB，SHA-256 `2a77f6f7...`，80 SGLang + 546 Triton 核），将 A100 冷启动从 ~24 分钟压缩至 **~5.5 分钟**（留空 Token 或选 `"none"` 可平滑回退冷编译；同时也支持 H100 `sm_90a` / Pro 6000 `sm_120f` 自动匹配 FlashInfer AOT 轮子）。
- **Step 4** 参考干声支持三选一（**严禁在 Notebook 中硬编码任何 Token**）：
  - **`upload`（最便捷）**：直接选择本机已整理好的干声：
    `<moesekai-tts>/.local_voices_out/voices/pjsk_05_minori/v1/ref.wav`
  - **`drive`**：挂载 Google Drive 读取已上传的 `ref.wav`。
  - **`hf`**：复用 Step 2 的 Colab Secrets `HF_TOKEN` 或运行时密文输入，从私有 HF Dataset `exmeaning/moesekai-pjsk-tts-voices` 拉取 `voices/pjsk_05_minori/v1/ref.wav`。

Notebook 会自动校验参考音 SHA-256（`20fc0c53bc82015d81e8dd6668a211a82914f577c6bf51a2e8b879b17303bda5`）。

### 3. 试听抽卡与下载配音包
- （可选）勾选 Step 7 `RUN_AB_COMPARISON = True` 可直接试听 3 句 **日语原生 vs 中文跨语种** A/B 对比。
- 运行 Step 8 批量合成全部 16 句（默认每句抽卡 2 个 Take，经 `ffmpeg` 首尾静音裁剪 + `-16 LUFS` 归一化为 **48 kHz 单声道 16-bit PCM 无损 WAV**）。
- 在 Step 9 逐句试听并按需填写 `MANUAL_TAKE_OVERRIDES` 选片。
- 运行 Step 10 自动生成精确 `timings.json` 并触发浏览器下载 **`mnr_voiceover_pack.zip`**（可顺便勾选保存 `sm_80` JIT 缓存到 Drive，后续重跑秒热启动）。
- 确认下载完成后运行 Step 11 停止服务并释放 A100 运行时。

### 4. 一键解包并合成最终 B 站宣传片
回到本机仓库根目录运行：
```bash
python promo/voiceover/unpack_colab_voice.py --zip path/to/mnr_voiceover_pack.zip --render
```
脚本将自动：
1. 防御 Zip Slip 并校验 `pack_manifest.json` 的 SHA-256；
2. 将 16 句无损 WAV 解包至 `promo/voiceover/audio/`；
3. 生成精确对齐实测时长的 `promo/voiceover/timings.json`；
4. 调用 `promo/video/render_final.py` 按真实 `mnr` 配音时长重新同步字幕、镜头、BGM 闪避，输出最终 `promo/video/out/moesekai-story-studio-pv.mp4`。

---

## 技术参考依据

本生产套件的 Colab 环境配置、下载防 429 方案、`sgl-omni serve` 显存/CUDA Graph 参数、`/v1/audio/speech` 严格 Schema 及 `pjsk_05_minori` 干声元数据，均严格对齐本机只读参考仓库 `moesekai-tts`：
- `worker/model_loader.py`（Python 3.12 `uv venv`、`protobuf>=6.31.1,<7.0.0`、FlashInfer `0.7.2+cu130` shim + `sm_80` AOT 轮子、`HF_HUB_DISABLE_XET=1` + 19 文件白名单 + `curl` LFS 回退）
- `worker/engine.py` & `worker/gpu.py`（A100-80GB `0.62/0.20` 与 A100-40GB `0.55/0.15 + 3GiB` 档位、禁用冷启动 CUDA Graph、严格 6 字段 `/v1/audio/speech` 请求体）
- `worker/audio.py`（`silenceremove` + `-16 LUFS` 滤波链，PV 场景改输出 48 kHz 无损 PCM WAV 而非 40k Opus）
- `.local_voices_out/voices/pjsk_05_minori/v1/meta.json`（花里实乃理 15.981s strict 级官方日服干声）
