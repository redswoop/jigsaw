// Vue app shell — screen routing, pack loading, glue
import { createGameEngine } from './game.js';
import { soundOn, toggleSound } from './sounds.js';

const { createApp, ref, computed, onMounted, onUnmounted, nextTick, watch } = Vue;

createApp({
  setup() {
    // --- Screen state ---
    const currentScreen = ref('home');  // 'home' | 'picker' | 'setup' | 'puzzle'

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
        localStorage.setItem('jigsaw_pack', packName);
      }
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
      packs, currentPack, packPreviewImages,
      selectedImage, selectedImageDims, pieceCountForCols,

      // Navigation
      goHome, selectPackAndGo, selectImageAndGo, startPuzzle,
      confirmGoHome, confirmNewPuzzle, navigateTo,

      // Confirmation modal
      pendingAction, confirmYes,

      // Mobile
      menuOpen,

      // Settings
      settingsOpen,

      // Sound
      soundOn, toggleSound,

      // Victory
      victoryVideo,

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
