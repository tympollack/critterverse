import {
  KENNEY_CDN_BASE,
  getFrameCoordinates,
  getKenneyAssetUrl,
  loadCatalogAssets,
  assetRegistry,
  uiSpritesAtlas,
  type AtlasFrame,
  type CatalogAsset,
  type HotSwapListener,
  type SupabaseClientLike,
} from '@digitalcanopy/assets';
import type { CritterPartType, ElementalAffinity } from '../types/critter';

export const CRITTER_APP_SCOPE = 'critterverse';

export interface CritterResolvedPartAsset {
  assetKey: string;
  cdnUrl: string;
}

const CANONICAL_PART_KEY_MAP: Partial<Record<CritterPartType, Record<string, string>>> = {
  head: {
    round: 'critter-head-fuzzy-orange',
    draconic: 'critter-head-scaled-teal',
    feline: 'critter-head-fuzzy-orange',
    avian: 'critter-head-scaled-teal',
  },
  body: {
    chubby: 'critter-body-chubby-pink',
    beast: 'critter-body-sleek-green',
    serpentine: 'critter-body-sleek-green',
    compact: 'critter-body-chubby-pink',
  },
  limbs: {
    paws: 'critter-limbs-paws-brown',
    claws: 'critter-limbs-paws-brown',
    hooves: 'critter-limbs-paws-brown',
    fins: 'critter-limbs-paws-brown',
  },
  wings: {
    feathered: 'critter-wings-feathered-white',
    dragon: 'critter-wings-feathered-white',
    bat: 'critter-wings-feathered-white',
  },
  tail: {
    fluffy: 'critter-tail-fluffy-gold',
    whip: 'critter-tail-fluffy-gold',
    demon: 'critter-tail-fluffy-gold',
  },
  horns: {
    curved: 'critter-horns-curved-ivory',
    ram: 'critter-horns-curved-ivory',
    crown: 'critter-horns-curved-ivory',
  },
};

const CANONICAL_PART_RELATIVE_PATH: Partial<
  Record<CritterPartType, Record<string, string>>
> = {
  head: {
    round: 'parts/head_fuzzy_orange.png',
    draconic: 'parts/head_scaled_teal.png',
    feline: 'parts/head_fuzzy_orange.png',
    avian: 'parts/head_scaled_teal.png',
  },
  body: {
    chubby: 'parts/body_chubby_pink.png',
    beast: 'parts/body_sleek_green.png',
    serpentine: 'parts/body_sleek_green.png',
    compact: 'parts/body_chubby_pink.png',
  },
  limbs: {
    paws: 'parts/limbs_paws_brown.png',
    claws: 'parts/limbs_paws_brown.png',
    hooves: 'parts/limbs_paws_brown.png',
    fins: 'parts/limbs_paws_brown.png',
  },
  wings: {
    feathered: 'parts/wings_feathered_white.png',
    dragon: 'parts/wings_feathered_white.png',
    bat: 'parts/wings_feathered_white.png',
  },
  tail: {
    fluffy: 'parts/tail_fluffy_gold.png',
    whip: 'parts/tail_fluffy_gold.png',
    demon: 'parts/tail_fluffy_gold.png',
  },
  horns: {
    curved: 'parts/horns_curved_ivory.png',
    ram: 'parts/horns_curved_ivory.png',
    crown: 'parts/horns_curved_ivory.png',
  },
};

let hydrated = false;
let cachedCatalog: CatalogAsset[] | null = null;
const baselineCatalogUrls = new Map<string, string>();

export async function hydrateCritterAssetCatalog(
  supabaseClient?: SupabaseClientLike,
  force = false,
): Promise<CatalogAsset[]> {
  if (hydrated && !force && !supabaseClient && cachedCatalog) {
    return cachedCatalog;
  }
  const assets = await loadCatalogAssets({
    app_scope: CRITTER_APP_SCOPE,
    supabaseClient,
    fallbackToSeed: true,
  });
  baselineCatalogUrls.clear();
  for (const asset of assets) {
    if (asset.asset_key && asset.cdn_url) {
      baselineCatalogUrls.set(asset.asset_key.trim(), asset.cdn_url);
    }
  }
  assetRegistry.loadCatalog(assets, CRITTER_APP_SCOPE);
  cachedCatalog = assets;
  hydrated = true;
  return assets;
}

export function resetCritterAssetHydrationForTest(): void {
  hydrated = false;
  cachedCatalog = null;
  baselineCatalogUrls.clear();
}

export function resolveCritterPartAsset(
  partType: CritterPartType,
  variant: string,
  affinity?: ElementalAffinity,
): CritterResolvedPartAsset {
  const variantKey = `critter-${partType}-${variant}${affinity ? `-${affinity}` : ''}`;
  const genericKey = `critter-${partType}-${variant}`;
  const canonicalKey = CANONICAL_PART_KEY_MAP[partType]?.[variant];

  for (const candidateKey of [variantKey, genericKey, canonicalKey]) {
    if (!candidateKey || !assetRegistry.hasOverride(candidateKey)) continue;
    const overrideUrl = assetRegistry.resolveUrl(candidateKey);
    const baselineUrl = baselineCatalogUrls.get(candidateKey);
    if (!baselineUrl || overrideUrl !== baselineUrl) {
      return { assetKey: candidateKey, cdnUrl: overrideUrl };
    }
  }

  const canonicalRelPath =
    CANONICAL_PART_RELATIVE_PATH[partType]?.[variant] ?? `parts/${partType}_${variant}.png`;
  const packUrl =
    assetRegistry.resolveAssetUrl('critters', canonicalRelPath, 'png') ||
    getKenneyAssetUrl('critters', canonicalRelPath, 'png');
  const defaultPackUrl = `${KENNEY_CDN_BASE}/critters/${canonicalRelPath}`;

  if (canonicalKey && assetRegistry.hasOverride(canonicalKey) && packUrl === defaultPackUrl) {
    return { assetKey: canonicalKey, cdnUrl: assetRegistry.resolveUrl(canonicalKey) };
  }

  const fallbackKey = canonicalKey ?? genericKey;
  return { assetKey: fallbackKey, cdnUrl: packUrl };
}

export function resolveCritterFrameAsset(frameKey = 'panel-metal'): {
  cdnUrl: string;
  atlasUrl: string;
  atlasFrame?: AtlasFrame;
} {
  return {
    cdnUrl: assetRegistry.resolveAssetUrl('ui-pack', frameKey, 'png'),
    atlasUrl: uiSpritesAtlas.meta.image,
    atlasFrame:
      assetRegistry.resolveFrame(uiSpritesAtlas, frameKey) ??
      getFrameCoordinates(uiSpritesAtlas, frameKey),
  };
}

export function getCritterCdnBase(): string {
  return KENNEY_CDN_BASE;
}

export function subscribeCritterAssetSwaps(listener: HotSwapListener): () => void {
  return assetRegistry.onSwap(listener);
}
