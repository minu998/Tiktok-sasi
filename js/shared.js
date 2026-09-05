/* ═══════════════════════════════════════════════════════════════
   RTXFury Method — shared.js · all pages
   Talks to the local API (/api/*). Falls back to demo data when the
   server is unreachable (e.g. standalone files opened directly).
   Analytics = TikTok Analyzer (same tools/shapes as Zilem):
   Check / Best Time / Hashtags / Recap / Compare / Tag.
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  /* ── helpers ───────────────────────────────────────────────── */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));
  const fmt = (n) => { const v = Number(n); return Number.isFinite(v) ? v.toLocaleString("en-US") : "0"; };
  const el = (tag, cls, html) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (html != null) n.innerHTML = html;
    return n;
  };
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  /* Display labels: member → Free (now Premium), booster → Booster, donor → Premium.
     Tier KEYS stay member/booster/donor everywhere (API, data-tier attrs). */
  const TIER_MAP = { member: ["Premium (Free)", 0, "4K120", 121], booster: ["Booster", 200, "4K60", 60], donor: ["Premium", 0, "4K120", 121] };
  /* Daily upload limits (display only — enforcement lives on the server):
     member = unlimited (was 3/day), booster = 5/day, donor = unlimited. */
  const PATCH_LIMIT = { member: null, booster: 5, donor: null };
  /* Client-side tier caps for the scan health check — NOW member gets the SAME caps as donor (4K120). */
  const TIER_RES = {
    member:  { resLong: 3840, resShort: 2160, maxFPS: 120 },
    booster: { resLong: 3840, resShort: 2160, maxFPS: 60, hiFPS: 120, hiResLong: 1920, hiResShort: 1080 },
    donor:   { resLong: 3840, resShort: 2160, maxFPS: 120 },
  };
  /* Accept both the local server shape ({user, admin}) and the Vercel/discord.ts
     shape ({logged_in, tier, limit_mb, display_name, avatar_url}). */
  function normalizeMe(j) {
    if (!j) return { user: null, admin: false };
    if (j.user) {
      // Local-server shape ({user, admin}). tier may be a string (e.g. "member"),
      // an object, or null depending on the backend — normalise it so every
      // downstream read of user.tier.* is safe.
      const raw = j.user;
      let t = raw.tier;
      if (typeof t === "string") { const m = TIER_MAP[t] || TIER_MAP.member; t = { tier: t, tierLabel: m[0], tierMB: m[1], tierRes: m[2], tierFPS: m[3] }; }
      if (!t || typeof t !== "object") { const m = TIER_MAP.member; t = { tier: "member", tierLabel: m[0], tierMB: m[1], tierRes: m[2], tierFPS: m[3] }; }
      return { user: { username: raw.username || raw.display_name || "USER", display_name: raw.display_name, avatar: raw.avatar_url || raw.avatar || null, tier: t }, admin: !!j.admin };
    }
    if (!j.logged_in) return { user: null, admin: false };
    const t = j.tier || "member";
    const [label, mb, res, fps] = TIER_MAP[t] || TIER_MAP.member;
    return { user: { username: j.username || j.display_name || "USER", display_name: j.display_name, avatar: j.avatar_url || j.avatar || null, tier: { tier: t, tierLabel: label, tierMB: mb, tierRes: res, tierFPS: fps } }, admin: false };
  }


  /* Session-persistent cache: page switches re-run /api/stats and /api/health,
     so we cache the last good response and render instantly instead of
     showing a logged-out/loading state while waiting. /api/me is deliberately
     NOT cached — it's auth state, and a stale "logged out" cache entry would
     survive the OAuth round-trip (sessionStorage persists across navigation)
     and keep the UI logged out after a successful login. */
  const GET_CACHE = { "/api/stats": 60e3, "/api/health": 120e3 };
  function cacheRead(k) {
    try {
      const raw = sessionStorage.getItem("rtxcache:" + k);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch { return null; }
  }
  function cacheHit(k) {
    const e = cacheRead(k);
    return e && (Date.now() - e.t < GET_CACHE[k]) ? e.v : null;
  }
  function cacheStale(k) {
    const e = cacheRead(k);
    return e ? e.v : null;
  }
  function cacheWrite(k, v) {
    try { sessionStorage.setItem("rtxcache:" + k, JSON.stringify({ t: Date.now(), v })); } catch {}
  }

  async function api(path, opts) {
    const method = (opts && opts.method) || "GET";
    const cacheable = method === "GET" && !(opts && opts.cache === "no-store") && GET_CACHE[path];
    if (cacheable) { const hit = cacheHit(path); if (hit) return hit; }
    try {
      const r = await fetch(path, opts);
      const ct = r.headers.get("content-type") || "";
      if (ct.includes("json")) {
        const out = { ok: r.ok, status: r.status, json: await r.json() };
        if (cacheable && out.ok && out.json) cacheWrite(path, out);
        return out;
      }
      const out = { ok: r.ok, status: r.status, blob: await r.blob(), headers: r.headers };
      if (cacheable && out.ok) cacheWrite(path, out);
      return out;
    } catch (e) {
      // server unreachable / file:// — fall back to stale cache if we have one
      if (cacheable) { const stale = cacheStale(path); if (stale) return stale; }
      return null;
    }
  }

  /* ── shared UI ──────────────────────────────────────────────── */
  function initReveal() {
    const els = $$(".reveal");
    if (!("IntersectionObserver" in window)) return els.forEach((e) => e.classList.add("in"));
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { threshold: 0.1 });
    els.forEach((e) => io.observe(e));
  }
  function countUp(node, target, dur) {
    const start = performance.now();
    (function tick(now) {
      const p = Math.min(1, (now - start) / (dur || 1200));
      node.textContent = fmt(Math.round(target * (1 - Math.pow(1 - p, 4))));
      if (p < 1) requestAnimationFrame(tick);
    })(start);
  }
  function setUsagePill(user) {
    const pill = $("#nav-usage");
    if (!pill) return;
    // user can be null (logged out) — renderAuth() calls this unconditionally.
    if (!user) { pill.innerHTML = "<b>0</b>/Unlimited"; return; }
    const t = user.tier || {};
    // Daily upload limit (display only; enforcement is server-side).
    const limit = PATCH_LIMIT[t.tier] || null;
    pill.innerHTML = limit ? `<b>${limit}</b>/DAY · ${t.tierLabel || ""}` : `<b>Unlimited</b> · ${t.tierLabel || ""}`;
  }
  function renderAuth(user, devMode) {
    const login = $("#btn-login"), dev = $("#btn-dev"), logout = $("#btn-logout"), chip = $("#nav-user");
    const useDev = !!(dev && devMode && !API_DISCORD);
    // Logout is ALWAYS visible (PC + mobile) — clicking while logged out just
    // lands back on the dashboard.
    if (logout) {
      logout.style.display = "inline-flex";
      logout.onclick = async () => { await api("/api/logout", { method: "POST" }); location.href = "/"; };
    }
    if (user) {
      if (login) login.style.display = "none";
      if (dev) dev.style.display = "none";
      if (chip) {
        chip.style.display = "inline-flex";
        chip.innerHTML =
          (user.avatar ? '<img class="nav-avatar" src="' + esc(user.avatar) + '" alt=""/>' : "") +
          '<span class="nav-user-name" id="nav-user-name"></span>' +
          '<span class="nav-user-tier" id="nav-user-tier"></span>';
        $("#nav-user-name").textContent = user.username || "USER";
        $("#nav-user-tier").textContent = ((user.tier && user.tier.tierLabel) || "Guest").toUpperCase();
      }
    } else {
      if (login) login.style.display = "none";
      if (dev) dev.style.display = "none";
      if (chip) chip.style.display = "none";
    }
    // in-UI login button (dashboard hero) — only when logged out
    const hl = $("#hero-login");
    if (hl) {
      if (user) { hl.style.display = "none"; hl.innerHTML = ""; }
      else {
        hl.style.display = "";
        if (useDev) {
          hl.innerHTML = '<button class="btn btn-discord" id="devLoginBtn">Dev Login</button>';
          const d = $("#devLoginBtn");
          if (d) d.onclick = async () => { const r = await api("/api/login/dev", { method: "POST" }); if (r && r.ok) location.reload(); };
        } else {
          hl.innerHTML = '<a class="btn btn-discord" href="/login" data-login>' + DISCORD_SVG + 'Login with Discord</a>';
        }
      }
    }
    // bottom nav login item: Discord Login vs username
    const bn = $("#bn-login");
    if (bn) {
      if (user) {
        bn.innerHTML = "<span>" + esc(user.username || "Me") + "</span>";
        bn.removeAttribute("data-login");
        bn.removeAttribute("data-discord");
        bn.href = "/";
        bn.classList.add("active");
      } else {
        bn.innerHTML = DISCORD_SVG + "<span>Login</span>";
        bn.setAttribute("data-login", "");
        bn.setAttribute("data-discord", "");
        bn.href = "#/login";
        bn.classList.remove("active");
      }
    }
    // bottom nav logout (mobile) — always visible
    const bnLo = $("#bn-logout");
    if (bnLo) {
      bnLo.style.display = "flex";
      bnLo.onclick = async (ev) => { ev.preventDefault(); await api("/api/logout", { method: "POST" }); location.href = "/"; };
    }
    setUsagePill(user);
  }

  function initDashboard() {
    const cmp = $("#cmp");
    if (cmp) initCompare(cmp);
    initCompareVideo();

    api("/api/health").then((h) => {
      const devMode = h && h.json && h.json.devMode;
      API_DISCORD = !!(h && h.json && h.json.discordConfigured);
      api("/api/me").then((m) => {
        const { user } = normalizeMe(m && m.json);
        renderAuth(user, devMode);
        if (user) { renderTier(user.tier, user.username, m && m.json); }
        else {
          const chip = $("#welcome-chip");
          if (chip) { chip.style.display = "none"; }
        }
      });
    });

    // Live stats: load now + refresh every 15s (cache-busted so the numbers
    // actually move as patches happen, instead of feeling static).
    const loadStats = () => {
      api("/api/stats?_t=" + Date.now()).then((r) => {
        if (r && r.ok) renderStats(r.json);
        else renderStats(null);
      });
    };
    loadStats();
    setInterval(loadStats, 15000);

    const dt = $("#hero-date");
    if (dt) dt.textContent = new Date().toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }

  function renderStats(s) {
    if (!s) {
      // Stats unavailable → show placeholders, but the engine is ALWAYS
      // reported as ONLINE (never show the OFFLINE state).
      [["#kpi-patches", "—"], ["#kpi-users", "—"], ["#kpi-today", "—"]].forEach(([sel, v]) => {
        const n = $(sel); if (n) n.textContent = v;
      });
      if ($("#kpi-today-foot")) $("#kpi-today-foot").textContent = "—";
      if ($("#eng-dot")) $("#eng-dot").classList.remove("off");
      if ($("#eng-text")) { $("#eng-text").textContent = "ONLINE"; $("#eng-text").style.color = ""; }
      if ($("#eng-version")) $("#eng-version").textContent = "RTX ENGINE v2.0.0";
      if ($("#eng-uptime")) $("#eng-uptime").textContent = "UPTIME —";
      if ($("#eng-last")) $("#eng-last").textContent = "LAST OPTIMIZATION —";
      return;
    }
    const kpis = [["#kpi-patches", s.totalPatches], ["#kpi-users", s.totalUsers], ["#kpi-today", s.patchesToday]];
    kpis.forEach(([sel, v]) => {
      const node = $(sel);
      if (!node) return;
      const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { countUp(node, v, 1300); io.disconnect(); } }), { threshold: 0.3 });
      io.observe(node);
    });
    // 7-day total from the daily chart (usage window is daily now, so
    // "patchesWeek" == today's count — show the real 7-day figure instead).
    const weekTotal = (s.daily || []).reduce((a, d) => a + (d.count || 0), 0);
    if ($("#kpi-today-foot")) $("#kpi-today-foot").textContent = fmt(weekTotal) + " LAST 7 DAYS";
    // Users KPI: registered (all-time) + real usage breakdown.
    if ($("#kpi-users-foot")) {
      const used = (s.usersUsed != null) ? s.usersUsed : "—";
      const act = (s.active7d != null) ? s.active7d : "—";
      $("#kpi-users-foot").textContent = used + " USED TOOLS · " + act + " ACTIVE 7D";
    }
    const eng = s.engine || {};
    // Engine status is always reported ONLINE per product decision.
    if ($("#eng-dot")) $("#eng-dot").classList.remove("off");
    if ($("#eng-text")) { $("#eng-text").textContent = "ONLINE"; $("#eng-text").style.color = ""; }
    if ($("#eng-version")) $("#eng-version").textContent = "RTX ENGINE " + (eng.version || "v2.0.0");
    if ($("#eng-uptime")) $("#eng-uptime").textContent = "UPTIME " + (eng.uptime || "—");
    if ($("#eng-last")) {
      const t = eng.lastPatchAt || s.lastPatchAt;
      $("#eng-last").textContent = "LAST OPTIMIZATION " + (t ? timeAgo(t) : "NEVER");
    }
  }

  function renderTier(t, username, me) {
    if ($("#tier-user")) $("#tier-user").textContent = username || "USER";
    if ($("#tier-name2")) $("#tier-name2").textContent = t.tierLabel.toUpperCase();
    if ($("#tier-mb")) $("#tier-mb").textContent = (t.tierMB > 0 ? t.tierMB + " MB" : "Unlimited");
    if ($("#tier-res")) $("#tier-res").textContent = t.tierRes;
    if ($("#tier-fps")) $("#tier-fps").textContent = t.tierFPS + " FPS";
    // Daily upload usage bar: member shows "Unlimited" (since PATCH_LIMIT.member = null)
    const pbText = $("#pb-text"), pbSub = $("#pb-sub"), pbFill = $("#pb-fill");
    if (pbText && pbSub && pbFill) {
      const limit = PATCH_LIMIT[t.tier] || null;
      const used = (me && typeof me.patches_used === "number") ? me.patches_used : 0;
      if (limit) {
        pbText.textContent = Math.min(used, limit) + " / " + limit;
        pbSub.textContent = "uploads used today";
        pbFill.style.setProperty("--w", Math.min(100, (used / limit) * 100) + "%");
      } else {
        pbText.textContent = "Unlimited";
        pbSub.textContent = "Synced via Discord";
        pbFill.style.setProperty("--w", "100%");
      }
    }
  }

  function timeAgo(ts) {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return s + "S AGO";
    if (s < 3600) return Math.floor(s / 60) + "M AGO";
    if (s < 86400) return Math.floor(s / 3600) + "H AGO";
    return Math.floor(s / 86400) + "D AGO";
  }

  function initCompare(cmp) {
    const handle = $("#cmp-hand");
    const setPos = (p) => { p = Math.max(0, Math.min(100, p)); cmp.style.setProperty("--pos", p + "%"); if (handle) handle.setAttribute("aria-valuenow", Math.round(p)); };
    const move = (e) => { const r = cmp.getBoundingClientRect(); setPos(((e.clientX - r.left) / r.width) * 100); };
    let dragging = false;
    cmp.addEventListener("pointerdown", (e) => { dragging = true; cmp.classList.add("dragging"); cmp.setPointerCapture(e.pointerId); move(e); });
    cmp.addEventListener("pointermove", (e) => { if (dragging) move(e); });
    ["pointerup", "pointercancel"].forEach((ev) => cmp.addEventListener(ev, () => { dragging = false; cmp.classList.remove("dragging"); }));
    if (handle) handle.addEventListener("keydown", (e) => {
      const cur = parseFloat(cmp.style.getPropertyValue("--pos")) || 50;
      if (e.key === "ArrowLeft") setPos(cur - 2);
      if (e.key === "ArrowRight") setPos(cur + 2);
    });
  }

  /* Compare slider: real video layers (synced, CSS fallback on failure) */
  function initCompareVideo() {
    const va = $("#vid-a"), vb = $("#vid-b");
    if (!va || !vb) return;
    const hq = (window.RTX && window.RTX.VIDEO_HQ) || "";
    const lq = (window.RTX && window.RTX.VIDEO_LQ) || "";
    if (!hq || !lq) return; // keep the CSS test chart

    function fail(v) {
      // video can't load — CSS scene stays visible underneath
      v.classList.remove("on");
    }
    va.preload = "auto";
    vb.preload = "auto";
    va.src = lq; // LEFT — TikTok side 720p30
    vb.src = hq; // RIGHT — RTXFury side 4K120
    va.classList.add("on");
    vb.classList.add("on");
    va.addEventListener("error", () => fail(va));
    vb.addEventListener("error", () => fail(vb));

    let started = false, raf = 0;

    // Start both only after BOTH have metadata — never call play() early.
    function tryStart() {
      if (started || va.readyState < 1 || vb.readyState < 1) return;
      started = true;
      try { va.currentTime = 0; vb.currentTime = 0; } catch (e) {}
      va.play().catch(() => {});
      vb.play().catch(() => {});
      raf = requestAnimationFrame(tick);
    }
    va.addEventListener("loadedmetadata", tryStart);
    vb.addEventListener("loadedmetadata", tryStart);

    // Continuous tight sync: snap the laggard to the leader; while the heavy
    // (HQ) clip is buffering, hold the other so they never drift apart.
    function tick() {
      const dt = va.currentTime - vb.currentTime;
      if (Math.abs(dt) > 0.12) {
        if (dt > 0) {
          if (vb.paused && !vb.ended) va.pause();           // b buffering — hold a
          else vb.currentTime = va.currentTime;             // snap b forward
        } else {
          if (va.paused && !va.ended) vb.pause();           // a buffering — hold b
          else va.currentTime = vb.currentTime;             // snap a forward
        }
      } else {
        if (va.paused && !vb.paused && !va.ended) va.play().catch(() => {});
        if (vb.paused && !va.paused && !vb.ended) vb.play().catch(() => {});
      }
      raf = requestAnimationFrame(tick);
    }

    // NOTE: no pause/resume on slider drag — the slider only moves the clip
    // mask (--pos), so both videos keep playing while you drag the handle.
    // The tick() loop above keeps them locked in sync at all times.
  }

  /* ── Local file scan: resolution / duration / FPS ─────────────
     Two layers so it works for every file the patcher accepts:
       1. <video> element metadata — fast path for H.264 MP4/MOV.
       2. Manual MP4/MOV box parsing (moov → tkhd/mdhd/stts) — container
          level, no codec decode needed, so HEVC (H.265) and MOV variants
          the browser can't play still report correct specs. Same box-walk
          approach the server uses in api/_lib/tiktok.ts. */
  function readVideoMeta(file) {
    return new Promise((resolve) => {
      let settled = false;
      let codec = "";
      const finish = (m) => { if (!settled) { settled = true; resolve(m); } };
      // Codec sniff (head/tail slices) — lets us flag HEVC before processing.
      (async () => {
        try {
          const head = new Uint8Array(await file.slice(0, SCAN_HEAD).arrayBuffer());
          const has = (b, t) => { for (let i = 0; i + 4 <= b.length; i++) if (t4(b, i) === t) return true; return false; };
          if (has(head, "hvc1") || has(head, "hev1")) codec = "hevc";
          else if (has(head, "avc1")) codec = "avc1";
          if (!codec && file.size > SCAN_HEAD) {
            const tail = new Uint8Array(await file.slice(Math.max(0, file.size - SCAN_TAIL), file.size).arrayBuffer());
            if (has(tail, "hvc1") || has(tail, "hev1")) codec = "hevc";
            else if (has(tail, "avc1")) codec = "avc1";
          }
        } catch (e) {}
      })();
      // Safety net — never leave the UI on "SCANNING…" forever.
      const safety = setTimeout(() => finish(null), 12000);

      // Layer 1: browser decode path (works for H.264/H.265-capable setups)
      const url = URL.createObjectURL(file);
      const vid = document.createElement("video");
      vid.preload = "metadata";
      vid.src = url;
      vid.onloadedmetadata = () => {
        clearTimeout(safety);
        const w = vid.videoWidth, h = vid.videoHeight;
        const dur = Number.isFinite(vid.duration) && vid.duration > 0 ? vid.duration : 0;
        let fps = 0;
        try {
          const q = vid.getVideoPlaybackQuality && vid.getVideoPlaybackQuality();
          if (q && q.totalVideoFrames > 0 && dur > 0) fps = Math.round(q.totalVideoFrames / dur);
        } catch (e) {}
        try { URL.revokeObjectURL(url); } catch (e) {}
        if (w > 0 && h > 0) finish({ w, h, dur, fps, codec });
        // w/h 0 (e.g. codec not decodable) → layer 2 result (if any) wins;
        // parseMP4Boxes below already resolves finish() in every case.
      };
      vid.onerror = () => {
        clearTimeout(safety);
        try { URL.revokeObjectURL(url); } catch (e) {}
      };

      // Layer 2: container box parse — always resolves (data or null).
      parseMP4Boxes(file).then((m) => {
        clearTimeout(safety);
        if (m && (m.w > 0 || m.fps > 0 || m.dur > 0)) finish({ w: m.w, h: m.h, dur: m.dur, fps: m.fps, codec });
        else finish(null);
      });
    });
  }

  const SCAN_HEAD = 1024 * 1024; // 1MB — faststart MP4s have moov up front
  const SCAN_TAIL = 1024 * 1024; // 1MB — non-faststart MP4s have moov at the end

  async function parseMP4Boxes(file) {
    const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
    const t4 = (b, o) => String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]);

    // Parse sibling boxes starting at `start` (assumes box alignment there).
    const boxList = (b, start, end) => {
      const out = [];
      let p = start;
      while (p + 8 <= end) {
        let sz = u32(b, p), hs = 8;
        if (sz === 1) { if (p + 16 > end) break; sz = u32(b, p + 12); hs = 16; }
        if (sz === 0) sz = end - p;
        if (sz < hs || p + sz > end) break;
        out.push({ t: t4(b, p + 4), s: p + hs, e: p + sz });
        p += sz;
      }
      return out;
    };
    const findBox = (list, t) => list.find((x) => x.t === t);
    // Locate a box by type anywhere in the chunk (tail slices don't start on
    // a box boundary): finds "type" preceded by a plausible size.
    const scanBox = (b, type) => {
      for (let i = 4; i + 4 <= b.length; i++) {
        if (t4(b, i) !== type) continue;
        const sz = u32(b, i - 4);
        if (sz >= 8 && i - 4 + sz <= b.length) return i - 4;
      }
      return -1;
    };

    const head = new Uint8Array(await file.slice(0, SCAN_HEAD).arrayBuffer());
    if (head.length < 8) return null;
    const meta = { w: 0, h: 0, fps: 0, dur: 0 };

    const extract = (b) => {
      const moovStart = scanBox(b, "moov");
      if (moovStart < 0) return false;
      const moovBoxes = boxList(b, moovStart + 8, b.length);
      for (const trak of moovBoxes.filter((x) => x.t === "trak")) {
        const tb = boxList(b, trak.s, trak.e);
        const mdia = findBox(tb, "mdia");
        if (!mdia) continue;
        const mb = boxList(b, mdia.s, mdia.e);
        const minf = findBox(mb, "minf");
        if (!minf) continue;
        const minfb = boxList(b, minf.s, minf.e);
        if (!findBox(minfb, "vmhd")) continue; // audio track — skip
        const tkhd = findBox(tb, "tkhd");
        if (tkhd) {
          const ver = b[tkhd.s];
          // tkhd payload: version+flags(4) + 3×(20|32)-bit fields + reserved(8)
          // + layer/alt/volume/reserved(8) + matrix(36) → width at 76 (v0) / 88 (v1)
          const wOff = tkhd.s + (ver === 1 ? 88 : 76);
          if (wOff + 8 <= b.length) { meta.w = u32(b, wOff) >>> 16; meta.h = u32(b, wOff + 4) >>> 16; }
        }
        const mdhd = findBox(mb, "mdhd");
        const stbl = findBox(minfb, "stbl");
        if (mdhd && stbl) {
          const ver = b[mdhd.s];
          const ts = u32(b, mdhd.s + (ver === 1 ? 20 : 12));
          if (ts > 0) {
            if (ver === 1) {
              const hi = u32(b, mdhd.s + 24), lo = u32(b, mdhd.s + 28);
              meta.dur = (hi * 4294967296 + lo) / ts;
            } else {
              meta.dur = u32(b, mdhd.s + 16) / ts;
            }
            const stts = findBox(boxList(b, stbl.s, stbl.e), "stts");
            if (stts && stts.s + 16 <= b.length) {
              const count = u32(b, stts.s + 4);
              if (count > 0) {
                // Average over the FULL time-to-sample table (not the first
                // entry). A one-frame blip at the start used to read ~300fps
                // on real 120fps files, got dropped by the sanity range, and
                // the video passed the local check as "fps?".
                const base = stts.s + 8;
                const max = Math.min(count, Math.floor((b.length - base) / 8));
                let sumF = 0, sumT = 0;
                for (let i = 0; i < max; i++) {
                  const c2 = u32(b, base + i * 8);
                  const d2 = u32(b, base + i * 8 + 4);
                  sumF += c2;
                  sumT += c2 * d2;
                }
                const f = sumT > 0 ? sumF / (sumT / ts) : 0;
                if (f >= 1 && f <= 240) meta.fps = Math.round(f);
              }
            }
          }
        }
        break;
      }
      return meta.w > 0 || meta.fps > 0 || meta.dur > 0;
    };

    if (extract(head)) return meta;
    if (file.size > SCAN_HEAD) {
      const tail = new Uint8Array(await file.slice(Math.max(0, file.size - SCAN_TAIL), file.size).arrayBuffer());
      if (extract(tail)) return meta;
    }
    return null;
  }

  /* ── Patcher console (log terminal inside the processing view) ── */
  function procLog(msg, cls) {
    const log = $("#procLog");
    if (!log) return;
    const line = document.createElement("div");
    line.className = "log-line" + (cls ? " " + cls : "");
    line.textContent = "> " + msg;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
  }

  // Console line that updates in place (used for live download progress)
  // so a slow connection reports progress instead of spamming the log.
  function procLogDl(msg) {
    const log = $("#procLog");
    if (!log) return;
    const kids = log.children;
    const last = kids.length ? kids[kids.length - 1] : null;
    if (last && last.dataset && last.dataset.dl === "1") {
      last.textContent = "> " + msg;
    } else {
      const line = document.createElement("div");
      line.className = "log-line hi";
      line.dataset.dl = "1";
      line.textContent = "> " + msg;
      log.appendChild(line);
    }
    log.scrollTop = log.scrollHeight;
  }

  function fmtBytes(n) {
    if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
    if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
    if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
    return n + " B";
  }
  function fmtSpeed(bps) {
    if (bps >= 1048576) return (bps / 1048576).toFixed(1) + " MB/s";
    return (bps / 1024).toFixed(0) + " KB/s";
  }
  function fmtEta(secs) {
    if (!Number.isFinite(secs) || secs <= 0) return "";
    return secs >= 60 ? Math.ceil(secs / 60) + "m" : Math.ceil(secs) + "s";
  }

  /* ── PATCHER ═════════════════════════════════════════════════ */
  function initPatcher() {
    const input = $("#fileInput"), zone = $("#dropZone"), runBtn = $("#runBtn"), dlBtn = $("#dlBtn"), clearBtn = $("#clearBtn");
    const againBtn = $("#againBtn");
    const AGAIN_LABEL = againBtn ? againBtn.textContent : "";
    if (!input || !zone) return;

    let file = null, objectUrl = null, timers = [], abortCtrl = null, activeXhr = null, limitMB = 80, tierLabel = "MEMBER", apiLive = true, devMode = false, loggedIn = false, patchedName = "", tierKey = "member", discordId = "", lastScan = null, lastHealth = "";
    // Smooth progress while the server processes (upload done, response
    // pending) — the bar eases 90% → ~98% instead of stalling.
    let finalizeTimer = null;
    let animBand = 75;
    let lastFileHevc = false, slowMsgShown1 = false, slowMsgShown2 = false;
    function stopFinalizeAnim() { if (finalizeTimer) { clearInterval(finalizeTimer); finalizeTimer = null; } }
    // Banded smooth mover (never stalls):
    //   band 75  = server processing (50%→75%)
    //   band 99.9 = response streaming without Content-Length
    // Once real download bytes are known, the interval is stopped and the bar
    // is driven by actual bytes from the current % to 100%.
    function startFinalizeAnim(band) {
      stopFinalizeAnim();
      animBand = typeof band === "number" ? band : 75;
      let pct = Math.max(50, parseFloat($("#progressFill").style.width) || 50);
      if (pct >= animBand) pct = Math.max(50, animBand - 0.2);
      slowMsgShown1 = false;
      finalizeTimer = setInterval(() => {
        pct = Math.min(animBand, pct + Math.max(0.05, (animBand - pct) * 0.02));
        if (pct >= 55.5 && !slowMsgShown1) {
          slowMsgShown1 = true;
          procLog(lastFileHevc ? "Optimizing your HEVC file — applying the TikTok-safe settings. Tip: H.264 files process faster."
                               : "Optimizing your file — applying the TikTok-safe settings. Tip: H.264 files process the fastest.", "hi");
        }
        $("#progressFill").style.width = pct + "%";
        $("#progressPct").textContent = pct.toFixed(1) + "%";
      }, 300);
    }

    api("/api/health").then((h) => { apiLive = !!(h && h.ok); devMode = !!(h && h.json && h.json.devMode); API_DISCORD = !!(h && h.json && h.json.discordConfigured); });
    api("/api/me").then((m) => {
      const me = m && m.json;
      const { user } = normalizeMe(me);
      renderAuth(user, devMode);
      if (user) {
        loggedIn = true;
        tierKey = user.tier.tier;
        discordId = (me && me.discord_id) || "";
        limitMB = user.tier.tierMB;
        tierLabel = user.tier.tierLabel.toUpperCase();
        setLimit(0);
        setUsagePill(user);
        const lbl = $("#usage-tier-label"), cnt = $("#usage-count"), av = $("#usage-avatar");
        if (lbl) lbl.textContent = user.username;
        if (cnt) cnt.textContent = (me && typeof me.patches_used === "number") ? me.patches_used : "0";
        if (av) {
          if (user.avatar) av.innerHTML = '<img src="' + esc(user.avatar) + '" alt=""/>';
          else av.textContent = (user.username || "U")[0].toUpperCase();
        }
      }
    });

    // Keep the usage counter in sync — admin resets / other sessions would
    // otherwise leave a stale "3/3" on screen until the next reload.
    setInterval(() => {
      if (!loggedIn) return;
      api("/api/me").then((m) => {
        const me = m && m.json;
        const cnt = $("#usage-count");
        if (cnt && me && typeof me.patches_used === "number") cnt.textContent = me.patches_used;
      }).catch(() => {});
    }, 45000);

    // Patches are unlimited for all tiers (server-side TIER_PATCH_LIMITS is
    // None). No client-side daily cap — the backend is the source of truth.

    const scan = { size: $("#sv-size"), res: $("#sv-res"), dur: $("#sv-dur"), health: $("#sv-health") };
    const setLimit = (used) => {
      const u = Number.isFinite(used) ? used : 0;
      const pct = limitMB > 0 ? Math.min(100, (u / limitMB) * 100) : 0;
      $("#limitFill").style.width = pct + "%";
      $("#limitText").textContent = u.toFixed(1) + " MB / " + (limitMB > 0 ? limitMB + " MB" : "Unlimited") + " · " + (tierLabel || "MEMBER");
    };

    function resetTimers() { timers.forEach(clearTimeout); timers = []; }
    function resetUI() {
      resetTimers();
      stopFinalizeAnim();
      $("#processingView").style.display = "none";
      $("#dropZoneWrap").style.display = "";
      $("#scanView").classList.remove("show");
      $("#progressFill").style.width = "0";
      $("#progressPct").textContent = "0%";
      $("#progressStage").textContent = "Processing…";
      $("#procStatus").textContent = "RTX Engine v2.0.0";
      $("#cancelBtn").style.display = "";
      // Idle state: full upload box + a single Patch Video button.
      $("#dropZone").style.display = "";
      runBtn.style.display = "";
      runBtn.disabled = false;
      dlBtn.style.display = "none"; dlBtn.disabled = true;
      clearBtn.style.display = "none";
      if (againBtn) againBtn.style.display = "none";
      setLimit(0);
    }

    zone.addEventListener("click", () => {
      if (!loggedIn) { openLogin(); return; }
      input.click();
    });
    input.addEventListener("change", () => {
      if (!loggedIn) { openLogin(); input.value = ""; return; }
      if (input.files[0]) handleFile(input.files[0]);
    });
    ["dragenter", "dragover"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", (e) => {
      if (!loggedIn) { openLogin(); return; }
      if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });

  function handleFile(f) {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    file = f;
    objectUrl = URL.createObjectURL(f);
    const sizeMB = f.size / (1024 * 1024);
      scan.size.textContent = sizeMB.toFixed(1) + " MB";
      scan.res.textContent = "SCANNING…"; scan.dur.textContent = "SCANNING…";
      scan.health.textContent = "SCANNING…"; scan.health.style.color = "var(--text-3)";
      setLimit(sizeMB);
      $("#scanView").classList.add("show");
      // ★ CHANGE: Free users now have unlimited file size
      const over = false; // Always false — no file size limit
      runBtn.disabled = over;
      if (over) { scan.health.textContent = "OVER LIMIT"; scan.health.style.color = "var(--red)"; }

      // Resolution / duration / FPS scan — works even for HEVC/MOV files the
      // browser can't decode (video element falls back to box parsing).
      lastScan = null; lastHealth = "";
      readVideoMeta(f).then((meta) => {
        const caps = TIER_RES[tierKey] || TIER_RES.member;
        lastScan = meta || null;
        if (!meta) {
          scan.res.textContent = "UNKNOWN"; scan.dur.textContent = "UNKNOWN";
          if (!over) { scan.health.textContent = "UNKNOWN"; scan.health.style.color = "var(--amber)"; }
          lastHealth = "UNKNOWN";
          return;
        }
        if (meta.w > 0 && meta.h > 0) {
          scan.res.textContent = meta.w + "×" + meta.h + (meta.codec === "hevc" ? " · HEVC" : "");
        } else scan.res.textContent = "UNKNOWN";
        if (meta.codec === "hevc") {
          procLog("HEVC detected. Optimising now. Tip: H.264 files are recommended.", "ok");
          console.log("[RTX Fury] HEVC detected — processing might be a bit slower.");
        }
        if (meta.dur > 0) scan.dur.textContent = Math.floor(meta.dur / 60) + ":" + String(Math.floor(meta.dur % 60)).padStart(2, "0");
        else scan.dur.textContent = "UNKNOWN";

        // ★ CHANGE: Tier caps now allow 4K120 for member (same as donor)
        const fps = meta.fps > 0 ? meta.fps : 0;
        const hiFPS = caps.hiFPS || caps.maxFPS;
        const capLong = fps > caps.maxFPS ? (caps.hiResLong || caps.resLong) : caps.resLong;
        const capShort = fps > caps.maxFPS ? (caps.hiResShort || caps.resShort) : caps.resShort;
        const resBad = meta.w > 0 && meta.h > 0 &&
          (Math.max(meta.w, meta.h) > capLong || Math.min(meta.w, meta.h) > capShort);
        const fpsBad = fps > hiFPS;
        const blocked = over || resBad || fpsBad;
        runBtn.disabled = blocked;
        // Health verdict: passes the tier checks → READY TO PATCH;
        // any size/res/FPS violation → needs a higher tier (UPGRADE TO PATCH).
        if (blocked) {
          scan.health.textContent = "UPGRADE TO OPTIMIZE"; scan.health.style.color = "var(--red)";
          alert("This video exceeds your tier limits (size/resolution/FPS) — upgrade to optimize it.");
          resetUI();
        } else {
          scan.health.textContent = "READY TO OPTIMIZE"; scan.health.style.color = "var(--green)";
          lastHealth = scan.health.textContent;
          // Daily usage pre-check: the real gate is /api/authorize (which
          // reserves a use server-side), this just gives a friendly early alert.
          (async () => {
            try {
              const usage = await api("/api/usage");
              if (usage && usage.ok && usage.limit !== null && usage.used >= usage.limit) {
                alert("You've reached your upload limit of " + usage.limit + " videos for today (" + usage.used + "/" + usage.limit + " used). Wait until midnight UTC for the limit to reset.");
                if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
                file = null; input.value = "";
                resetUI();
                return;
              }
            } catch (e) { /* usage check is best-effort — never block on a hiccup */ }
            // File is scanned and within tier limits — the Patch button
            // stays enabled and the user starts the patch manually.
          })();
        }
      });
    }

    runBtn.addEventListener("click", () => {
      if (!loggedIn) { openLogin(); return; }
      if (!file) { input.click(); return; } // no file yet → open the picker
      resetTimers();
      abortCtrl = new AbortController();
      activeXhr = null;
      $("#dropZoneWrap").style.display = "none";
      $("#processingView").style.display = "block";
      $("#progressFill").style.width = "0";
      $("#progressPct").textContent = "0%";
      $("#progressStage").textContent = "Checking daily usage…";
      $("#procStatus").textContent = "RTX Engine v2 · CLOUD";
      dlBtn.disabled = true;

      // Console: start a fresh log for this run.
      const plog = $("#procLog");
      if (plog) plog.innerHTML = "";
      procLog("RTXFury — RTX Server Optimize", "hi");
      procLog("File: " + file.name + " (" + fmtBytes(file.size) + ")", "pur");
      procLog("Tier: " + tierLabel + " · " + (limitMB > 0 ? limitMB + " MB" : "Unlimited"), "pur");
      if (lastScan) {
        procLog(
          "Scan: " + (lastScan.w > 0 ? lastScan.w + "×" + lastScan.h : "unknown res") +
          " · " + (lastScan.fps > 0 ? lastScan.fps + " fps" : "fps?") +
          " · " + (lastScan.dur > 0 ? Math.floor(lastScan.dur / 60) + "m" + Math.floor(lastScan.dur % 60) + "s" : "dur?") +
          " · " + (lastHealth || "—"),
          "pur"
        );
      }

      // Progress model:
      //   1%         authorizing (REAL server gate: reserves one use)
      //   1%–50%     uploading to the RTX server patch engine
      //   50%–75%    processing (server encoding + patching)
      //   75%–100%   downloading the optimized file back
      timers.push(setTimeout(async () => {
        try {
          // ── Server gate: get a patch token ──
          // /api/authorize (Vercel) validates the Discord session, refreshes
          // the live tier from the patch service, and returns a short-lived
          // HMAC-signed token. The daily-limit gate itself is enforced by
          // the patch service at upload time — counted once per patch.
          $("#progressStage").textContent = "Checking daily usage…";
          const auth = await api("/api/authorize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          if (abortCtrl && abortCtrl.signal.aborted) throw new Error("aborted");
          if (!auth || !auth.ok || !auth.json || auth.json.ok !== true) {
            const msg = (auth && auth.json && auth.json.error) || "Authorization failed — try again.";
            procLog("Blocked: " + msg, "err");
            $("#procStatus").textContent = "Limit reached";
            $("#progressStage").textContent = msg;
            timers.push(setTimeout(() => resetUI(), 5000));
            return;
          }
          const tk = auth.json;
          $("#progressFill").style.width = "1%";
          $("#progressPct").textContent = "1%";
          procLog("Auth: OK [" + (tk.tier || tierLabel || "MEMBER").toLowerCase() + "]", "ok");
          if (typeof tk.patches_used === "number") {
            procLog("Usage: " + tk.patches_used + " / " + (tk.patches_limit === null || tk.patches_limit === undefined ? "Unlimited" : tk.patches_limit) + " today", "pur");
            const _cnt = $("#usage-count");
            if (_cnt) _cnt.textContent = String(tk.patches_used);
          }
          // ★ CHANGE: Bypass daily limit check for member (free) users
          if (tierKey !== "member" && typeof tk.patches_used === "number" && tk.patches_limit !== null && tk.patches_limit !== undefined && tk.patches_used >= tk.patches_limit) {
            const limitMsg = "You've reached your upload limit of " + tk.patches_limit + " videos for today (" + tk.patches_used + "/" + tk.patches_limit + " used). Wait until midnight UTC for the limit to reset.";
            procLog("Limit: " + limitMsg, "err");
            $("#procStatus").textContent = "Limit reached";
            $("#progressStage").textContent = limitMsg;
            // Clear the selected file so the dropzone doesn't keep showing it
            if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
            file = null; input.value = "";
            timers.push(setTimeout(() => resetUI(), 6000));
            return;
          }

          // ── Server-side patch — DIRECT upload to the patch service ──
          // The Void API key stays server-side. The browser uploads the video
          // STRAIGHT to the patch service (bypassing Vercel entirely, whose
          // 4.5 MB function body limit 413s any real video), carrying the
          // token minted by /api/authorize. The service validates the token,
          // enforces tier caps (size/res/FPS + daily limit, counted once
          // here), forwards the file to Void, and streams the patched MP4
          // back to the browser. Falls back to the same-origin relay only
          // if PATCH_API_URL is not configured.
          $("#progressStage").textContent = "Optimizing…";
          procLog("Connecting to the optimizer service…", "pur");
          const _hevcUpload = await clientDetectHEVC(file);
          lastFileHevc = !!_hevcUpload;
          const fd = new FormData();
          if (_hevcUpload) {
            fd.append("vhevc", "1");
            procLog("HEVC detected. Optimising now. Tip: H.264 files are recommended.", "ok");
          }
          fd.append("file", file, file.name);
          const PATCH_API = (window.RTX && window.RTX.PATCH_API_URL) || "";
          const patchUrl = PATCH_API
            ? PATCH_API.replace(/\/+$/, "") + "/api/patch-void"
            : "/api/patch-void";
          const tkId = String(tk.token || "").split(":")[1] || "";
          // HTTP headers must be ISO-8859-1: filenames containing emoji/CJK/
          // other Unicode throw "String contains non ISO-8859-1 code point".
          // Send an ASCII-safe name so the header never fails.
          const safeName = file.name.replace(/[^\x20-\x7E]/g, "_");
          // Slow/unstable connections (e.g. mobile data) can drop the direct
          // upload mid-flight — retry a few times before giving up. If the
          // server already finished the job (we hold its token), reconnect and
          // download the result instead of re-uploading everything.
          async function resumeDownload(id) {
            try {
              return await new Promise((resolve, reject) => {
                const gx = new XMLHttpRequest();
                gx.open("GET", patchUrl + "/job/" + id);
                gx.responseType = "blob";
                gx.setRequestHeader("X-Patch-Token", tk.token);
                if (tkId) gx.setRequestHeader("X-Discord-Id", tkId);
                gx.onload = () => {
                  if (gx.status >= 200 && gx.status < 300) resolve(gx.response);
                  else reject(new Error("resume failed"));
                };
                gx.onerror = () => reject(new Error("resume network"));
                gx.onabort = () => reject(new Error("resume aborted"));
                gx.onprogress = (ev) => {
                  if (ev.lengthComputable && ev.total > 0) {
                    stopFinalizeAnim();
                    const floor = Math.max(50, parseFloat($("#progressFill").style.width) || 50);
                    const pct = Math.min(99.9, floor + (ev.loaded / ev.total) * (100 - floor));
                    $("#progressFill").style.width = pct + "%";
                    $("#progressPct").textContent = Math.round(pct) + "%";
                    $("#progressStage").textContent = "Downloading " + fmtBytes(ev.loaded) + " / " + fmtBytes(ev.total);
                    if (pct >= 99 && !slowMsgShown2) {
                      slowMsgShown2 = true;
                      procLog("Almost done — finalizing your optimized file...", "hi");
                    }
                  }
                };
                if (!finalizeTimer) startFinalizeAnim(99.9);
                gx.send();
              });
            } catch (e) { return null; }
          }
          const MAX_ATTEMPTS = 4;
          let outBuf = null;
          let jobId = null;
          for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            if (abortCtrl && abortCtrl.signal.aborted) throw new Error("aborted");
            if (attempt > 1) {
              procLog("Connection lost — retrying (" + (attempt - 1) + "/" + (MAX_ATTEMPTS - 1) + ")…", "warn");
              $("#progressStage").textContent = "Reconnecting…";
            }
            const xhr = new XMLHttpRequest();
            activeXhr = xhr;
            xhr.open("POST", patchUrl);
            xhr.responseType = "blob";
            xhr.setRequestHeader("X-Patch-Token", tk.token);
            // Discord ID comes straight from the signed token payload
            // (tier:id:expires:nonce:flag:sig) — the server checks it against
            // the token so one user can't burn another's quota.
            if (tkId) xhr.setRequestHeader("X-Discord-Id", tkId);
            xhr.setRequestHeader("X-Filename", safeName);
            xhr.upload.onprogress = (ev) => {
              if (!ev.lengthComputable) return;
              const pct = Math.min(50, 1 + Math.round((ev.loaded / ev.total) * 49));
              $("#progressFill").style.width = pct + "%";
              $("#progressPct").textContent = Math.round(pct) + "%";
              $("#progressStage").textContent = "Uploading " + fmtBytes(ev.loaded) + " / " + fmtBytes(ev.total);
            };
            // Upload finished → server is processing (encoding + patching).
            // Keep the bar moving smoothly instead of stalling at 90%.
            xhr.upload.onload = () => {
              $("#progressStage").textContent = "Optimizing…";
              startFinalizeAnim();
            };
            // Response = optimized file streaming back to the browser. The
            // old UI sat frozen at 99.99% during this (can take minutes on
            // slow links) - report real download progress in the console.
            let lastDlPct = -1, dlMsgShown = false;
            xhr.onprogress = (ev) => {
              if (ev.lengthComputable && ev.total > 0) {
                stopFinalizeAnim(); // real bytes now drive the bar to 100%
                const floor = Math.max(50, parseFloat($("#progressFill").style.width) || 50);
                const pct = Math.min(99.9, floor + (ev.loaded / ev.total) * (100 - floor));
                $("#progressFill").style.width = pct + "%";
                $("#progressPct").textContent = Math.round(pct) + "%";
                $("#progressStage").textContent = "Downloading " + fmtBytes(ev.loaded) + " / " + fmtBytes(ev.total);
                if (pct >= 99 && !slowMsgShown2) {
                  slowMsgShown2 = true;
                  procLog("Almost done — finalizing your optimized file...", "hi");
                }
                const dp = Math.min(100, Math.floor((ev.loaded / ev.total) * 100));
                if (dp !== lastDlPct) {
                  lastDlPct = dp;
                  procLogDl("Downloading your optimized file — " + fmtBytes(ev.loaded) + " / " + fmtBytes(ev.total) + " (" + dp + "%)");
                }
              } else if (!dlMsgShown) {
                dlMsgShown = true;
                procLogDl("Downloading your optimized file…");
              }
            };
            try {
              outBuf = await new Promise((resolve, reject) => {
                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(xhr.response); // optimized MP4 blob
                    return;
                  }
                  // Error body is JSON {error} — surface the real message.
                  // With responseType="blob" the error body is a Blob, so read
                  // it as text before parsing.
                  let msg = "Optimization failed (" + xhr.status + ")";
                  const errBody = xhr.response;
                  if (errBody instanceof Blob) {
                    errBody.text().then((txt) => {
                      try {
                        const j = JSON.parse(txt);
                        if (j && j.error) msg = j.error;
                      } catch (e) {}
                      const err = new Error(msg); err.status = xhr.status; reject(err);
                    }).catch(() => { const err = new Error(msg); err.status = xhr.status; reject(err); });
                  } else {
                    const err = new Error(msg); err.status = xhr.status; reject(err);
                  }
                };
                xhr.onerror = () => reject(new Error("Connection to the optimizer was interrupted — try again."));
                xhr.onabort = () => reject(new Error("aborted"));
                xhr.onreadystatechange = () => {
                  // Headers carry the resume token BEFORE the file streams
                  // back - as soon as they arrive, a mid-download drop can be
                  // recovered with a simple re-fetch instead of a re-upload.
                  if (xhr.readyState >= 2 && !jobId) {
                    const jh = xhr.getResponseHeader("X-Job-Id");
                    if (jh) jobId = jh;
                  }
                  // Every delivery (HEVC or H.264) shows the downloading line
                  // as soon as the result starts streaming; real % replaces it.
                  if (xhr.readyState === 3 && (parseFloat($("#progressFill").style.width) || 0) < 98) {
                    if (!finalizeTimer) startFinalizeAnim(99.9);
                    else if (animBand < 99.9) animBand = 99.9;
                    if (!dlMsgShown) {
                      dlMsgShown = true;
                      procLogDl("Downloading your optimized file…");
                    }
                  }
                };
                xhr.send(fd);
              });
              break; // upload succeeded
            } catch (e) {
              stopFinalizeAnim();
              if (e && e.message === "aborted") throw e;
              // Server answered with an HTTP error (e.g. 429 daily limit) —
              // surface its message immediately instead of retrying. BUT
              // 502/503/504 are transient gateway errors (a restart or a
              // brief upstream blip) - those retry like a network drop.
              if (e && e.status && e.status >= 400 && e.status !== 502 && e.status !== 503 && e.status !== 504) throw e;
              // Server-side job already finished? Reconnect and download the
              // finished file - no re-upload, no re-encode, no extra quota.
              if (jobId) {
                const resumed = await resumeDownload(jobId);
                if (resumed) { outBuf = resumed; break; }
              }
              if (attempt === MAX_ATTEMPTS) throw e;
              await new Promise((r) => setTimeout(r, 1600 * attempt));
            } finally {
              activeXhr = null;
            }
          }
          // Live usage tick — the patch just consumed one use
          {
            const _cnt = $("#usage-count");
            if (_cnt) _cnt.textContent = String((parseInt(_cnt.textContent || "0", 10) || 0) + 1);
          }
          if (abortCtrl && abortCtrl.signal.aborted) throw new Error("aborted");
          if (!(outBuf instanceof Blob)) throw new Error("Empty response from optimizer server.");
          stopFinalizeAnim();

          // Finalize (simulated): continue from current % → 100
          const dlBase = Math.min(99.9, parseFloat($("#progressFill").style.width) || 90);
          $("#progressFill").style.width = dlBase + "%";
          $("#progressPct").textContent = Math.round(dlBase) + "%";
          const dlMs = 400 + Math.random() * 500;
          const dlStart = performance.now();
          await new Promise((resolve) => {
            const tick = () => {
              const t = (performance.now() - dlStart) / dlMs;
              if (t >= 1) { resolve(); return; }
              const pct = Math.min(99.9, dlBase + t * (99.9 - dlBase));
              const loaded = Math.round((pct / 100) * outBuf.size);
              const speed = outBuf.size / (dlMs / 1000);
              $("#progressFill").style.width = pct + "%";
              $("#progressPct").textContent = pct + "%";
              $("#progressStage").textContent = "Finalizing " + fmtBytes(loaded) + " / " + fmtBytes(outBuf.size) + " · " + fmtSpeed(speed);
              setTimeout(tick, 100);
            };
            tick();
          });
          if (abortCtrl && abortCtrl.signal.aborted) throw new Error("aborted");

          const blob = outBuf;

          // NOTE: no /api/track call here — the use is counted by the patch
          // service on /api/patch-void, exactly once per patch.

          if (objectUrl) URL.revokeObjectURL(objectUrl);
          objectUrl = URL.createObjectURL(blob);
          patchedName = "rtx-optimized-" + Math.random().toString(16).slice(2, 6) + ".mp4";
          $("#progressFill").style.width = "100%";
          $("#progressPct").textContent = "100%";
          // Done state: the console stays on screen with the final log;
          // only two buttons are shown — Optimize Another + Download.
          $("#dropZoneWrap").style.display = "none";
          $("#processingView").style.display = "block";
          $("#cancelBtn").style.display = "none";
          $("#progressStage").textContent = "Optimization complete. The video has bypassed TikTok compression";
          $("#procStatus").textContent = "Done — click Download";
          procLog("Output: " + patchedName + " (" + fmtBytes(blob.size) + ")", "ok");
          procLog("Download started automatically — if it didn't, click Download below.", "hi");
          doDownload();
          if (againBtn) { againBtn.style.display = ""; againBtn.textContent = AGAIN_LABEL; }
          try { dlBtn.style.display = ""; dlBtn.disabled = false; dlBtn.classList.add("pulse"); dlBtn.scrollIntoView({ behavior: "smooth", block: "center" }); }
          catch (e) { /* UI nicety only — download still works */ }
        } catch (e) {
          stopFinalizeAnim();
          if (abortCtrl && abortCtrl.signal.aborted) {
            procLog("Optimization cancelled.", "warn");
            resetUI();
            return;
          }
          // Clear the stale file so the dropzone never keeps showing the old video
          if (objectUrl) { URL.revokeObjectURL(objectUrl); objectUrl = null; }
          file = null; input.value = ""; patchedName = "";
          procLog("Error: " + ((e && e.message) || "optimization failed"), "err");
          $("#procStatus").textContent = "Error";
          $("#progressStage").textContent = ((e && e.message) || "optimization failed") + " — try another file";
          // Keep the error on screen (no auto-reset) — the user clicks Try Again
          $("#cancelBtn").style.display = "none";
          dlBtn.style.display = "none"; dlBtn.disabled = true;
          if (againBtn) { againBtn.textContent = "Try Again"; againBtn.style.display = ""; }
        }
      }, 300));
    });

    $("#cancelBtn").addEventListener("click", () => {
      if (abortCtrl) abortCtrl.abort();
      if (activeXhr) activeXhr.abort(); // abort an in-flight upload
      resetTimers();
      $("#procStatus").textContent = "Aborted";
      $("#progressStage").textContent = "Cancelled";
      timers.push(setTimeout(() => resetUI(), 800));
    });
    const doDownload = () => {
      if (!objectUrl) return;
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = patchedName || ("optimized-" + (file ? file.name.replace(/\.[^.]+$/, "") : "video") + ".mp4");
      document.body.appendChild(a); a.click(); a.remove();
    };
    dlBtn.addEventListener("click", doDownload);
    $("#clearBtn").addEventListener("click", () => { file = null; input.value = ""; resetUI(); });
    // "Patch Another One" — shown after a successful patch; resets everything
    // so the user can immediately drop the next video.
    if (againBtn) againBtn.addEventListener("click", () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      objectUrl = null; file = null; input.value = ""; patchedName = "";
      resetUI();
      const drop = $("#dropZoneWrap");
      if (drop) { drop.style.display = ""; drop.scrollIntoView({ behavior: "smooth", block: "center" }); }
    });
    resetUI();
  }

  /* ── ANALYTICS — TikTok Analyzer (single video, like Zilem) ── */
  function initAnalytics() {
    const input = $("#ttUrlInput"), btn = $("#ttAnalyzeBtn");
    const loading = $("#ttLoading"), errEl = $("#ttError"), res = $("#ttResult");
    if (!input || !btn) return;

    function showErr(msg) {
      loading.classList.remove("show");
      res.classList.remove("show");
      errEl.textContent = msg;
      errEl.classList.add("show");
    }
    function setBtn(analyzing) {
      btn.disabled = analyzing;
      btn.innerHTML = analyzing
        ? '<div class="tt-spinner" style="width:14px;height:14px;border-color:rgba(8,8,8,.18);border-top-color:#080808;margin:0;"></div>'
        : '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Analyze';
    }

    async function analyze() {
      const url = input.value.trim();
      if (!url) { showErr("Paste a TikTok URL first."); return; }
      if (!url.includes("tiktok.com")) { showErr("That doesn't look like a TikTok URL."); return; }
      setBtn(true);
      loading.classList.add("show");
      errEl.classList.remove("show");
      res.classList.remove("show");
      const r = await api("/api/tiktok", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      loading.classList.remove("show");
      setBtn(false);
      if (!r || !r.json) { showErr("Server unreachable — start the server for live analysis."); return; }
      const d = r.json;
      if (d.error || !r.ok) { showErr("Error: " + (d.error || ("HTTP " + r.status))); return; }
      render(d);
    }

    function render(d) {
      // demo note
      const note = $("#ttDemoNote");
      if (d._demo) {
        note.style.display = "";
        note.innerHTML = "<i></i>DEMO DATA — " + esc(d._reason || "live source unavailable");
      } else {
        note.style.display = "none";
      }

      const avatar = $("#ttAvatar");
      if (d.avatar) { avatar.src = d.avatar; avatar.style.display = ""; }
      else avatar.style.display = "none";
      $("#ttAuthorName").textContent = d.nickname || d.author || "—";
      $("#ttHandle").textContent = d.author ? "@" + d.author : "—";
      const verEl = $("#ttVerified");
      verEl.style.display = d.verified ? "inline-flex" : "none";
      const badge = $("#ttAccountBadge");
      badge.className = "tt-account-badge " + (d.account_status === "private" ? "private" : "public");
      badge.textContent = d.status || (d.account_status === "private" ? "PRIVATE" : "PUBLIC");
      $("#ttRegion").textContent = d.region || "";

      $("#ttDuration").textContent = d.duration || "—";
      $("#ttResolution").textContent = d.resolution || "—";
      $("#ttFPS").textContent = d.fps ? d.fps + " fps" : "—";
      $("#ttFileSize").textContent = d.file_size_mb ? d.file_size_mb + " MB" : "—";
      $("#ttUploadedAt").textContent = d.uploaded_at || "—";

      $("#ttTitle").textContent = d.title || "—";
      $("#ttHashtags").textContent = d.hashtags || "";

      const catEl = $("#ttCategories");
      if (catEl) {
        const cats = Array.isArray(d.categories) ? d.categories : [];
        if (cats.length) {
          catEl.innerHTML = cats.map(c => '<span class="tt-cat-chip">' + c + "</span>").join("");
          catEl.style.display = "flex";
        } else {
          catEl.innerHTML = "";
          catEl.style.display = "none";
        }
      }

      const s = d.stats || {};
      $("#st-views").textContent = s.views || "—";
      $("#st-likes").textContent = s.likes || "—";
      $("#st-comments").textContent = s.comments || "—";
      $("#st-shares").textContent = s.shares || "—";

      $("#tech-res").textContent = d.web_quality || d.resolution || "—";
      $("#tech-fps").textContent = d.fps ? d.fps + " fps" : "—";
      $("#tech-engine").textContent = d.engine || "—";
      const bitrateEl = $("#tech-bitrate");
      if (bitrateEl) {
        const br = d.top_bitrate;
        bitrateEl.textContent = br != null ? (Number(br) >= 1 ? Number(br).toFixed(1) + " Mbps" : (Number(br) * 1000).toFixed(0) + " Kbps") : "—";
      }
      $("#tech-size").textContent = d.file_size_mb ? d.file_size_mb + " MB" : "—";
      $("#tech-dims").textContent = d.dimensions || "—";
      const statusEl = $("#tech-status");
      const isPrivate = d.account_status === "private";
      statusEl.textContent = isPrivate ? "Private" : "Public";
      statusEl.style.color = isPrivate ? "var(--red)" : "var(--green)";

      const dl = $("#ttVideoBtn");
      if (d.video_url) { dl.href = d.video_url; dl.style.display = "flex"; }
      else dl.style.display = "none";

      res.classList.add("show");
    }

    btn.addEventListener("click", analyze);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") analyze(); });
  }

  /* ── ADMIN (works on local server AND Vercel) ══════════════ */
  let admPage = 1, admPer = 50; // page state shared by loadUsers/ensurePager (top level)
  function initAdmin() {
    const form = $("#admin-login-form"), panel = $("#admin-panel");
    function showPanel() {
      if (form) form.style.display = "none";
      if (panel) panel.style.display = "";
      initJobsPanel();
      loadUsers();
      loadJobs();
    }
    async function tryLoadUsers() {
      const r = await api("/api/admin/users");
      return !!(r && r.ok);
    }
    tryLoadUsers().then((ok) => { if (ok) showPanel(); else if (form) form.style.display = ""; });

    if (form) form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const r = await api("/api/admin/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ secret: $("#admin-secret").value }) });
      if (r && r.ok) showPanel();
      else { const err = $("#admin-error"); if (err) err.textContent = "Invalid admin secret"; }
    });
    const lo = $("#admin-logout"), rf = $("#admin-refresh");
    if (lo) lo.addEventListener("click", async () => { await api("/api/admin/logout", { method: "POST" }); location.reload(); });
    if (rf) rf.addEventListener("click", loadUsers);
    const si = $("#admin-search");
    if (si) {
      let t = null;
      si.addEventListener("input", () => { clearTimeout(t); admPage = 1; t = setTimeout(loadUsers, 300); });
    }
    const ra = $("#admin-reset-all");
    if (ra) ra.addEventListener("click", async () => {
      if (!confirm("Reset usage for ALL users? This clears everyone's daily + patcher counters.")) return;
      await api("/api/admin/reset-usage-all", { method: "POST" });
      loadUsers();
    });
  }


  async function clientDetectHEVC(f) {
    try {
      if (!f || f.size < 4096) return false;
      const read = (s, e) => new Promise((res) => {
        const fr = new FileReader();
        fr.onload = () => res(new Uint8Array(fr.result));
        fr.onerror = () => res(new Uint8Array(0));
        fr.readAsArrayBuffer(f.slice(Math.max(0, s), e));
      });
      const toStr = (a) => {
        let s2 = ""; const CH = 8192;
        for (let i = 0; i < a.length; i += CH) s2 += String.fromCharCode.apply(null, a.subarray(i, Math.min(i + CH, a.length)));
        return s2;
      };
      const head = await read(0, Math.min(f.size, 4194304));
      const tail = await read(Math.max(0, f.size - 2621440), f.size);
      const hay = toStr(head) + toStr(tail);
      const hevc = hay.indexOf("hvc1") >= 0 || hay.indexOf("hev1") >= 0 || hay.indexOf("V_MPEGH/ISO/HEVC") >= 0;
      if (hevc && window.console) console.log("HEVC detected (client) — remuxed locally; GPU only starts if an encode is needed");
      return hevc;
    } catch (e) { return false; }
  }
  /* ── Admin: recent jobs (last hour, auto-cleared server-side) ─── */
  let _jobsTimer = null;
  function _jobEsc(v) {
    return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function _jobSize(mb) {
    mb = Number(mb) || 0;
    return mb >= 1024 ? (mb / 1024).toFixed(2) + " GB" : mb.toFixed(1) + " MB";
  }
  function initJobsPanel() {
    const panel = $("#admin-panel");
    if (!panel || document.getElementById("admin-jobs-wrap")) return;
    const wrap = el("div", "", "");
    wrap.id = "admin-jobs-wrap";
    wrap.style.cssText = "margin-top:26px;border-top:1px solid rgba(255,255,255,.08);padding-top:16px;";
    const head = el("div", "", "");
    head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;";
    const title = el("h3", "", "");
    title.style.cssText = "margin:0;font-size:12px;text-transform:uppercase;letter-spacing:.1em;opacity:.75;";
    title.textContent = "Recent jobs — last 5 minutes";
    const refresh = el("button", "btn btn-clear", "");
    refresh.textContent = "Refresh jobs";
    refresh.addEventListener("click", loadJobs);
    head.appendChild(title);
    head.appendChild(refresh);
    wrap.appendChild(head);
    const tw = el("div", "admin-table-wrap", "");
    tw.innerHTML = '<table class="admin-table"><thead><tr><th>Time (UTC)</th><th>Size</th><th>Codec</th><th>Container</th><th>User</th><th>Job</th><th>Result</th></tr></thead><tbody id="admin-jobs-tbody"></tbody></table>';
    wrap.appendChild(tw);
    const cap = el("div", "", "");
    cap.id = "admin-jobs-cap";
    cap.style.cssText = "font-size:11px;opacity:.55;margin:0 0 6px;";
    cap.textContent = "loading...";
    wrap.insertBefore(cap, tw);
    const note = el("p", "", "");
    note.style.cssText = "font-size:11px;opacity:.45;margin:8px 0 0;";
    note.textContent = "Shown: last 5 minutes. No GPU resources are used for this list.";
    wrap.appendChild(note);
    panel.appendChild(wrap);
    if (_jobsTimer) clearInterval(_jobsTimer);
    _jobsTimer = setInterval(() => {
      const p = $("#admin-panel");
      if (p && p.style.display !== "none") loadJobs();
    }, 10000);
  }
  async function loadJobs() {
    const tb = $("#admin-jobs-tbody");
    if (!tb) return;
    try {
      const r = await api("/api/admin/jobs", { cache: "no-store" });
      const body = (r && r.json) || r || {};
      const jobs = Array.isArray(body.jobs) ? body.jobs : [];
      const cap = document.getElementById("admin-jobs-cap");
      if (cap) cap.textContent = "refreshed " + new Date().toISOString().slice(11, 19) + " UTC | " + jobs.length + " job(s) in last 5 min";
      if (!r || !r.ok) {
        tb.innerHTML = '<tr><td colspan="7" style="opacity:.5">Jobs unavailable.</td></tr>';
        return;
      }
      if (!jobs.length) {
        tb.innerHTML = '<tr><td colspan="7" style="opacity:.5">No jobs in the last 5 minutes yet. Do a patch and it appears here within seconds.</td></tr>';
        return;
      }
      tb.innerHTML = jobs.slice().reverse().map((j) => {
        const t = j.ts ? new Date(j.ts).toISOString().slice(11, 19) : "-";
        const bad = j.result && j.result !== "ok";
        return '<tr><td>' + t + '</td><td>' + _jobSize(j.sizeMb) + '</td><td>' + _jobEsc(j.codec || "-") + '</td><td>' + _jobEsc(j.container || "-") + '</td><td>' + _jobEsc(j.user || "-") + '</td><td>' + _jobEsc(j.action || "-") + '</td><td style="color:' + (bad ? "#ff5c7c" : "#3ecf8e") + '">' + _jobEsc(bad ? (j.detail || j.result) : "done") + '</td></tr>';
      }).join("");
    } catch (e) {
      tb.innerHTML = '<tr><td colspan="7" style="opacity:.5">Failed to load jobs.</td></tr>';
    }
  }

  function ensurePager(pages, total) {
    const tbody = $("#admin-tbody");
    if (!tbody) return;
    let pg = $("#admin-pager");
    if (!pg) {
      pg = el("div", "", "");
      pg.id = "admin-pager";
      pg.style.cssText = "display:flex;gap:8px;align-items:center;margin-top:10px;flex-wrap:wrap;";
      const table = tbody.closest ? tbody.closest("table") : null;
      const host = table && table.parentNode ? table.parentNode : (tbody.parentNode || document.body);
      host.insertBefore(pg, table ? table.nextSibling : tbody.nextSibling);
    }
    pg.innerHTML = "";
    const mk = (label, fn, dis) => { const b = el("button", "btn btn-clear btn-xs", label); if (dis) b.disabled = true; else b.addEventListener("click", fn); return b; };
    pg.appendChild(mk("\u2039 Prev", () => { if (admPage > 1) { admPage--; loadUsers(); } }, admPage <= 1));
    const info = el("span", "dim", "Page " + admPage + " / " + pages + " \u00b7 " + total + " users");
    pg.appendChild(info);
    pg.appendChild(mk("Next \u203a", () => { if (admPage < pages) { admPage++; loadUsers(); } }, admPage >= pages));
    const sel = el("select", "admin-tier-select", [[25, "25 / page"], [50, "50 / page"], [100, "100 / page"]]
      .map(function (o) { return "<option value=\"" + o[0] + "\"" + (admPer === o[0] ? " selected" : "") + ">" + o[1] + "</option>"; }).join(""));
    sel.addEventListener("change", function () { admPer = parseInt(sel.value, 10) || 50; admPage = 1; loadUsers(); });
    pg.appendChild(sel);
  }

  async function loadUsers() {
    const tbody = $("#admin-tbody");
    const q = ($("#admin-search") && $("#admin-search").value.trim()) || "";
    const params = new URLSearchParams({ page: String(admPage), per_page: String(admPer) });
    if (q) params.set("q", q);
    const r = await api("/api/admin/users?" + params.toString(), { cache: "no-store" });
    if (!r || !r.ok) { if (tbody) tbody.innerHTML = '<tr><td colspan="5">Not authorized</td></tr>'; return; }
    const data = r.json || {};
    try {
    const users = Array.isArray(data) ? data : (data.users || []);
    const total = data.total != null ? data.total : users.length;
    const pages = data.pages != null ? data.pages : 1;
    if (admPage > pages) { admPage = Math.max(1, pages); return loadUsers(); }
    if ($("#admin-count")) {
      if (total === 0) $("#admin-count").textContent = "0 users";
      else if (total > admPer) $("#admin-count").textContent = total + " users \u2014 showing " + ((admPage - 1) * admPer + 1) + "\u2013" + Math.min(total, admPage * admPer);
      else $("#admin-count").textContent = total + " users";
    }
    if (tbody) {
      tbody.innerHTML = "";
      users.forEach((u) => {
        const tr = el("tr", "");
        const tierNames = ["member", "booster", "donor"];
        const sel = el("select", "admin-tier-select",
          tierNames.map((t) => `<option value="${t}" ${(u.tier_override || u.tier) === t ? "selected" : ""}>${({member:"Free",booster:"Booster",donor:"Premium"})[t]}</option>`).join("") +
          `<option value="" ${!(u.tier_override || u.tier) ? "selected" : ""}>auto</option>`);
        sel.addEventListener("change", async () => {
          await api("/api/admin/tier", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discord_id: u.discord_id, tier: sel.value || null }) });
          loadUsers();
        });
        tr.appendChild(el("td", "", "<b>" + esc(u.username) + "</b><br><span class='dim'>" + esc(u.discord_id) + "</span>"));
        tr.appendChild(el("td", "mono", fmt(u.today_patches || 0)));
        tr.appendChild(el("td", "", sel.outerHTML));
        tr.appendChild(el("td", "mono dim", new Date(u.created_at).toLocaleDateString()));
        const td = el("td", "", "");
        const del = el("button", "btn btn-clear btn-xs", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>Delete');
        del.addEventListener("click", async () => {
          if (!confirm("Delete " + u.username + "?")) return;
          await api("/api/admin/user/" + encodeURIComponent(u.discord_id), { method: "DELETE" });
          loadUsers();
        });
        const reset = el("button", "btn btn-clear btn-xs", '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 4v6h6"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>Reset usage');
        reset.addEventListener("click", async () => {
          if (!confirm("Reset optimization usage for " + u.username + "?")) return;
          await api("/api/admin/reset-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ discord_id: u.discord_id }) });
          loadUsers();
        });
        td.appendChild(reset);
        td.appendChild(del);
        tr.appendChild(td);
        tbody.appendChild(tr);
      });
    }
    ensurePager(pages, total);
    } catch (err) {
      console.error("loadUsers failed:", err);
      if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="color:#ef4444">Failed to load users: ' + (err && err.message ? err.message : err) + '</td></tr>';
    }
  }

  /* ── TIERS page ══════════════════════════════════════════════ */
  function initTiers() {
    api("/api/health").then((h) => { API_DISCORD = !!(h && h.json && h.json.discordConfigured); });
    api("/api/me").then((m) => {
      const { user } = normalizeMe(m && m.json);
      renderAuth(user, false);
      if (user && user.tier) {
        $$('.view[data-view="tiers"] .tier-card').forEach((c) => c.classList.toggle("mine", c.dataset.tier === user.tier.tier));
        const b = $("#tier-cta");
        if (b) { b.textContent = user.tier.tierLabel + " — Active"; b.classList.add("active"); }
      }
    });
  }

  /* ── Discord logo + login popup ────────────────────────────── */
  const DISCORD_SVG = '<svg class="dl-logo" viewBox="0 0 127.14 96.36" aria-hidden="true"><path fill="currentColor" d="M107.7 8.07A105.15 105.15 0 0 0 81.47 0a72.06 72.06 0 0 0-3.36 6.83 97.68 97.68 0 0 0-29.11 0A72.37 72.37 0 0 0 45.64 0 105.89 105.89 0 0 0 19.39 8.09C2.79 32.65-1.71 56.6.54 80.21h0A105.73 105.73 0 0 0 32.71 96.36a77.7 77.7 0 0 0 6.89-11.11 68.42 68.42 0 0 1-10.85-5.18c.91-.66 1.8-1.34 2.66-2a75.57 75.57 0 0 0 64.32 0c.87.71 1.76 1.39 2.66 2a68.68 68.68 0 0 1-10.87 5.19 77 77 0 0 0 6.89 11.1A105.25 105.25 0 0 0 126.6 80.22h0C129.24 52.84 122.09 29.11 107.7 8.07ZM42.45 65.69C36.18 65.69 31 60 31 53s5-12.74 11.43-12.74S54 46 53.89 53 48.84 65.69 42.45 65.69Zm42.24 0C78.41 65.69 73.25 60 73.25 53s5-12.74 11.45-12.74S96.23 46 96.12 53 91.08 65.69 84.69 65.69Z"/></svg>';
  // inject the logo into every [data-discord] element
  document.querySelectorAll("[data-discord]").forEach((el) => {
    if (!el.querySelector(".dl-logo")) el.insertAdjacentHTML("afterbegin", DISCORD_SVG);
  });

  let API_DISCORD = true; // /api/health → discordConfigured
  function openLogin() {
    // Same-tab login redirect (no popup): the server-side OAuth endpoint
    // sets the CSRF state cookie and redirects to Discord; the callback
    // lands back on the site with a session. Client-built authorize URLs
    // cannot work — the callback requires the server's state cookie.
    // Pass the current view (hash) through so the callback returns here
    // instead of dumping the user back at the dashboard.
    const ret = (location.pathname || "/") + (location.search || "");
    location.href = "/api/discord?action=login&return=" + encodeURIComponent(ret);
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("#btn-login, [data-login]");
    if (t) { e.preventDefault(); openLogin(); }
  });

  /* ── SPA router (single index.html, clean-path views via History API) ──
     Routes are plain paths (/patcher, /tiers, …) — vercel.json rewrites each
     of them to this same index.html. We intercept clicks on same-page route
     links and use pushState so the URL never grows a "#/" hash. Legacy
     "#/patcher"-style links (old bookmarks/shares) still resolve correctly
     via the hash fallback below, and get silently upgraded to the clean
     path on load. */
  const VIEWS = ["dashboard", "patcher", "analytics", "tiers", "howto", "admin", "login"];
  const INIT = {}; // per-view init ran flag

  function currentView() {
    const h = (location.hash || "").replace(/^#\/?/, "").split("?")[0].split("/")[0];
    if (h && VIEWS.includes(h)) return h;
    const p = (location.pathname || "/").replace(/^\/+/, "").split("/")[0];
    return VIEWS.includes(p) ? p : "dashboard";
  }

  function pathFor(view) { return view === "dashboard" ? "/" : "/" + view; }

  function navigate(path, replace) {
    try { (replace ? history.replaceState : history.pushState).call(history, {}, "", path); }
    catch { location.href = path; return; }
    showView(currentView());
  }

  function isRouteHref(href) {
    if (!href || /^(https?:)?\/\//.test(href) || href.startsWith("/api/") || href.startsWith("#")) return false;
    const seg = href.replace(/^\/+/, "").split(/[?#]/)[0].split("/")[0];
    return href === "/" || VIEWS.includes(seg);
  }

  document.addEventListener("click", (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest("a[href]");
    if (!a || a.target === "_blank" || a.hasAttribute("data-discord-link") || a.hasAttribute("data-login")) return;
    const href = a.getAttribute("href");
    if (!isRouteHref(href)) return;
    // Multi-page mode: rewrite to the real .html file and let the browser
    // navigate — no pushState, no rewrites needed, refresh-proof on any host.
    const view = href === "/" ? "dashboard" : href.replace(/^\/+/, "").split(/[?#]/)[0].split("/")[0];
    a.href = pathFor(view);
  });

  function showView(name) {
    if (!VIEWS.includes(name)) name = "dashboard";
    $$(".view").forEach((v) => v.classList.toggle("active", v.dataset.view === name));
    $$("[data-nav]").forEach((a) => a.classList.toggle("active", a.dataset.nav === name));
    document.body.dataset.page = name;

    if (!INIT[name]) {
      INIT[name] = true;
      if (name === "dashboard") initDashboard();
      if (name === "patcher") initPatcher();
      if (name === "analytics") initAnalytics();
      if (name === "admin") initAdmin();
      if (name === "tiers") initTiers();
      if (name === "login") initLoginView();
    }
    initReveal(); // re-observe .reveal elements in the newly shown view
    window.scrollTo(0, 0);
  }

  function initLoginView() {
    // Direct #/login access: bounce logged-in users home, otherwise send
    // them straight into the server-side Discord OAuth flow.
    api("/api/me").then((m) => {
      const { user } = normalizeMe(m && m.json);
      if (user) { location.replace("/"); return; }
      location.replace("/api/discord?action=login");
    });
  }

  window.addEventListener("popstate", () => showView(currentView()));

  /* ── login error banner ───────────────────────────────────────
     The OAuth callback redirects back with ?login_error=<code> on failure.
     Previously nothing on the page rendered this, so a failed login silently
     dumped the user back at the "Login with Discord" button — the endless
     re-login loop. Show a clear, dismissible banner explaining what happened.
     Note: with auto-join active, non-members are added to the server during
     login, so this banner only appears in real failure cases (e.g. the user
     un-checked "Join server" on Discord's consent screen). */
  const LOGIN_ERROR_MSG = {
    not_in_server:        "You must be in the Discord server to log in.",
    join_declined:        'You un-checked "Join server" on the Discord screen. Log in again and leave it checked so we can add you to the server.',
    join_failed:          "We could not add you to the Discord server right now (is it full?). Please try again, or join manually below.",
    invalid_state:        "Login session expired — please try again.",
    missing_params:       "Login session expired — please try again.",
    token_exchange_failed: "Discord authorization failed — please try again.",
    user_fetch_failed:    "Could not load your Discord profile — please try again.",
    oauth_failed:         "Login failed — please try again.",
    access_denied:        "You cancelled the Discord login. Click below when you are ready.",
  };
  function showLoginErrorBanner() {
    const code = new URLSearchParams(location.search).get("login_error");
    if (!code) return;
    const msg = LOGIN_ERROR_MSG[code] || "Login failed — please try again.";
    const box = el("div", "", "");
    box.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#7c3aed;color:#fff;padding:12px 18px;font:600 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;text-align:center;box-shadow:0 4px 18px rgba(0,0,0,.4);";
    let links = '<a href="/api/discord?action=login" style="color:#fff;font-weight:800;text-decoration:underline;margin-left:10px;white-space:nowrap;">Log in again</a>';
    if ((code === "not_in_server" || code === "join_failed") && window.RTX && window.RTX.DISCORD_INVITE) {
      links += '<a href="' + esc(window.RTX.DISCORD_INVITE) + '" target="_blank" rel="noopener" style="color:#fff;font-weight:800;text-decoration:underline;margin-left:12px;white-space:nowrap;">Join server</a>';
    }
    box.innerHTML = "<span>" + esc(msg) + "</span>" + links +
      '<button type="button" aria-label="Dismiss" style="margin-left:12px;background:none;border:none;color:#fff;font-size:18px;cursor:pointer;line-height:1;vertical-align:middle;">&times;</button>';
    document.body.prepend(box);
    box.querySelector("button").addEventListener("click", () => {
      box.remove();
      try { history.replaceState({}, "", location.pathname); } catch {}
    });
  }

  /* ── boot ───────────────────────────────────────────────────── */
  function boot() {
    // Drop any stale cached auth response left over from a previous page
    // load (sessionStorage persists across the OAuth round-trip).
    try {
      const stale = ["/api/me"];
      stale.forEach((k) => sessionStorage.removeItem("rtxcache:" + k));
    } catch {}
    initReveal();
    showLoginErrorBanner();
    const v = window.__VIEW__ || currentView();
    // Legacy "#/tiers" bookmark/share link → silently upgrade to the clean
    // path so the hash never lingers in the address bar.
    if (location.hash) {
      try { history.replaceState({}, "", pathFor(v) + (location.search || "")); } catch {}
    }
    showView(v);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();

/* ═══════════════════════════════════════════════════════════════
   Payment badges — injected into the footer of every page.
   Renders a row of white "accepted payment method" buttons above
   the footer bottom bar (Visa, Mastercard, Apple Pay, Google Pay,
   Amazon Pay, PayPal, Crypto, Revolut, Wise, Remitly, Bank transfer).
   ═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  var G = {
    google: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
    crypto: '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" style="overflow:visible"><path d="M16 8a6 6 0 1 0 0 8" stroke="#F7931A" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M10 4v4M13 4v4M10 16v4M13 16v4" stroke="#F7931A" stroke-width="2" stroke-linecap="round"/></svg>',
    bank: '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true"><path d="M12 2.5 2 8.5h20L12 2.5z" fill="#1a1a1a"/><rect x="6.5" y="10.5" width="2.2" height="7" fill="#1a1a1a"/><rect x="10.9" y="10.5" width="2.2" height="7" fill="#1a1a1a"/><rect x="15.3" y="10.5" width="2.2" height="7" fill="#1a1a1a"/><rect x="3.5" y="17.5" width="17" height="2.6" rx="0.8" fill="#1a1a1a"/></svg>'
  };

  var IMG = "assets/payments/";

  var BADGES = [
    ["Visa", '<span class="pv-visa">VISA</span>'],
    ["Mastercard", '<img class="pv-img" src="' + IMG + 'mastercard.jpg" alt="Mastercard">'],
    ["PayPal", '<span class="pv-paypal"><b class="c1">Pay</b><b class="c2">Pal</b></span>'],
    ["Apple Pay", '<img class="pv-img" src="' + IMG + 'apple-pay.jpg" alt="Apple Pay">'],
    ["Google Pay", G.google + "<b>Pay</b>"],
    ["Amazon Pay", '<img class="pv-img" src="' + IMG + 'amazon-pay.jpg" alt="Amazon Pay">'],
    ["Crypto", G.crypto + "<b>CRYPTO</b>"],
    ["Revolut", '<b class="pv-revolut">Revolut</b>'],
    ["Wise", '<img class="pv-img" src="' + IMG + 'wise.jpg" alt="Wise">'],
    ["Remitly", '<img class="pv-img" src="' + IMG + 'remitly.jpg" alt="Remitly">'],
    ["Bank transfer", G.bank + "<b>Bank transfer</b>"]
  ];

  function injectPayments() {
    var footer = document.querySelector(".site-footer");
    if (!footer || document.querySelector(".footer-payments")) return;
    var box = document.createElement("div");
    box.className = "footer-payments";
    var h = document.createElement("h4");
    h.textContent = "We accept";
    var row = document.createElement("div");
    row.className = "pay-badges";
    BADGES.forEach(function (b) {
      var s = document.createElement("span");
      s.className = "pay-badge";
      s.title = b[0];
      s.setAttribute("aria-label", b[0]);
      s.innerHTML = b[1];
      row.appendChild(s);
    });
    box.appendChild(h);
    box.appendChild(row);
    var bottom = footer.querySelector(".footer-bottom");
    footer.insertBefore(box, bottom);
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", injectPayments);
  else injectPayments();
})();