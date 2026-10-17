/** Konstanta dan path pipeline audio (issue #49, ADR-008). Path relatif terhadap akar repo. */

export const RATE = 24000;
/** Jeda antar klip dan ekor grup. */
export const GAP_MS = 250;
/** Hening di awal grup sebelum klip pertama. */
export const LEAD_MS = 100;
/** Jendela klip dimulai PRE_MS sebelum audio. */
export const PRE_MS = 20;
/** Jendela klip diperpanjang POST_MS setelah audio. */
export const POST_MS = 100;
/** Batas panjang satu sprite. */
export const MAX_GROUP_MS = 45000;

export const RAW_DIR = '.tmp/audio/raw';
export const CACHE_DIR = '.tmp/audio/cache';
export const SAMPLES_DIR = '.tmp/audio/samples';
export const VENV_DIR = '.tmp/audio/venv';
export const WHISPER_MODEL_DIR = '.tmp/audio/whisper-model';
export const PUBLIC_AUDIO_DIR = 'public/audio';
export const MANIFEST_PATH = 'src/content/data/audio-manifest.json';
