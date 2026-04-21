import Sound from 'react-native-sound';

Sound.setCategory('Playback', true);

const KEY_PREFIX = 'game_sound_';
const enabledCache = {};
let wooshSound = null;
let popSound = null;
let refCount = 0;
let loadPromise = null;

function getStorage() {
    try {
        return require('react-native-mmkv').MMKV ? require('../LocalGlobelStats').storage : null;
    } catch {
        return null;
    }
}

function keyFor(gameKey) {
    return `${KEY_PREFIX}${gameKey}`;
}

export async function initGameSounds() {
    refCount += 1;
    if (loadPromise) return loadPromise;
    if (wooshSound && popSound) return Promise.resolve();

    loadPromise = new Promise((resolve) => {
        wooshSound = new Sound('woosh.mp3', Sound.MAIN_BUNDLE, (err) => {
            if (err) console.warn('Failed to load woosh:', err);
            popSound = new Sound('pop.mp3', Sound.MAIN_BUNDLE, (err2) => {
                if (err2) console.warn('Failed to load pop:', err2);
                resolve();
            });
        });
    });
    return loadPromise;
}

export function isSoundEnabled(gameKey) {
    if (gameKey in enabledCache) return enabledCache[gameKey];
    try {
        const s = getStorage();
        const val = s ? s.getBoolean(keyFor(gameKey)) !== false : true;
        enabledCache[gameKey] = val;
        return val;
    } catch {
        return true;
    }
}

export function setSoundEnabled(gameKey, val) {
    enabledCache[gameKey] = !!val;
    try {
        const s = getStorage();
        if (s) s.set(keyFor(gameKey), !!val);
    } catch {}
}

export function playWoosh(gameKey) {
    if (!isSoundEnabled(gameKey) || !wooshSound) return;
    try {
        wooshSound.stop(() => { wooshSound.play(); });
    } catch {}
}

export function playPop(gameKey) {
    if (!isSoundEnabled(gameKey) || !popSound) return;
    try {
        popSound.stop(() => { popSound.play(); });
    } catch {}
}

export function startAmbient() {}
export function stopAmbient() {}

export function releaseGameSounds() {
    refCount = Math.max(0, refCount - 1);
    if (refCount > 0) return;
    try {
        wooshSound?.release();
        popSound?.release();
        wooshSound = null;
        popSound = null;
        loadPromise = null;
    } catch {}
}
