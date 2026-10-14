import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  CritterAssembler,
  AFFINITY_COLOR_SCHEMES,
} from '../src/engine/CritterAssembler';
import {
  CritterDNA,
  ElementalAffinity,
} from '../src/types/critter';

describe('CritterAssembler Engine', () => {
  describe('generateRandomDNA', () => {
    it('creates a complete DNA manifest with valid attributes', () => {
      const dna = CritterAssembler.generateRandomDNA('fire');

      expect(dna.id).toBeDefined();
      expect(dna.affinity).toBe('fire');
      expect(dna.speciesName).toBeDefined();
      expect(dna.generation).toBe(1);
      expect(dna.scale).toBe(1.0);

      // Verify stats
      expect(dna.stats.hp).toBeGreaterThanOrEqual(60);
      expect(dna.stats.attack).toBeGreaterThanOrEqual(45);
      expect(dna.stats.defense).toBeGreaterThanOrEqual(40);
      expect(dna.stats.speed).toBeGreaterThanOrEqual(50);
    });

    it('generates critters for all four elemental affinities', () => {
      const affinities: ElementalAffinity[] = ['fire', 'water', 'grass', 'shadow'];

      for (const aff of affinities) {
        const dna = CritterAssembler.generateRandomDNA(aff);
        expect(dna.affinity).toBe(aff);
        expect(AFFINITY_COLOR_SCHEMES[aff]).toBeDefined();
        expect(AFFINITY_COLOR_SCHEMES[aff].primary).toBeDefined();
        expect(AFFINITY_COLOR_SCHEMES[aff].secondary).toBeDefined();
      }
    });
  });

  describe('spliceDNA', () => {
    it('combines traits from two parent critters into a hybrid offspring', () => {
      const parentA = CritterAssembler.generateRandomDNA('fire');
      const parentB = CritterAssembler.generateRandomDNA('water');

      const offspring = CritterAssembler.spliceDNA(parentA, parentB);

      expect(offspring.id).toMatch(/^spliced-/);
      expect(offspring.generation).toBe(2);
      expect(['fire', 'water']).toContain(offspring.affinity);
      expect(offspring.speciesName.length).toBeGreaterThan(2);

      // Verify spliced stats fall in sensible ranges
      expect(offspring.stats.hp).toBeGreaterThan(0);
      expect(offspring.stats.attack).toBeGreaterThan(0);
      expect(offspring.stats.defense).toBeGreaterThan(0);
      expect(offspring.stats.speed).toBeGreaterThan(0);
    });
  });

  describe('assembleManifest', () => {
    it('constructs parts with verified joint socket alignment without missing sockets', () => {
      const dna: CritterDNA = {
        id: 'test-critter-1',
        speciesName: 'Pyrofang',
        affinity: 'fire',
        bodyVariant: 'beast',
        headVariant: 'draconic',
        limbsVariant: 'claws',
        wingsVariant: 'dragon',
        hornsVariant: 'curved',
        tailVariant: 'demon',
        eyesVariant: 'focused',
        mouthVariant: 'fang',
        scale: 1.0,
        generation: 1,
        stats: { hp: 100, attack: 80, defense: 70, speed: 65 },
      };

      const origin = { x: 200, y: 220 };
      const manifest = CritterAssembler.assembleManifest(dna, origin);

      expect(manifest.dna).toBe(dna);
      expect(manifest.sockets.root).toEqual(origin);
      expect(manifest.sockets.head.y).toBeLessThan(origin.y);
      expect(manifest.sockets.leftArm.x).toBeLessThan(origin.x);
      expect(manifest.sockets.rightArm.x).toBeGreaterThan(origin.x);
      expect(manifest.sockets.leftLeg.y).toBeGreaterThan(origin.y);
      expect(manifest.sockets.rightLeg.y).toBeGreaterThan(origin.y);

      // All parts are mapped
      const partTypes = manifest.parts.map((p) => p.type);
      expect(partTypes).toContain('body');
      expect(partTypes).toContain('head');
      expect(partTypes).toContain('limbs');
      expect(partTypes).toContain('wings');
      expect(partTypes).toContain('horns');
      expect(partTypes).toContain('tail');
      expect(partTypes).toContain('eyes');
      expect(partTypes).toContain('mouth');

      // Verify parts are sorted by zIndex
      for (let i = 1; i < manifest.parts.length; i++) {
        expect(manifest.parts[i].zIndex).toBeGreaterThanOrEqual(manifest.parts[i - 1].zIndex);
      }
    });

    it('renders critter without error via renderCritter', () => {
      const dna = CritterAssembler.generateRandomDNA('grass');
      const manifest = CritterAssembler.assembleManifest(dna);

      // Mock canvas rendering context
      const mockCtx = {
        save: vi.fn(),
        restore: vi.fn(),
        translate: vi.fn(),
        rotate: vi.fn(),
        scale: vi.fn(),
        beginPath: vi.fn(),
        moveTo: vi.fn(),
        lineTo: vi.fn(),
        bezierCurveTo: vi.fn(),
        quadraticCurveTo: vi.fn(),
        arc: vi.fn(),
        ellipse: vi.fn(),
        closePath: vi.fn(),
        fill: vi.fn(),
        stroke: vi.fn(),
        fillRect: vi.fn(),
        strokeRect: vi.fn(),
        fillText: vi.fn(),
        createRadialGradient: vi.fn().mockReturnValue({
          addColorStop: vi.fn(),
        }),
        createLinearGradient: vi.fn().mockReturnValue({
          addColorStop: vi.fn(),
        }),
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
      } as unknown as CanvasRenderingContext2D;

      expect(() => {
        CritterAssembler.renderCritter(mockCtx, manifest, 1500);
      }).not.toThrow();

      expect(mockCtx.beginPath).toHaveBeenCalled();
      expect(mockCtx.fill).toHaveBeenCalled();
    });
  });

  describe('exportToCardThumbnail', () => {
    beforeEach(() => {
      // Mock global document if running in node environment
      const mockCanvas = {
        width: 400,
        height: 560,
        getContext: vi.fn().mockReturnValue({
          save: vi.fn(),
          restore: vi.fn(),
          translate: vi.fn(),
          rotate: vi.fn(),
          scale: vi.fn(),
          beginPath: vi.fn(),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          bezierCurveTo: vi.fn(),
          quadraticCurveTo: vi.fn(),
          arc: vi.fn(),
          ellipse: vi.fn(),
          closePath: vi.fn(),
          fill: vi.fn(),
          stroke: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          fillText: vi.fn(),
          createRadialGradient: vi.fn().mockReturnValue({
            addColorStop: vi.fn(),
          }),
          createLinearGradient: vi.fn().mockReturnValue({
            addColorStop: vi.fn(),
          }),
        }),
        toDataURL: vi.fn().mockReturnValue('data:image/png;base64,MOCK_IMAGE_DATA'),
      };

      if (typeof global.document === 'undefined') {
        // @ts-expect-error mock document
        global.document = {
          createElement: vi.fn().mockReturnValue(mockCanvas),
        };
      } else {
        vi.spyOn(document, 'createElement').mockReturnValue(mockCanvas as unknown as HTMLElement);
      }
    });

    it('generates a 2D card thumbnail image data URL', async () => {
      const dna = CritterAssembler.generateRandomDNA('shadow');
      const thumbnail = await CritterAssembler.exportToCardThumbnail(dna);

      expect(thumbnail).toMatch(/^data:image\/png;base64,/);
    });
  });
});
