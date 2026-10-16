import countriesJson from '@/content/generated/countries.json';
import { CountryCatalogSchema } from '@/content/schema';
import {
  loadFlagImage,
  loadGlobeData,
  type ContentService,
  type FlagDeps,
  type GlobeDataDeps,
} from './index';

// Satu deps tingkat modul: Jelajah dan Kuis berbagi memo loadGlobeData.
const globeDataDeps: GlobeDataDeps = { fetch: (input) => globalThis.fetch(input) };

export function createBrowserContentService(): ContentService {
  const fetchFn: FlagDeps['fetch'] = (input) => globalThis.fetch(input);
  const decode: FlagDeps['decode'] = (blob) => globalThis.createImageBitmap(blob);
  const flagDeps: FlagDeps = {
    fetch: fetchFn,
    decode,
    catalog: CountryCatalogSchema.parse(countriesJson),
  };
  return {
    loadGlobeData: () => loadGlobeData(globeDataDeps),
    loadFlagImage: (code) => loadFlagImage(code, flagDeps),
  };
}
