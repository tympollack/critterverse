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

let hydrated = false;

export async function hydrateCritterAssetCatalog(
  supabaseClient?: SupabaseClientLike,
  force = false,
): Promise<CatalogAsset[]> {
  if (hydrated && !force && !supabaseClient) {
    return loadCatalogAssets({ app_scope: CRITTER_APP_SCOPE, fallbackToSeed: true });
  }
  const assets = await loadCatalogAssets({
    app_scope: CRITTER_APP_SCOPE,
    supabaseClient,
    fallbackToSeed: true,
  });
  assetRegistry.loadCatalog(assets, CRITTER_APP_SCOPE);
  hydrated = true;
  return assets;
}

export function resetCritterAssetHydrationForTest(): void {
  hydrated = false;
}

export function resolveCritterPartAsset(
  partType: CritterPartType,
  variant: string,
  affinity?: ElementalAffinity,
): CritterResolvedPartAsset {
  const variantKey = `critter-${partType}-${variant}${affinity ? `-${affinity}` : ''}`;
  const genericKey = `critter-${partType}-${variant}`;
  const canonicalKey = CANONICAL_PART_KEY_MAP[partType]?.[variant];

  if (assetRegistry.hasOverride(variantKey)) {
    return { assetKey: variantKey, cdnUrl: assetRegistry.resolveUrl(variantKey) };
  }
  if (assetRegistry.hasOverride(genericKey)) {
    return { assetKey: genericKey, cdnUrl: assetRegistry.resolveUrl(genericKey) };
  }
  if (canonicalKey && assetRegistry.hasOverride(canonicalKey)) {
    return { assetKey: canonicalKey, cdnUrl: assetRegistry.resolveUrl(canonicalKey) };
  }

  const fallbackKey = canonicalKey ?? genericKey;
  const cdnUrl = assetRegistry.resolveAssetUrl(
    'critters',
    `parts/${partType}_${variant}`,
    'png',
  ) || getKenneyAssetUrl('critters', `parts/${partType}_${variant}`, 'png');

  return { assetKey: fallbackKey, cdnUrl };
}

export function resolveCritterFrameAsset(frameKey = 'panel-metal'): {
  cdnUrl: string;
  atlasFrame?: AtlasFrame;
} {
  return {
    cdnUrl: assetRegistry.resolveAssetUrl('ui-pack', frameKey, 'png'),
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
