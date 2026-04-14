// Vue app shell — screen routing, pack loading, glue
import { createGameEngine } from './game.js';
import { soundOn, toggleSound } from './sounds.js';
import {
  loadIdentity, ensurePlayer, claimPlayer, setDisplayName, clearIdentity,
} from './identity.js';
import {
  submitScore, fetchPuzzleLeaderboard, fetchGlobalLeaderboard, fetchPlayerScores,
} from './leaderboard.js';

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
      const target = e.state && e.state.screen;
      if (target) {
        // If leaving puzzle with in-progress game, confirm first
        if (currentScreen.value === 'puzzle' && game.moveCount.value > 0 && !game.won.value) {
          // Push state back so the URL doesn't change yet
          suppressPopState = true;
          history.pushState({ screen: 'puzzle' }, '', '');
          pendingAction.value = () => {
            localStorage.removeItem('jigsaw_state');
            currentScreen.value = target;
            clearUrlParams();
          };
          return;
        }
        if (currentScreen.value === 'puzzle') {
          localStorage.removeItem('jigsaw_state');
          clearUrlParams();
        }
        currentScreen.value = target;
      } else {
        // No state — go home
        if (currentScreen.value === 'puzzle' && game.moveCount.value > 0 && !game.won.value) {
          suppressPopState = true;
          history.pushState({ screen: 'puzzle' }, '', '');
          pendingAction.value = () => {
            localStorage.removeItem('jigsaw_state');
            currentScreen.value = 'home';
            clearUrlParams();
          };
          return;
        }
        if (currentScreen.value === 'puzzle') {
          localStorage.removeItem('jigsaw_state');
          clearUrlParams();
        }
        currentScreen.value = 'home';
      }
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
      navigateTo('setup');
    }

    // Compute piece count for a given column count using image dimensions
    function pieceCountForCols(cols) {
      if (!selectedImageDims.value) return '...';
      const aspect = selectedImageDims.value.h / selectedImageDims.value.w;
      const rows = Math.max(Math.round(cols * aspect), 2);
      return cols * rows;
    }

    async function startPuzzle(cols) {
      await game.startGame(selectedImage.value, cols);
      navigateTo('puzzle');
      updatePuzzleParam();
      nextTick(game.computeScale);
    }

    // --- Confirmation for leaving puzzle ---
    const pendingAction = ref(null);

    function confirmGoHome() {
      if (game.moveCount.value > 0 && !game.won.value) {
        pendingAction.value = () => {
          localStorage.removeItem('jigsaw_state');
          goHome();
        };
      } else {
        localStorage.removeItem('jigsaw_state');
        goHome();
      }
    }

    function confirmNewPuzzle() {
      if (game.moveCount.value > 0 && !game.won.value) {
        pendingAction.value = () => {
          localStorage.removeItem('jigsaw_state');
          navigateTo('picker');
        };
      } else {
        localStorage.removeItem('jigsaw_state');
        navigateTo('picker');
      }
    }

    function confirmYes() {
      const action = pendingAction.value;
      pendingAction.value = null;
      if (action) action();
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

    // --- Win → submit score ---
    let submittingScore = false;
    watch(() => game.won.value, async (isWon) => {
      if (!isWon || submittingScore) return;
      submittingScore = true;
      try {
        const player = identity.value || await ensurePlayer();
        identity.value = player;
        const snap = game.getCompletionSnapshot();
        const result = await submitScore({
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
        game.winResult.value = result;
      } catch (e) {
        console.warn('score submit failed:', e);
        game.winResult.value = { error: e.message || String(e) };
      } finally {
        submittingScore = false;
      }
    });

    // --- Leaderboard screen ---
    const leaderboardTab = ref('puzzle'); // 'puzzle' | 'global' | 'me'
    const leaderboardLoading = ref(false);
    const puzzleBoard = ref([]);
    const globalBoard = ref([]);
    const myScores = ref([]);
    const leaderboardContext = ref(null); // { pack, image, rows, cols } snapshot for 'puzzle' tab

    async function refreshLeaderboard() {
      leaderboardLoading.value = true;
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
    const settingsStatus = ref('');

    function openSettings() {
      settingsNameInput.value = identity.value?.displayName || '';
      settingsClaimInput.value = '';
      settingsStatus.value = '';
      navigateTo('settings');
    }

    async function saveDisplayName() {
      settingsStatus.value = '';
      try {
        if (!identity.value) identity.value = await ensurePlayer();
        const updated = await setDisplayName(identity.value.code, settingsNameInput.value.trim());
        identity.value = updated;
        settingsStatus.value = 'Saved';
      } catch (e) {
        settingsStatus.value = e.message || 'Failed';
      }
    }

    async function claimCode() {
      settingsStatus.value = '';
      const raw = settingsClaimInput.value.trim().toUpperCase();
      if (!/^[A-Z]{6}$/.test(raw)) {
        settingsStatus.value = 'Code must be 6 letters';
        return;
      }
      try {
        const mergeFrom = identity.value?.code;
        const player = await claimPlayer(raw, mergeFrom && mergeFrom !== raw ? mergeFrom : undefined);
        identity.value = player;
        settingsNameInput.value = player.displayName || '';
        settingsClaimInput.value = '';
        settingsStatus.value = mergeFrom && mergeFrom !== raw ? `Claimed & merged from ${mergeFrom}` : 'Claimed';
      } catch (e) {
        settingsStatus.value = e.message || 'Failed';
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

    // --- Init ---
    onMounted(async () => {
      // Set initial history state
      history.replaceState({ screen: 'home' }, '', '');

      await loadPacks();

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

      if (savedImg && images.includes(savedImg)) {
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
      leaderboardTab, leaderboardLoading, leaderboardContext,
      puzzleBoard, globalBoard, myScores, refreshLeaderboard,

      // Settings screen
      settingsNameInput, settingsClaimInput, settingsStatus,
      saveDisplayName, claimCode,

      // Admin
      adminToken, adminPlayers, adminStatus, adminSearch,
      saveAdminToken, adminLoad, adminRename, adminToggleLock, adminDelete, adminRecompute,

      // Helpers
      formatDuration, packLabelFor,

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
