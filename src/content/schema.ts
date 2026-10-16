import { z } from 'zod';
import type { GridIndex, MapData } from '@/domain/geo';

const Alpha2 = z.string().regex(/^[A-Z]{2}$/, 'alpha2 harus 2 huruf besar');
const Alpha3 = z.string().regex(/^[A-Z]{3}$/, 'alpha3 harus 3 huruf besar');
const Numeric = z.string().regex(/^\d{3}$/, 'numeric harus 3 digit');
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'tanggal harus YYYY-MM-DD');
const Lonlat = z.tuple([z.number().min(-180).max(180), z.number().min(-90).max(90)]);

const Continent = z.enum(['africa', 'americas', 'asia', 'europe', 'oceania', 'antarctica']);

const TTS_FORBIDDEN = /[()&,]| - /;
/** Nama untuk TTS: tidak kosong, tanpa kurung, koma, ampersand, atau " - ". */
export const TtsNameSchema = z
  .string()
  .min(1, 'nama tidak boleh kosong')
  .refine((s) => !TTS_FORBIDDEN.test(s), 'nama tidak boleh berisi ( ) , & atau " - " (aturan TTS)');

const LocalizedName = z.object({ id: TtsNameSchema, en: TtsNameSchema });

export const UnMembersSchema = z.object({
  source: z.object({
    members: z.url(),
    m49: z.url(),
    checkedAt: IsoDate,
  }),
  members: z.array(
    z.object({
      alpha2: Alpha2,
      alpha3: Alpha3,
      numeric: Numeric,
      continent: Continent,
      fallbackMarker: Lonlat.optional(),
    }),
  ),
});
export type UnMembers = z.infer<typeof UnMembersSchema>;

export const NameOverridesSchema = z.object({
  id: z.record(z.string(), z.string()),
  en: z.record(z.string(), z.string()),
});
export type NameOverrides = z.infer<typeof NameOverridesSchema>;

const Ring = z
  .array(z.number().finite())
  .min(6)
  .refine((r) => r.length % 2 === 0, 'ring harus berpanjang genap');
const Polygons = z.array(z.array(Ring));
const FilledPolygons = Polygons.min(1, 'polygons tidak boleh kosong');

const MapFeatureSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('country'), code: Alpha2, polygons: FilledPolygons }),
  z.object({ kind: z.literal('continent'), code: Alpha2, polygons: FilledPolygons }),
  z.object({ kind: z.literal('neutral'), code: z.null(), polygons: Polygons }),
]);

export const MapDataSchema: z.ZodType<MapData> = z.object({
  version: z.number().int(),
  features: z.array(MapFeatureSchema),
});

export const GridIndexSchema: z.ZodType<GridIndex> = z.object({
  cellDeg: z.number().positive(),
  cells: z.record(z.string(), z.array(z.number())),
});

const FavoriteLevel = z.union([z.literal(1), z.literal(2)]);

export const CountryCatalogSchema = z.array(
  z
    .object({
      alpha2: Alpha2,
      alpha3: Alpha3,
      numeric: Numeric,
      kind: z.enum(['country', 'continent']),
      continent: Continent,
      name: LocalizedName,
      hasFlag: z.boolean(),
      anchor: Lonlat,
      marker: z.boolean(),
      favorite: z.object({ level: FavoriteLevel }).optional(),
    })
    .superRefine((c, ctx) => {
      if (c.kind !== 'continent') return;
      if (c.alpha2 !== 'AQ' || c.hasFlag || c.continent !== 'antarctica') {
        ctx.addIssue({
          code: 'custom',
          message:
            "kind 'continent' hanya untuk AQ dengan hasFlag false dan continent 'antarctica'",
        });
      }
    }),
);
export type CountryCatalog = z.infer<typeof CountryCatalogSchema>;

export const FavoritesSchema = z.array(
  z.object({
    code: Alpha2,
    level: FavoriteLevel,
    icon: z.object({ emoji: z.string().min(1), label: LocalizedName }),
    fact: z.object({ id: z.string().min(1), en: z.string().min(1) }),
    review: z.literal('draft').optional(),
  }),
);
export type Favorites = z.infer<typeof FavoritesSchema>;

export const ContinentFactsSchema = z
  .object({
    AQ: z.object({
      icon: z.object({ emoji: z.string().min(1), label: LocalizedName }),
      fact: z.object({ id: z.string().min(1), en: z.string().min(1) }),
    }),
  })
  .strict();
export type ContinentFacts = z.infer<typeof ContinentFactsSchema>;

const Hex64 = z.string().regex(/^[0-9a-f]{64}$/, 'harus 64 karakter heksadesimal huruf kecil');

const IconEntrySchema = z.object({
  file: z.string(),
  sha256: Hex64,
  bytes: z.number().int().positive(),
  width: z.literal(256),
  height: z.literal(256),
  source: z.enum(['gemini-api', 'manual']),
  model: z.string().min(1).nullable(),
  promptHash: Hex64,
  attempt: z.number().int().min(1),
  checker: z
    .object({ model: z.string().min(1), verdict: z.record(z.string(), z.unknown()) })
    .nullable(),
  status: z.literal('approved'),
  generatedAt: z.iso.datetime(),
  reviewedAt: z.iso.datetime(),
});

/** Manifest ikon kurasi: kunci Alpha2, berkas `icons/<kode kecil>.webp`, 256x256, sudah disetujui. */
export const IconManifestSchema = z
  .object({
    styleVersion: z.number().int().min(1),
    styleHash: Hex64,
    icons: z.record(Alpha2, IconEntrySchema),
  })
  .superRefine((m, ctx) => {
    for (const [code, e] of Object.entries(m.icons)) {
      if (e.file !== `icons/${code.toLowerCase()}.webp`) {
        ctx.addIssue({
          code: 'custom',
          path: ['icons', code, 'file'],
          message: `file harus icons/${code.toLowerCase()}.webp`,
        });
      }
    }
  });
export type IconManifest = z.infer<typeof IconManifestSchema>;
