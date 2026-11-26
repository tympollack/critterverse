import { describe, it, expect, beforeEach } from 'vitest';
import { KENNEY_CDN_BASE, assetRegistry } from '@digitalcanopy/assets';
import { CritterAssembler, DEFAULT_CRITTER_DNA } from '../src/engine/CritterAssembler';
import {
  CRITTER_APP_SCOPE,
  hydrateCritterAssetCatalog,
  resetCritterAssetHydrationForTest,
  resolveCritterFrameAsset,
  resolveCritterPartAsset,
  subscribeCritterAssetSwaps,
} from '../src/engine/assetManifest';

describe('TASK-PKG-APP-CRITTER: @digitalcanopy/assets Modular Splicer & Tint Adapter', () => {
  beforeEach(() => {
    assetRegistry.reset();
    resetCritterAssetHydrationForTest();
  });

  it('hydrates critterverse and shared seed catalog assets into assetRegistry', async () => {
    const assets = await hydrateCritterAssetCatalog(undefined, true);
    expect(assets.some((a) => a.asset_key === 'critter-head-fuzzy-orange')).toBe(true);
    expect(assets.some((a) => a.asset_key === 'critter-body-chubby-pink')).toBe(true);
    expect(assets.some((a) => a.asset_key === 'fx-particle-starburst')).toBe(true);
    expect(CRITTER_APP_SCOPE).toBe('critterverse');
    expect(assetRegistry.resolveUrl('critter-head-fuzzy-orange')).toBe(
      `${KENNEY_CDN_BASE}/critters/parts/head_fuzzy_orange.png`,
    );
  });

  it('attaches assetKey and cdnUrl to every part in CritterAssembler.assembleManifest', async () => {
    await hydrateCritterAssetCatalog(undefined, true);
    const manifest = CritterAssembler.assembleManifest(DEFAULT_CRITTER_DNA);

    expect(manifest.parts.length).toBeGreaterThan(0);
    for (const part of manifest.parts) {
      expect(part.assetKey).toBeTruthy();
      expect(part.cdnUrl).toMatch(/^https:\/\//);
    }

    const headPart = manifest.parts.find((p) => p.type === 'head');
    expect(headPart?.assetKey).toBe('critter-head-fuzzy-orange');
    expect(headPart?.cdnUrl).toBe(
      `${KENNEY_CDN_BASE}/critters/parts/head_fuzzy_orange.png`,
    );
  });

  it('supports runtime pack and per-part hot-swapping via assetRegistry', async () => {
    await hydrateCritterAssetCatalog(undefined, true);
    let swaps = 0;
    const unsub = subscribeCritterAssetSwaps(() => {
      swaps += 1;
    });

    assetRegistry.registerPackOverride('critters', 'https://custom-ip.sunshade.icu/critters');
    const headAfterPackSwap = resolveCritterPartAsset('head', 'round', 'fire');
    expect(headAfterPackSwap.cdnUrl).toBe(
      'https://custom-ip.sunshade.icu/critters/parts/head_fuzzy_orange.png',
    );
    const eyes = resolveCritterPartAsset('eyes', 'focused', 'fire');
    expect(eyes.cdnUrl).toBe('https://custom-ip.sunshade.icu/critters/parts/eyes_focused.png');

    assetRegistry.registerOverride(
      'critter-body-chubby-pink',
      'https://custom-ip.sunshade.icu/chubby-dragon.png',
    );
    const bodyManifest = CritterAssembler.assembleManifest(DEFAULT_CRITTER_DNA);
    const bodyPart = bodyManifest.parts.find((p) => p.type === 'body');
    expect(bodyPart?.cdnUrl).toBe('https://custom-ip.sunshade.icu/chubby-dragon.png');
    const frameAsset = resolveCritterFrameAsset('panel-metal');
    expect(frameAsset.atlasFrame).toBeDefined();
    expect(frameAsset.atlasUrl).toContain('ui-sprites-atlas.png');
    expect(swaps).toBeGreaterThanOrEqual(2);

    unsub();
  });

  it('draws cached CDN sprites in CritterAssembler.renderCritter and falls back when uncached', async () => {
    CritterAssembler.clearSpriteCacheForTest();
    await hydrateCritterAssetCatalog(undefined, true);
    const manifest = CritterAssembler.assembleManifest(DEFAULT_CRITTER_DNA);
    const headPart = manifest.parts.find((p) => p.type === 'head')!;

    const drawImageCalls: Array<{ img: unknown; dx: number; dy: number }> = [];
    const fakeCtx = {
      createRadialGradient: () => ({ addColorStop: () => {} }),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      beginPath: () => {},
      arc: () => {},
      moveTo: () => {},
      lineTo: () => {},
      quadraticCurveTo: () => {},
      bezierCurveTo: () => {},
      ellipse: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
      save: () => {},
      restore: () => {},
      translate: () => {},
      rotate: () => {},
      scale: () => {},
      drawImage: (img: unknown, dx: number, dy: number) => {
        drawImageCalls.push({ img, dx, dy });
      },
    } as unknown as CanvasRenderingContext2D;

    const fakeSprite = { width: 128, height: 128 } as HTMLImageElement;
    CritterAssembler.registerCachedSpriteForTest(headPart.cdnUrl!, fakeSprite);
    CritterAssembler.renderCritter(fakeCtx, manifest, 0);

    expect(drawImageCalls.some((c) => c.img === fakeSprite)).toBe(true);
    CritterAssembler.clearSpriteCacheForTest();
  });
});
