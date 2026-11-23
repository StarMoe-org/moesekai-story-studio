/* ==========================================================================
   MoeSekai Story Studio — Pure Apple Minimalist ("果味") 1080p60 Engine
   Zero top navbar, zero PPT cards, zero subtitle box, smooth black pill tabs.
   ========================================================================== */

(() => {
  const WISH_TEXT = '写一段花里实乃理和伙伴在天台排练安可曲的剧情';

  const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
  const lerp = (a, b, t) => a + (b - a) * t;
  const invLerp = (a, b, v) => clamp((v - a) / (b - a || 1e-6), 0, 1);
  const easeOutCubic = (x) => 1 - Math.pow(1 - clamp(x), 3);
  const easeOutQuart = (x) => 1 - Math.pow(1 - clamp(x), 4);
  const easeInOutCubic = (x) => {
    const t = clamp(x);
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  };
  const easeOutBack = (x, s = 1.2) => {
    const t = clamp(x) - 1;
    return 1 + (s + 1) * t * t * t + s * t * t;
  };

  const SLOT_TO_IMG = {
    agent:       'img-agent',
    snapshots:   'img-snapshots',
    live2d_clip: 'img-live2d-clip',
    branch_clip: 'img-branch-clip',
    flow_clip:   'img-flow-clip',
    msk_clip:    'img-msk-clip',
    picker:      'img-picker',
    inspector:   'img-inspector',
    i18n:        'img-i18n',
    ja_play:     'img-ja-play',
    voice:       'img-voice',
    export:      'img-export',
    light_hero:  'img-light-hero',
    dark_hero:   'img-dark-hero',
  };

  const currentSrcMap = {};

  async function setImgSrcSync(imgEl, url) {
    if (!imgEl || !url) return;
    if (currentSrcMap[imgEl.id] === url) return;
    currentSrcMap[imgEl.id] = url;
    imgEl.src = url;
    imgEl.style.display = 'block';
    try {
      if (typeof imgEl.decode === 'function') {
        await imgEl.decode();
      } else if (!imgEl.complete) {
        await new Promise((res) => { imgEl.onload = res; imgEl.onerror = res; });
      }
    } catch {}
  }

  async function updateMediaSlot(slotName, clipLocalT, assets) {
    const spec = assets && assets[slotName];
    const imgId = SLOT_TO_IMG[slotName];
    if (!spec || !imgId) return;
    const imgEl = document.getElementById(imgId);
    if (!imgEl) return;

    if (spec.type === 'clip' && spec.frameCount > 0) {
      const fps = spec.fps || 30;
      const idx = Math.floor(Math.max(0, clipLocalT) * fps) % spec.frameCount;
      const num = String(idx + 1).padStart(5, '0');
      await setImgSrcSync(imgEl, `${spec.baseUrl}/${num}.jpg`);
    } else if (spec.url) {
      await setImgSrcSync(imgEl, spec.url);
    }
  }

  function setSlider(sliderId, tabIds, posFloat) {
    const slider = document.getElementById(sliderId);
    if (slider) {
      slider.style.transform = `translateX(${(posFloat * 168).toFixed(2)}px)`;
    }
    const activeIdx = Math.round(posFloat);
    tabIds.forEach((id, idx) => {
      const el = document.getElementById(id);
      if (el) el.classList.toggle('active', idx === activeIdx);
    });
  }

  async function animateScene(sceneId, localT, dur, assets) {
    const p = clamp(localT / (dur || 1));

    // =========================================================================
    // ACT 1: s01_hook — Monumental Pure White Apple Typography (Zero Cards)
    // =========================================================================
    if (sceneId === 's01_hook') {
      const pa = document.getElementById('s1-pa');
      const pb = document.getElementById('s1-pb');
      const br = document.getElementById('s1-brand');

      const split1 = dur * 0.54;
      const split2 = Math.max(split1 + 2.2, dur - 1.35);

      const aIn = easeOutQuart(invLerp(0.08, 0.72, localT));
      const aOut = 1 - easeInOutCubic(invLerp(split1 - 0.35, split1 + 0.10, localT));
      pa.style.opacity = Math.min(aIn, aOut);
      pa.style.transform = `translateY(${lerp(24, 0, aIn) - lerp(0, 14, 1 - aOut)}px)`;

      const bIn = easeOutQuart(invLerp(split1 + 0.05, split1 + 0.65, localT));
      const bOut = 1 - easeInOutCubic(invLerp(split2 - 0.30, split2 + 0.12, localT));
      pb.style.opacity = Math.min(bIn, bOut);
      pb.style.transform = `translateY(${lerp(22, 0, bIn) - lerp(0, 14, 1 - bOut)}px)`;

      const brIn = easeOutQuart(invLerp(split2 + 0.05, split2 + 0.65, localT));
      br.style.opacity = brIn;
      br.style.transform = `scale(${lerp(0.92, 1.0, brIn)})`;
    }

    // =========================================================================
    // ACT 2: s02_wish_agent — Wish Pill -> Giant Borderless 06 -> 07 + Black Tab
    // =========================================================================
    else if (sceneId === 's02_wish_agent') {
      await updateMediaSlot('agent', localT, assets);
      await updateMediaSlot('snapshots', localT, assets);

      const hl = document.getElementById('s2-hl');
      const wishWrap = document.getElementById('s2-wish-wrap');
      const wishBar = document.getElementById('s2-wish-bar');
      const wishText = document.getElementById('s2-wish-text');
      const blueBtn = document.getElementById('s2-blue-btn');
      const media = document.getElementById('s2-media');
      const dock = document.getElementById('s2-dock');
      const imgAg = document.getElementById('img-agent');
      const imgSn = document.getElementById('img-snapshots');

      const hlIn = easeOutCubic(invLerp(0.0, 0.50, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const introEnd = Math.min(4.75, dur * 0.40);
      if (localT < introEnd + 0.55) {
        const fade = 1 - easeInOutCubic(invLerp(introEnd - 0.15, introEnd + 0.38, localT));
        wishWrap.style.display = 'flex';
        wishWrap.style.opacity = fade;
        const barIn = easeOutQuart(invLerp(0.12, 0.68, localT));
        wishBar.style.transform = `translateY(${lerp(22, 0, barIn)}px) scale(${lerp(0.96, 1.0, fade)})`;

        const chars = Math.floor(invLerp(0.40, introEnd - 0.85, localT) * WISH_TEXT.length);
        const typed = WISH_TEXT.slice(0, chars);
        const caret = chars < WISH_TEXT.length || Math.floor(localT * 4) % 2 === 0;
        wishText.innerHTML = `${typed}${caret ? '<span class="s2-caret"></span>' : ''}`;

        const clickP = invLerp(introEnd - 0.55, introEnd - 0.25, localT);
        const clickSc = clickP > 0 && clickP < 1 ? 1 - 0.06 * Math.sin(clickP * Math.PI) : 1;
        blueBtn.style.transform = `scale(${clickSc})`;
      } else {
        wishWrap.style.display = 'none';
      }

      const stageIn = easeOutQuart(invLerp(introEnd + 0.05, introEnd + 0.68, localT));
      media.style.opacity = stageIn;
      media.style.transform = `translateY(${lerp(20, 0, stageIn)}px) scale(${lerp(0.975, 1.0, stageIn)})`;
      dock.style.opacity = stageIn;

      const demoP = invLerp(introEnd, dur, localT);
      const snapMix = easeInOutCubic(invLerp(0.56, 0.66, demoP));
      const z = lerp(1.0, 1.04, demoP);
      if (imgAg) imgAg.style.transform = `scale(${z})`;
      if (imgSn) {
        imgSn.style.opacity = snapMix;
        imgSn.style.transform = `scale(${z})`;
      }
      setSlider('s2-slider', ['s2-t0', 's2-t1'], snapMix);
    }

    // =========================================================================
    // ACT 3: s03_live2d — Giant 80% Borderless clip-01 -> clip-02
    // =========================================================================
    else if (sceneId === 's03_live2d') {
      const sw = dur * 0.50;
      await updateMediaSlot('live2d_clip', localT, assets);
      await updateMediaSlot('branch_clip', Math.max(0, localT - sw + 0.15), assets);

      const hl = document.getElementById('s3-hl');
      const media = document.getElementById('s3-media');
      const img1 = document.getElementById('img-live2d-clip');
      const img2 = document.getElementById('img-branch-clip');

      const hlIn = easeOutCubic(invLerp(0.0, 0.48, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const mIn = easeOutQuart(invLerp(0.10, 0.68, localT));
      media.style.opacity = mIn;
      media.style.transform = `translateY(${lerp(22, 0, mIn)}px) scale(${lerp(0.975, 1.0, mIn)})`;

      const mix = easeInOutCubic(invLerp(sw - 0.22, sw + 0.26, localT));
      if (img1) img1.style.transform = `scale(${lerp(1.0, 1.025, p)})`;
      if (img2) {
        img2.style.opacity = mix;
        img2.style.transform = `scale(${lerp(1.0, 1.025, invLerp(sw, dur, localT))})`;
      }
    }

    // =========================================================================
    // ACT 4: s04_flow_msk — Giant clip-03 -> clip-04 + Apple Black Sliding Pill
    // =========================================================================
    else if (sceneId === 's04_flow_msk') {
      const sw = dur * 0.48;
      await updateMediaSlot('flow_clip', localT, assets);
      await updateMediaSlot('msk_clip', Math.max(0, localT - sw + 0.15), assets);

      const hl = document.getElementById('s4-hl');
      const media = document.getElementById('s4-media');
      const dock = document.getElementById('s4-dock');
      const img1 = document.getElementById('img-flow-clip');
      const img2 = document.getElementById('img-msk-clip');

      const hlIn = easeOutCubic(invLerp(0.0, 0.48, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const mIn = easeOutQuart(invLerp(0.10, 0.68, localT));
      media.style.opacity = mIn;
      media.style.transform = `translateY(${lerp(22, 0, mIn)}px) scale(${lerp(0.975, 1.0, mIn)})`;
      dock.style.opacity = mIn;

      const mix = easeInOutCubic(invLerp(sw - 0.20, sw + 0.24, localT));
      if (img1) img1.style.transform = `scale(${lerp(1.0, 1.025, invLerp(0, sw, localT))})`;
      if (img2) {
        img2.style.opacity = mix;
        img2.style.transform = `scale(${lerp(1.0, 1.025, invLerp(sw, dur, localT))})`;
      }
      setSlider('s4-slider', ['s4-t0', 's4-t1'], mix);
    }

    // =========================================================================
    // ACT 5: s05_assets_cast — Giant Borderless 09 -> 08 Slow Push
    // =========================================================================
    else if (sceneId === 's05_assets_cast') {
      await updateMediaSlot('picker', localT, assets);
      await updateMediaSlot('inspector', localT, assets);

      const hl = document.getElementById('s5-hl');
      const media = document.getElementById('s5-media');
      const img1 = document.getElementById('img-picker');
      const img2 = document.getElementById('img-inspector');

      const hlIn = easeOutCubic(invLerp(0.0, 0.48, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const mIn = easeOutQuart(invLerp(0.10, 0.68, localT));
      media.style.opacity = mIn;
      media.style.transform = `translateY(${lerp(22, 0, mIn)}px) scale(${lerp(0.975, 1.0, mIn)})`;

      const mix = easeInOutCubic(invLerp(dur * 0.48, dur * 0.56, localT));
      const sc = lerp(1.0, 1.045, p);
      if (img1) img1.style.transform = `scale(${sc})`;
      if (img2) {
        img2.style.opacity = mix;
        img2.style.transform = `scale(${sc})`;
      }
    }

    // =========================================================================
    // ACT 6: s06_i18n_voice — Clean Borderless 10 -> 11 -> 12 + Apple Black Pill
    // =========================================================================
    else if (sceneId === 's06_i18n_voice') {
      await updateMediaSlot('i18n', localT, assets);
      await updateMediaSlot('ja_play', localT, assets);
      await updateMediaSlot('voice', localT, assets);

      const hl = document.getElementById('s6-hl');
      const media = document.getElementById('s6-media');
      const dock = document.getElementById('s6-dock');
      const img1 = document.getElementById('img-i18n');
      const img2 = document.getElementById('img-ja-play');
      const img3 = document.getElementById('img-voice');

      const hlIn = easeOutCubic(invLerp(0.0, 0.48, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const mIn = easeOutQuart(invLerp(0.10, 0.68, localT));
      media.style.opacity = mIn;
      media.style.transform = `translateY(${lerp(22, 0, mIn)}px) scale(${lerp(0.975, 1.0, mIn)})`;
      dock.style.opacity = mIn;

      const mix12 = easeInOutCubic(invLerp(dur * 0.30, dur * 0.37, localT));
      const mix23 = easeInOutCubic(invLerp(dur * 0.54, dur * 0.61, localT));
      const sc = lerp(1.0, 1.03, p);
      if (img1) img1.style.transform = `scale(${sc})`;
      if (img2) {
        img2.style.opacity = mix12 * (1 - mix23);
        img2.style.transform = `scale(${sc})`;
      }
      if (img3) {
        img3.style.opacity = mix23;
        img3.style.transform = `scale(${sc})`;
      }
      setSlider('s6-slider', ['s6-t0', 's6-t1', 's6-t2'], mix12 + mix23);
    }

    // =========================================================================
    // ACT 7: s07_preflight_open — 13 -> Light/Dark Split + Monochrome OS SVGs
    // =========================================================================
    else if (sceneId === 's07_preflight_open') {
      await updateMediaSlot('export', localT, assets);
      await updateMediaSlot('light_hero', localT, assets);
      await updateMediaSlot('dark_hero', localT, assets);

      const hl = document.getElementById('s7-hl');
      const media = document.getElementById('s7-media');
      const split = document.getElementById('s7-split');
      const mask = document.getElementById('s7-dark-mask');
      const bar = document.getElementById('s7-split-bar');
      const osDock = document.getElementById('s7-os-dock');

      const hlIn = easeOutCubic(invLerp(0.0, 0.48, localT));
      hl.style.opacity = hlIn;
      hl.style.transform = `translateY(${lerp(16, 0, hlIn)}px)`;

      const mIn = easeOutQuart(invLerp(0.10, 0.68, localT));
      media.style.opacity = mIn;
      media.style.transform = `translateY(${lerp(22, 0, mIn)}px) scale(${lerp(0.975, 1.0, mIn)})`;
      osDock.style.opacity = mIn;

      const splitMix = easeInOutCubic(invLerp(dur * 0.50, dur * 0.58, localT));
      split.style.opacity = splitMix;

      const pct = lerp(68, 36, easeInOutCubic(invLerp(dur * 0.54, dur * 0.94, localT)));
      mask.style.clipPath = `inset(0 0 0 ${pct.toFixed(2)}%)`;
      bar.style.left = `${pct.toFixed(2)}%`;
    }

    // =========================================================================
    // ACT 8: s08_cta — Pure White Apple Closing + Minimal Triad
    // =========================================================================
    else if (sceneId === 's08_cta') {
      const logo = document.getElementById('s8-logo');
      const title = document.getElementById('s8-title');
      const url = document.getElementById('s8-url');

      const lIn = easeOutBack(invLerp(0.06, 0.62, localT), 1.15);
      logo.style.opacity = clamp(invLerp(0.06, 0.38, localT));
      logo.style.transform = `scale(${lerp(0.86, 1.0, lIn)})`;

      const tIn = easeOutCubic(invLerp(0.18, 0.68, localT));
      title.style.opacity = tIn;
      title.style.transform = `translateY(${lerp(16, 0, tIn)}px)`;

      const uIn = easeOutQuart(invLerp(0.36, 0.92, localT));
      url.style.opacity = uIn;
      url.style.transform = `translateY(${lerp(18, 0, uIn)}px) scale(${lerp(0.95, 1.0, uIn)})`;

      const triadStart = Math.max(2.0, dur - 5.1);
      const triads = [
        { id: 'triad-like', cls: 'lit-like', start: triadStart },
        { id: 'triad-coin', cls: 'lit-coin', start: triadStart + 0.42 },
        { id: 'triad-fav',  cls: 'lit-fav',  start: triadStart + 0.84 },
      ];
      for (const tr of triads) {
        const el = document.getElementById(tr.id);
        const baseIn = easeOutCubic(invLerp(0.75, 1.30, localT));
        const lit = localT >= tr.start;
        const pop = lit ? easeOutBack(invLerp(tr.start, tr.start + 0.34, localT), 1.45) : 0;
        const sc = lit ? lerp(1.0, 1.06, pop) : lerp(0.96, 1.0, baseIn);
        el.classList.toggle(tr.cls, lit);
        el.style.opacity = baseIn;
        el.style.transform = `translateY(${lerp(14, lit ? -3 : 0, lit ? pop : baseIn)}px) scale(${sc})`;
      }
    }
  }

  function updateTransition(t, scenes) {
    const veil = document.getElementById('transition-veil');
    let maxAlpha = 0;
    for (let i = 1; i < scenes.length; i++) {
      const dt = Math.abs(t - scenes[i].start);
      if (dt < 0.22) {
        const a = Math.cos((dt / 0.22) * (Math.PI / 2));
        maxAlpha = Math.max(maxAlpha, a * a * 0.88);
      }
    }
    veil.style.opacity = maxAlpha.toFixed(4);
  }

  // Pure Naked Apple Subtitles (Zero box, zero speaker pill)
  function updateSubtitles(t, subtitles) {
    const layer = document.getElementById('subtitle-layer');
    const zhEl = document.getElementById('sub-zh');
    const jaEl = document.getElementById('sub-ja');

    let cur = null;
    for (const s of subtitles || []) {
      if (t >= s.start && t <= s.end) {
        cur = s;
        break;
      }
    }
    if (!cur) {
      layer.style.opacity = 0;
      return;
    }
    const fadeIn = easeOutCubic(invLerp(cur.start, cur.start + 0.14, t));
    const fadeOut = 1 - easeOutCubic(invLerp(cur.end - 0.14, cur.end, t));
    layer.style.opacity = Math.min(fadeIn, fadeOut);
    layer.style.transform = `translateY(${lerp(6, 0, fadeIn)}px)`;

    zhEl.textContent = cur.subtitle_zh || '';
    if (cur.subtitle_ja) {
      jaEl.textContent = cur.subtitle_ja;
      jaEl.style.display = 'block';
    } else {
      jaEl.style.display = 'none';
    }
  }

  window.setTimeline = function (timeline) {
    window.__TIMELINE__ = timeline;
  };

  window.renderFrame = async function (frameIndex, fps) {
    const tl = window.__TIMELINE__;
    if (!tl) return;
    const t = frameIndex / fps;
    const scenes = tl.scenes || [];
    let curScene = scenes[scenes.length - 1];
    for (const sc of scenes) {
      if (t >= sc.start && t < sc.end) {
        curScene = sc;
        break;
      }
    }
    if (!curScene) return;

    document.querySelectorAll('.scene').forEach((el) => {
      el.classList.toggle('active', el.id === `scene-${curScene.id}`);
    });

    const localT = Math.max(0, t - curScene.start);
    const sceneDur = Math.max(0.1, curScene.end - curScene.start);

    await animateScene(curScene.id, localT, sceneDur, tl.assets || {});
    updateSubtitles(t, tl.subtitles || []);
    updateTransition(t, scenes);
  };
})();
