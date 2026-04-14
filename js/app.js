// Vue app shell — screen routing, pack loading, glue
import { createGameEngine } from './game.js';
import { soundOn, toggleSound } from './sounds.js';
import {
  loadIdentity, ensurePlayer, claimPlayer, setDisplayName, clearIdentity, createPlayer, validateIdentity,
} from './identity.js';
import {
  submitScore, fetchPuzzleLeaderboard, fetchGlobalLeaderboard, fetchPlayerScores, fetchPuzzleSummary,
} from './leaderboard.js';
import { fakeName, publicNameFor } from './fakename.js';

const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

createApp({
  setup() {
    // --- Screen state ---
    const currentScreen = ref('home');  // 'home' | 'picker' | 'setup' | 'puzzle' | 'leaderboard' | 'settings' | 'admin'

    // Scroll to top on screen change
    watch(currentScreen, () => window.scrollTo(0, 0));

    // --- History / back button support ---
    let suppressPopState = false;

    function navigateTo(screen) {
      currentScreen.value = screen;
      history.pushState({ screen }, '', '');
    }

    function handlePopState(e) {
      if (suppressPopState) { suppressPopState = false; return; }
      const target = (e.state && e.state.screen) || 'home';
      // Leaving a puzzle preserves saved state so it can be resumed from home.
      // Only clear on completion (nothing left to resume).
      if (currentScreen.value === 'puzzle') {
        if (game.won.value) localStorage.removeItem('jigsaw_state');
        clearUrlParams();
      }
      currentScreen.value = target;
    }

    // --- Pack state ---
    const packs = ref([]);
    const currentPack = ref(null);
    const selectedImage = ref('');
    const selectedImageDims = ref(null); // { w, h } for piece count computation

    // --- Game engine ---
    const game = createGameEngine();

    // Current image display name
    const imageName = computed(() => {
      if (!currentPack.value) return '';
      return currentPack.value.names?.[game.imgSrc.value] || '';
    });

    // Victory video lookup
    const victoryVideo = computed(() => {
      if (!currentPack.value) return null;
      return currentPack.value.videos[game.imgSrc.value] || null;
    });

    // --- Pack loading ---
    async function loadPacks() {
      try {
        const res = await fetch('/api/packs');
        packs.value = await res.json();
      } catch (e) {
        console.warn('Failed to load packs:', e);
        packs.value = [];
      }
    }

    function selectPack(packName) {
      const pack = packs.value.find(p => p.name === packName);
      if (pack) {
        currentPack.value = pack;
        game.packMult.value = pack.difficulty || 1.0;
        localStorage.setItem('jigsaw_pack', packName);
      }
    }

    // Keep packMult in sync if currentPack is set before packs load / on restore
    watch(currentPack, (p) => {
      if (p) game.packMult.value = p.difficulty || 1.0;
    });

    // --- Thumbnails ---
    function thumb(pack, img) {
      return (pack.thumbnails && pack.thumbnails[img]) || img;
    }

    // --- Pack card preview images ---
    function packPreviewImages(pack) {
      return pack.images.slice(0, 4);
    }

    // --- Screen navigation ---
    function clearUrlParams() {
      const url = new URL(window.location);
      url.search = '';
      history.replaceState(history.state, '', url);
    }

    function goHome() {
      navigateTo('home');
      clearUrlParams();
    }

    function selectPackAndGo(pack) {
      selectPack(pack.name);
      navigateTo('picker');
    }

    function selectImageAndGo(img) {
      selectedImage.value = img;
      selectedImageDims.value = null;
      const imgEl = new Image();
      imgEl.onload = () => {
        selectedImageDims.value = { w: imgEl.naturalWidth, h: imgEl.naturalHeight };
      };
      imgEl.src = img;
      loadPuzzleSummary(currentPack.value?.name, img);
      navigateTo('setup');
    }

    // Compute rows for a given column count using image dimensions
    function rowsForCols(cols) {
      if (!selectedImageDims.value) return null;
      const aspect = selectedImageDims.value.h / selectedImageDims.value.w;
      return Math.max(Math.round(cols * aspect), 2);
    }

    // Compute piece count for a given column count using image dimensions
    function pieceCountForCols(cols) {
      const rows = rowsForCols(cols);
      return rows == null ? '...' : cols * rows;
    }

    // --- Puzzle summary (setup screen stats) ---
    const puzzleSummary = ref(null); // { variants: [...], mine: [...] } | null

    async function loadPuzzleSummary(packName, image) {
      puzzleSummary.value = null;
      if (!packName || !image) return;
      try {
        const data = await fetchPuzzleSummary({
          pack: packName, image,
          code: identity.value?.code,
        });
        // Ignore if user already moved on to another image
        if (selectedImage.value === image) puzzleSummary.value = data;
      } catch (e) {
        console.warn('puzzle summary fetch failed:', e);
      }
    }

    function summaryFor(cols) {
      if (!puzzleSummary.value) return null;
      const rows = rowsForCols(cols);
      if (rows == null) return null;
      const top = puzzleSummary.value.variants.find(v => v.cols === cols && v.rows === rows);
      const mine = puzzleSummary.value.mine.find(m => m.cols === cols && m.rows === rows);
      if (!top && !mine) return null;
      return { top: top?.top || null, plays: top?.plays || 0, mine: mine || null };
    }

    function openSetupLeaderboard(cols) {
      const rows = rowsForCols(cols);
      if (rows == null || !currentPack.value) return;
      openLeaderboard({
        pack: currentPack.value.name,
        image: selectedImage.value,
        rows, cols,
      });
    }

    // Open leaderboard for the currently previewed image. Pick the variant
    // with the most recorded plays if we know about one, otherwise default
    // to 6×… (Medium) so there's always something to show.
    function openImageLeaderboard() {
      if (!currentPack.value || !selectedImage.value) return;
      const variants = puzzleSummary.value?.variants || [];
      let pick = null;
      for (const v of variants) {
        if (!pick || (v.plays || 0) > (pick.plays || 0)) pick = v;
      }
      const cols = pick ? pick.cols : 6;
      const rows = pick ? pick.rows : rowsForCols(6);
      if (rows == null) return;
      openLeaderboard({
        pack: currentPack.value.name,
        image: selectedImage.value,
        rows, cols,
      });
    }

    // Display name for the image currently loaded on the setup screen.
    const selectedImageName = computed(() => {
      if (!currentPack.value || !selectedImage.value) return '';
      return currentPack.value.names?.[selectedImage.value] || '';
    });

    // m:ss timer label for the puzzle toolbar.
    const liveTimeLabel = computed(() => {
      const s = game.liveSeconds.value | 0;
      const m = Math.floor(s / 60);
      const r = s % 60;
      return `${m}:${String(r).padStart(2, '0')}`;
    });

    const placedTotal = computed(() => game.tiles.length);
    const progressPct = computed(() => {
      const t = placedTotal.value;
      return t ? Math.round((game.placedCount.value / t) * 100) : 0;
    });

    // --- Resume / Continue ---
    // Snapshot of any unfinished puzzle in localStorage, surfaced on the home
    // screen so returning players can jump back in without re-navigating.
    const resumable = ref(null);

    function refreshResumable() {
      try {
        const raw = localStorage.getItem('jigsaw_state');
        if (!raw) { resumable.value = null; return; }
        const s = JSON.parse(raw);
        if (!s || !s.img || !s.grid || !s.rows || !s.cols) { resumable.value = null; return; }
        // Find which pack this image belongs to
        const pack = packs.value.find(p => p.images.includes(s.img));
        if (!pack) { resumable.value = null; return; }
        // Skip if the puzzle is already solved (all tiles in true position)
        const total = s.rows * s.cols;
        const solved = Array.isArray(s.grid) && s.grid.length === total
          && s.grid.every((tid, idx) => tid === idx);
        if (solved) { resumable.value = null; return; }
        // Count tiles currently in their correct position
        let placed = 0;
        for (let i = 0; i < total; i++) if (s.grid[i] === i) placed++;
        resumable.value = {
          pack, image: s.img, rows: s.rows, cols: s.cols,
          moves: s.moveCount || 0, placed, total,
          name: pack.names?.[s.img] || '',
          thumb: pack.thumbnails?.[s.img] || s.img,
        };
      } catch (e) {
        resumable.value = null;
      }
    }

    async function resumePuzzle() {
      const r = resumable.value;
      if (!r) return;
      selectPack(r.pack.name);
      selectedImage.value = r.image;
      await game.loadImageDimensions(r.image);
      if (game.restoreState()) {
        navigateTo('puzzle');
        updatePuzzleParam();
        nextTick(game.computeScale);
      }
    }

    // Refresh resumable whenever we land on home (puzzle may have been
    // abandoned or completed since last visit).
    watch(currentScreen, (s) => {
      if (s === 'home') refreshResumable();
    });

    async function startPuzzle(cols) {
      await game.startGame(selectedImage.value, cols);
      navigateTo('puzzle');
      updatePuzzleParam();
      nextTick(game.computeScale);
    }

    // --- Confirmation for leaving puzzle ---
    // pendingAction: { message, confirmLabel, run } | null
    const pendingAction = ref(null);

    function confirmGoHome() {
      // Preserve the saved puzzle so the home screen can offer a Resume card.
      // Only clear state when the puzzle has been won (nothing to resume).
      if (game.won.value) localStorage.removeItem('jigsaw_state');
      goHome();
    }

    function confirmNewPuzzle() {
      if (game.moveCount.value > 0 && !game.won.value) {
        pendingAction.value = {
          message: 'Start a new puzzle? Your current progress will be discarded.',
          confirmLabel: 'Discard & continue',
          run: () => {
            localStorage.removeItem('jigsaw_state');
            navigateTo('picker');
          },
        };
      } else {
        localStorage.removeItem('jigsaw_state');
        navigateTo('picker');
      }
    }

    function confirmYes() {
      const action = pendingAction.value;
      pendingAction.value = null;
      if (action && action.run) action.run();
    }

    // --- Mobile menu ---
    const menuOpen = ref(false);

    // --- Settings panel (desktop) ---
    const settingsOpen = ref(false);

    // --- Resize handler ---
    function onResize() { game.computeScale(); }
    function preventGesture(e) { e.preventDefault(); }

    // --- URL params ---
    const urlParams = new URLSearchParams(window.location.search);

    function updatePuzzleParam() {
      const images = currentPack.value ? currentPack.value.images : [];
      const num = images.indexOf(game.imgSrc.value) + 1;
      const url = new URL(window.location);
      url.searchParams.set('puzzle', num);
      url.searchParams.set('cols', game.sliderCols.value);
      if (currentPack.value) url.searchParams.set('pack', currentPack.value.name);
      history.replaceState(history.state, '', url);
    }

    // --- Identity ---
    const identity = ref(loadIdentity()); // { code, displayName } | null

    // --- Player completion map ---
    // bestByImage: `${pack}|${image}` -> highest stored score for this player,
    // used to mark finished images on the picker grid. Refreshed whenever we
    // have a known identity (boot, after win, after claim/signout).
    const bestByImage = ref(new Map());

    async function refreshPlayerCompletion() {
      if (!identity.value) { bestByImage.value = new Map(); return; }
      try {
        const data = await fetchPlayerScores(identity.value.code, 500);
        const map = new Map();
        for (const s of (data.scores || [])) {
          const key = `${s.pack}|${s.image}`;
          const prev = map.get(key);
          if (prev == null || s.score > prev) map.set(key, s.score);
        }
        bestByImage.value = map;
      } catch (e) {
        console.warn('completion fetch failed:', e);
      }
    }

    function bestScoreFor(packName, image) {
      const v = bestByImage.value.get(`${packName}|${image}`);
      return v == null ? null : v;
    }

    watch(identity, () => refreshPlayerCompletion());

    // --- Win → submit score ---
    let submittingScore = false;
    async function submitScoreFor(player) {
      const snap = game.getCompletionSnapshot();
      return submitScore({
        code: player.code,
        pack: currentPack.value ? currentPack.value.name : '',
        image: snap.image,
        rows: snap.rows,
        cols: snap.cols,
        moves: snap.moves,
        durationMs: snap.durationMs,
        clientStartedAt: snap.clientStartedAt,
        handicaps: {},
      });
    }
    watch(() => game.won.value, async (isWon) => {
      if (!isWon || submittingScore) return;
      if (game.scoreSubmitted.value) return;   // already recorded for this game session
      submittingScore = true;
      try {
        let player = identity.value || await ensurePlayer();
        identity.value = player;
        try {
          game.winResult.value = await submitScoreFor(player);
        } catch (e) {
          // Server says our stored code isn't in its DB (e.g. DB was reset).
          // Mint a fresh code transparently and retry once.
          if (/unknown code/i.test(e.message || '')) {
            console.warn(`score submit rejected for ${player.code} — reissuing code`);
            clearIdentity();
            player = await createPlayer();
            identity.value = player;
            game.winResult.value = await submitScoreFor(player);
          } else {
            throw e;
          }
        }
        game.scoreSubmitted.value = true;
        game.saveState();    // persist the flag so a reload doesn't re-submit
      } catch (e) {
        console.warn('score submit failed:', e);
        game.winResult.value = { error: e.message || String(e) };
      } finally {
        submittingScore = false;
      }
      refreshPlayerCompletion();
    });

    // --- Leaderboard screen ---
    const leaderboardTab = ref('puzzle'); // 'puzzle' | 'global' | 'me'
    const leaderboardLoading = ref(false);
    const puzzleBoard = ref([]);
    const globalBoard = ref([]);
    const myScores = ref([]);
    const leaderboardContext = ref(null); // { pack, image, rows, cols } snapshot for 'puzzle' tab

    const leaderboardError = ref('');
    async function refreshLeaderboard() {
      leaderboardLoading.value = true;
      leaderboardError.value = '';
      try {
        if (leaderboardTab.value === 'puzzle' && leaderboardContext.value) {
          const ctx = leaderboardContext.value;
          puzzleBoard.value = await fetchPuzzleLeaderboard(ctx);
        } else if (leaderboardTab.value === 'global') {
          globalBoard.value = await fetchGlobalLeaderboard(50);
        } else if (leaderboardTab.value === 'me' && identity.value) {
          const data = await fetchPlayerScores(identity.value.code, 50);
          myScores.value = data.scores || [];
        }
      } catch (e) {
        console.warn('leaderboard fetch failed:', e);
        leaderboardError.value = friendlyError(e, {
          'not found': 'Your code is not recognized — try signing out and playing again.',
          default: 'Could not load leaderboard. Check your connection and try again.',
        });
      } finally {
        leaderboardLoading.value = false;
      }
    }

    watch(leaderboardTab, () => refreshLeaderboard());

    function openLeaderboard(context) {
      if (context) {
        leaderboardContext.value = context;
        leaderboardTab.value = 'puzzle';
      } else {
        leaderboardContext.value = null;
        leaderboardTab.value = 'global';
      }
      navigateTo('leaderboard');
      refreshLeaderboard();
    }

    function openLeaderboardFromVictory() {
      openLeaderboard({
        pack: currentPack.value ? currentPack.value.name : '',
        image: game.imgSrc.value,
        rows: game.ROWS.value,
        cols: game.COLS.value,
      });
    }

    // --- Settings screen ---
    const settingsNameInput = ref('');
    const settingsClaimInput = ref('');
    const settingsStatus = ref({ kind: '', message: '' }); // kind: 'error' | 'success' | ''

    function setStatus(kind, message) {
      settingsStatus.value = { kind, message };
    }

    // Map known server errors to human-friendly messages. Pass a `map` of
    // lowercase-substring → replacement, and a `default` fallback.
    function friendlyError(e, map) {
      const raw = String(e?.message || e || '').toLowerCase();
      for (const key of Object.keys(map)) {
        if (key !== 'default' && raw.includes(key.toLowerCase())) return map[key];
      }
      return map.default || String(e?.message || e || 'Something went wrong');
    }

    function openSettings() {
      settingsNameInput.value = identity.value?.displayName || '';
      settingsClaimInput.value = '';
      codeCopyStatus.value = '';
      setStatus('', '');
      navigateTo('settings');
    }

    const codeCopyStatus = ref('');
    async function copyCode() {
      if (!identity.value?.code) return;
      try {
        await navigator.clipboard.writeText(identity.value.code);
        codeCopyStatus.value = 'Copied!';
      } catch (e) {
        codeCopyStatus.value = 'Copy failed';
      }
      setTimeout(() => { codeCopyStatus.value = ''; }, 1800);
    }

    async function saveDisplayName() {
      setStatus('', '');
      try {
        if (!identity.value) identity.value = await ensurePlayer();
        const updated = await setDisplayName(identity.value.code, settingsNameInput.value.trim());
        identity.value = updated;
        setStatus('success', 'Name saved.');
      } catch (e) {
        setStatus('error', friendlyError(e, {
          'name locked':    'This name is locked by an admin and can\'t be changed. Get in touch if that\'s a mistake.',
          'invalid name':   'Name is invalid. Keep it under 20 characters and avoid weird control chars.',
          'not found':      'Your code is not recognized by the server. Try signing out and playing again.',
          default:          'Could not save name. Try again in a moment.',
        }));
      }
    }

    function signOut() {
      if (!identity.value) return;
      const code = identity.value.code;
      if (!confirm(`Forget ${code} on this device? Your scores stay on the server; you can claim the code back anytime.`)) return;
      clearIdentity();
      identity.value = null;
      settingsNameInput.value = '';
      settingsClaimInput.value = '';
      setStatus('success', `Signed out of ${code}.`);
    }

    async function claimCode() {
      setStatus('', '');
      const raw = settingsClaimInput.value.trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(raw)) {
        setStatus('error', 'Codes are 6 letters (A–Z).');
        return;
      }
      try {
        const mergeFrom = identity.value?.code;
        const player = await claimPlayer(raw, mergeFrom && mergeFrom !== raw ? mergeFrom : undefined);
        identity.value = player;
        settingsNameInput.value = player.displayName || '';
        settingsClaimInput.value = '';
        setStatus('success', mergeFrom && mergeFrom !== raw
          ? `Claimed ${raw} and merged scores from ${mergeFrom}.`
          : `Claimed ${raw}.`);
      } catch (e) {
        setStatus('error', friendlyError(e, {
          'not found':   `No player with code ${raw}. Codes are issued by the server the first time you finish a puzzle — you can't invent one.`,
          'invalid code': 'That doesn\'t look like a valid code. Codes are 6 letters.',
          default:       'Could not claim that code. Check it and try again.',
        }));
      }
    }

    // --- Admin screen ---
    const adminToken = ref(sessionStorage.getItem('jigsaw_admin_token') || '');
    const adminPlayers = ref([]);
    const adminStatus = ref('');
    const adminSearch = ref('');

    function adminHeaders() {
      return adminToken.value ? { 'x-admin-token': adminToken.value } : {};
    }

    async function adminLoad() {
      adminStatus.value = '';
      try {
        const q = adminSearch.value ? `?search=${encodeURIComponent(adminSearch.value)}` : '';
        const res = await fetch(`/api/admin/players${q}`, { headers: adminHeaders() });
        if (res.status === 401) { adminStatus.value = 'Unauthorized — check token'; return; }
        adminPlayers.value = await res.json();
      } catch (e) {
        adminStatus.value = e.message;
      }
    }

    function openAdmin() {
      if (adminToken.value) sessionStorage.setItem('jigsaw_admin_token', adminToken.value);
      navigateTo('admin');
      adminLoad();
    }

    function saveAdminToken() {
      sessionStorage.setItem('jigsaw_admin_token', adminToken.value);
      adminLoad();
    }

    async function adminRename(code) {
      const name = prompt(`New display name for ${code} (blank to clear)`, '');
      if (name === null) return;
      const res = await fetch(`/api/admin/players/${code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ displayName: name || null }),
      });
      if (!res.ok) { adminStatus.value = `Rename failed (${res.status})`; return; }
      adminLoad();
    }

    async function adminToggleLock(player) {
      const res = await fetch(`/api/admin/players/${player.code}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', ...adminHeaders() },
        body: JSON.stringify({ nameLocked: !player.name_locked }),
      });
      if (!res.ok) { adminStatus.value = `Lock toggle failed (${res.status})`; return; }
      adminLoad();
    }

    async function adminDelete(code) {
      if (!confirm(`Delete player ${code} and all their scores?`)) return;
      const res = await fetch(`/api/admin/players/${code}`, {
        method: 'DELETE',
        headers: adminHeaders(),
      });
      if (!res.ok) { adminStatus.value = `Delete failed (${res.status})`; return; }
      adminLoad();
    }

    async function adminRecompute() {
      if (!confirm('Recompute all scores from raw inputs?')) return;
      const res = await fetch('/api/admin/recompute', {
        method: 'POST', headers: adminHeaders(),
      });
      if (!res.ok) { adminStatus.value = `Recompute failed (${res.status})`; return; }
      const data = await res.json();
      adminStatus.value = `Recomputed ${data.updated} scores`;
      adminLoad();
    }

    function formatRelative(when) {
      if (when == null) return '';
      const then = typeof when === 'number' ? when : Date.parse(when);
      if (!Number.isFinite(then)) return '';
      const diffSec = Math.max(0, Math.round((Date.now() - then) / 1000));
      if (diffSec < 60) return 'just now';
      const diffMin = Math.round(diffSec / 60);
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.round(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      const diffDay = Math.round(diffHr / 24);
      if (diffDay < 7) return `${diffDay}d ago`;
      if (diffDay < 30) return `${Math.round(diffDay / 7)}w ago`;
      if (diffDay < 365) return `${Math.round(diffDay / 30)}mo ago`;
      return `${Math.round(diffDay / 365)}y ago`;
    }

    function formatDuration(ms) {
      const s = Math.floor(ms / 1000);
      const m = Math.floor(s / 60);
      const r = s % 60;
      return m ? `${m}m${String(r).padStart(2,'0')}s` : `${r}s`;
    }

    function packLabelFor(packName) {
      const p = packs.value.find(pp => pp.name === packName);
      return p ? p.label : packName;
    }

    function imageNameFor(packName, image) {
      const p = packs.value.find(pp => pp.name === packName);
      if (!p) return image;
      if (p.names && p.names[image]) return p.names[image];
      // Fallback: strip path + extension, humanize
      const base = image.split('/').pop().replace(/\.[^.]+$/, '');
      return base.replace(/_/g, ' ');
    }

    function imageThumbFor(packName, image) {
      const p = packs.value.find(pp => pp.name === packName);
      if (!p) return image;
      return (p.thumbnails && p.thumbnails[image]) || image;
    }

    // Does the current pack have an image after the one just finished?
    const hasNextImage = computed(() => {
      if (!currentPack.value) return false;
      const imgs = currentPack.value.images || [];
      const idx = imgs.indexOf(game.imgSrc.value);
      return idx >= 0 && idx < imgs.length - 1;
    });

    async function replayCurrent() {
      if (!game.imgSrc.value) return;
      localStorage.removeItem('jigsaw_state');
      await game.startGame(game.imgSrc.value, game.COLS.value);
      updatePuzzleParam();
      nextTick(game.computeScale);
    }

    async function playNextImage() {
      if (!currentPack.value) return;
      const imgs = currentPack.value.images || [];
      const idx = imgs.indexOf(game.imgSrc.value);
      const next = imgs[idx + 1];
      if (!next) return;
      localStorage.removeItem('jigsaw_state');
      await game.startGame(next, game.COLS.value);
      updatePuzzleParam();
      nextTick(game.computeScale);
    }

    async function playPuzzle(packName, image, cols) {
      const pack = packs.value.find(pp => pp.name === packName);
      if (!pack || !pack.images.includes(image)) return;
      selectPack(packName);
      selectedImage.value = image;
      localStorage.removeItem('jigsaw_state');
      await game.startGame(image, cols);
      navigateTo('puzzle');
      updatePuzzleParam();
      nextTick(game.computeScale);
    }

    // --- Init ---
    onMounted(async () => {
      // Set initial history state
      history.replaceState({ screen: 'home' }, '', '');

      await loadPacks();
      refreshResumable();
      // Drop stale identity if server no longer knows about it (e.g. DB was reset)
      identity.value = await validateIdentity();
      refreshPlayerCompletion();

      // Determine which pack to use
      const urlPack = urlParams.get('pack');
      const savedPack = localStorage.getItem('jigsaw_pack');
      const packName = urlPack || savedPack || (packs.value[0] && packs.value[0].name);
      if (packName) selectPack(packName);

      // Check for URL params that should skip to puzzle
      const urlPuzzle = urlParams.get('puzzle');
      const urlCols = urlParams.get('cols');

      // Check if there's saved state to restore
      let savedImg = '';
      try {
        const raw = localStorage.getItem('jigsaw_state');
        if (raw) {
          const state = JSON.parse(raw);
          if (state && state.img) savedImg = state.img;
        }
      } catch(e) {}

      // If saved image belongs to a different pack, switch to that pack
      if (savedImg) {
        const ownerPack = packs.value.find(p => p.images.includes(savedImg));
        if (ownerPack) selectPack(ownerPack.name);
      }

      const images = currentPack.value ? currentPack.value.images : [];

      // Only auto-restore to the puzzle screen when the URL carries puzzle
      // params (deep-link or a still-open puzzle tab). A bare "/" load lands
      // on home with the Resume card — clicking Home shouldn't be undone by
      // a reload.
      if (savedImg && images.includes(savedImg) && urlPuzzle && urlCols) {
        await game.loadImageDimensions(savedImg);
        if (game.restoreState()) {
          currentScreen.value = 'puzzle';
          history.replaceState({ screen: 'puzzle' }, '', '');
          updatePuzzleParam();
          nextTick(game.computeScale);
        }
      } else if (urlPuzzle && urlCols) {
        const idx = /^\d+$/.test(urlPuzzle) ? parseInt(urlPuzzle, 10) - 1 : 0;
        const cols = /^\d+$/.test(urlCols) ? parseInt(urlCols, 10) : 8;
        const img = images[idx] || images[0];
        if (img) {
          selectedImage.value = img;
          await game.startGame(img, Math.min(Math.max(cols, 2), 16));
          currentScreen.value = 'puzzle';
          history.replaceState({ screen: 'puzzle' }, '', '');
          updatePuzzleParam();
          nextTick(game.computeScale);
        }
      }

      // Deep-link to admin via ?admin=1
      if (urlParams.get('admin') === '1') {
        openAdmin();
      }

      window.addEventListener('resize', onResize);
      window.addEventListener('popstate', handlePopState);
      document.addEventListener('gesturestart', preventGesture);
    });

    onUnmounted(() => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('popstate', handlePopState);
      document.removeEventListener('gesturestart', preventGesture);
    });

    return {
      // Screens
      currentScreen,

      // Packs
      packs, currentPack, packPreviewImages, thumb,
      selectedImage, selectedImageDims, pieceCountForCols,

      // Navigation
      goHome, selectPackAndGo, selectImageAndGo, startPuzzle,
      confirmGoHome, confirmNewPuzzle, navigateTo,
      openLeaderboard, openLeaderboardFromVictory, openSettings, openAdmin,

      // Identity
      identity,

      // Leaderboard
      leaderboardTab, leaderboardLoading, leaderboardError, leaderboardContext,
      puzzleBoard, globalBoard, myScores, refreshLeaderboard,

      // Settings screen
      settingsNameInput, settingsClaimInput, settingsStatus,
      saveDisplayName, claimCode, signOut,
      codeCopyStatus, copyCode,

      // Admin
      adminToken, adminPlayers, adminStatus, adminSearch,
      saveAdminToken, adminLoad, adminRename, adminToggleLock, adminDelete, adminRecompute,

      // Helpers
      formatDuration, formatRelative, packLabelFor, imageNameFor, imageThumbFor, playPuzzle,
      replayCurrent, playNextImage, hasNextImage,
      fakeName, publicNameFor, bestScoreFor,

      // Setup screen stats
      puzzleSummary, summaryFor, openSetupLeaderboard,
      selectedImageName, openImageLeaderboard,

      // Puzzle toolbar
      liveTimeLabel, progressPct, placedTotal,

      // Resume
      resumable, resumePuzzle,

      // Confirmation modal
      pendingAction, confirmYes,

      // Mobile
      menuOpen,

      // Settings
      settingsOpen,

      // Sound
      soundOn, toggleSound,

      // Victory
      victoryVideo, imageName,

      // Game engine
      tiles: game.tiles,
      tileW: game.tileW,
      tileH: game.tileH,
      won: game.won,
      scale: game.scale,
      boardStyle: game.boardStyle,
      COLS: game.COLS,
      ROWS: game.ROWS,
      sliderCols: game.sliderCols,
      breakGroupsOption: game.breakGroupsOption,
      dropHighlights: game.dropHighlights,
      dropValid: game.dropValid,
      draggingTileIds: game.draggingTileIds,
      moveCount: game.moveCount,
      canUndo: game.canUndo,
      currentScore: game.currentScore,
      liveSeconds: game.liveSeconds,
      winResult: game.winResult,
      bugStatus: game.bugStatus,
      placedCount: game.placedCount,
      tileStyle: game.tileStyle,
      tileClasses: game.tileClasses,
      onPointerDown: game.onPointerDown,
      onPointerMove: game.onPointerMove,
      onPointerUp: game.onPointerUp,
      undo: game.undo,
      reportBug: game.reportBug,
    };
  }
}).mount('#app');
