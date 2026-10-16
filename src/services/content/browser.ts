import countriesJson from '@/content/generated/countries.json';
import { CountryCatalogSchema } from '@/content/schema';
import { loadFlagImage, loadGlobeData, type ContentService, type FlagDeps } from './index';

export function createBrowserContentService(): ContentService {
  const fetchFn: FlagDeps['fetch'] = (input) => globalThis.fetch(input);
  const decode: FlagDeps['decode'] = (blob) => globalThis.createImageBitmap(blob);
  const flagDeps: FlagDeps = {
    fetch: fetchFn,
    decode,
    catalog: CountryCatalogSchema.parse(countriesJson),
  };
  return {
    loadGlobeData: () => loadGlobeData({ fetch: fetchFn }),
    loadFlagImage: (code) => loadFlagImage(code, flagDeps),
  };
}
