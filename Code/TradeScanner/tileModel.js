// On-device tile recogniser for the Trade Scanner (2026-11-02):
// modules/trade-ocr classifyTiles (Android, TFLite from Play services) runs
// the model trained in RunningApps/_scanner_ml on every catalogue item.
// Returns, per tile, candidates in the matcher's shape ({ name, d }, d = 1 -
// score) or null when the model is not available (iOS for now, Play services
// TFLite missing, any error): the scanner then keeps its picture matcher.
import { NativeModules } from 'react-native';
import names from './tileModelNames.json';

export async function classifyTiles(uri, frame, tiles) {
  const mod = NativeModules.TradeOcr;
  if (!mod?.classifyTiles || !uri || !tiles?.length) return null;
  try {
    const res = await mod.classifyTiles(uri, frame, tiles.map((t) => [t.x0, t.y0, t.x1, t.y1]));
    if (!Array.isArray(res) || res.length !== tiles.length) return null;
    return res.map((top) => top
      .filter((c) => names[c.i])
      .map((c) => ({ name: names[c.i], d: Math.round((1 - c.s) * 1000) / 1000, score: c.s })));
  } catch {
    return null;
  }
}
