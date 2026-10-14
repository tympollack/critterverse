import {
  ElementalAffinity,
  AffinityColors,
  CritterDNA,
  CritterManifest,
  CritterPart,
  JointPoint,
  CritterStats,
} from '../types/critter';

export const AFFINITY_COLOR_SCHEMES: Record<ElementalAffinity, AffinityColors> = {
  fire: {
    primary: '#ef4444',
    secondary: '#f97316',
    highlight: '#fde047',
    dark: '#7f1d1d',
    glow: 'rgba(239, 68, 68, 0.45)',
    accent: '#ea580c',
  },
  water: {
    primary: '#06b6d4',
    secondary: '#3b82f6',
    highlight: '#e0f2fe',
    dark: '#1e3a8a',
    glow: 'rgba(6, 182, 212, 0.45)',
    accent: '#0284c7',
  },
  grass: {
    primary: '#10b981',
    secondary: '#84cc16',
    highlight: '#bef264',
    dark: '#064e3b',
    glow: 'rgba(16, 185, 129, 0.45)',
    accent: '#059669',
  },
  shadow: {
    primary: '#8b5cf6',
    secondary: '#a855f7',
    highlight: '#f0abfc',
    dark: '#18181b',
    glow: 'rgba(139, 92, 246, 0.5)',
    accent: '#581c87',
  },
};

const SPECIES_PREFIXES: Record<ElementalAffinity, string[]> = {
  fire: ['Pyro', 'Ignis', 'Ember', 'Magma', 'Blaze'],
  water: ['Aqua', 'Hydro', 'Tide', 'Torrent', 'Glacier'],
  grass: ['Flora', 'Sylvan', 'Bramble', 'Verdant', 'Thorn'],
  shadow: ['Umbra', 'Void', 'Nocturne', 'Eclipse', 'Nether'],
};

const SPECIES_SUFFIXES = ['wing', 'fang', 'tail', 'claw', 'scale', 'horn', 'ling', 'mancer'];

export class CritterAssembler {
  /**
   * Generates a procedurally spliced Critter DNA manifest
   */
  public static generateRandomDNA(affinity?: ElementalAffinity): CritterDNA {
    const affinities: ElementalAffinity[] = ['fire', 'water', 'grass', 'shadow'];
    const chosenAffinity = affinity ?? affinities[Math.floor(Math.random() * affinities.length)];

    const prefixes = SPECIES_PREFIXES[chosenAffinity];
    const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
    const suffix = SPECIES_SUFFIXES[Math.floor(Math.random() * SPECIES_SUFFIXES.length)];

    const bodyVariants = ['chubby', 'beast', 'serpentine', 'compact'];
    const headVariants = ['round', 'draconic', 'feline', 'avian'];
    const limbVariants = ['paws', 'claws', 'hooves', 'fins'];
    const wingVariants = ['dragon', 'feathered', 'bat', 'none'];
    const hornVariants = ['curved', 'ram', 'crown', 'none'];
    const tailVariants = ['fluffy', 'whip', 'demon', 'none'];
    const eyeVariants = ['focused', 'wide', 'mystic', 'cute'];
    const mouthVariants = ['fang', 'smile', 'neutral', 'beak'];

    const chosenWing = wingVariants[Math.floor(Math.random() * wingVariants.length)];
    const chosenHorn = hornVariants[Math.floor(Math.random() * hornVariants.length)];
    const chosenTail = tailVariants[Math.floor(Math.random() * tailVariants.length)];

    const stats: CritterStats = {
      hp: Math.floor(60 + Math.random() * 50),
      attack: Math.floor(45 + Math.random() * 60),
      defense: Math.floor(40 + Math.random() * 55),
      speed: Math.floor(50 + Math.random() * 50),
    };

    return {
      id: `critter-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      speciesName: `${prefix}${suffix}`,
      affinity: chosenAffinity,
      bodyVariant: bodyVariants[Math.floor(Math.random() * bodyVariants.length)],
      headVariant: headVariants[Math.floor(Math.random() * headVariants.length)],
      limbsVariant: limbVariants[Math.floor(Math.random() * limbVariants.length)],
      wingsVariant: chosenWing !== 'none' ? chosenWing : undefined,
      hornsVariant: chosenHorn !== 'none' ? chosenHorn : undefined,
      tailVariant: chosenTail !== 'none' ? chosenTail : undefined,
      eyesVariant: eyeVariants[Math.floor(Math.random() * eyeVariants.length)],
      mouthVariant: mouthVariants[Math.floor(Math.random() * mouthVariants.length)],
      scale: 1.0,
      generation: 1,
      stats,
    };
  }

  /**
   * Splices two creature DNAs to produce a hybrid offspring
   */
  public static spliceDNA(parentA: CritterDNA, parentB: CritterDNA): CritterDNA {
    const affinity = Math.random() > 0.5 ? parentA.affinity : parentB.affinity;
    const prefix = parentA.speciesName.slice(0, Math.ceil(parentA.speciesName.length / 2));
    const suffix = parentB.speciesName.slice(Math.floor(parentB.speciesName.length / 2));

    const pick = <T>(a: T, b: T): T => (Math.random() > 0.5 ? a : b);

    const stats: CritterStats = {
      hp: Math.round((parentA.stats.hp + parentB.stats.hp) / 2 + (Math.random() * 10 - 3)),
      attack: Math.round((parentA.stats.attack + parentB.stats.attack) / 2 + (Math.random() * 10 - 3)),
      defense: Math.round((parentA.stats.defense + parentB.stats.defense) / 2 + (Math.random() * 10 - 3)),
      speed: Math.round((parentA.stats.speed + parentB.stats.speed) / 2 + (Math.random() * 10 - 3)),
    };

    return {
      id: `spliced-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      speciesName: `${prefix}${suffix}`,
      affinity,
      bodyVariant: pick(parentA.bodyVariant, parentB.bodyVariant),
      headVariant: pick(parentA.headVariant, parentB.headVariant),
      limbsVariant: pick(parentA.limbsVariant, parentB.limbsVariant),
      wingsVariant: pick(parentA.wingsVariant, parentB.wingsVariant),
      hornsVariant: pick(parentA.hornsVariant, parentB.hornsVariant),
      tailVariant: pick(parentA.tailVariant, parentB.tailVariant),
      eyesVariant: pick(parentA.eyesVariant, parentB.eyesVariant),
      mouthVariant: pick(parentA.mouthVariant, parentB.mouthVariant),
      scale: 1.0,
      generation: Math.max(parentA.generation, parentB.generation) + 1,
      stats,
    };
  }

  /**
   * Assembles a structured Critter manifest with verified socket joint alignment
   */
  public static assembleManifest(
    dna: CritterDNA,
    centerOrigin: JointPoint = { x: 200, y: 220 }
  ): CritterManifest {
    const colors = AFFINITY_COLOR_SCHEMES[dna.affinity];
    const parts: CritterPart[] = [];

    // Precise socket joint alignment mapping relative to body anchor
    const bodyW = 90 * dna.scale;
    const bodyH = 80 * dna.scale;

    const rootSocket: JointPoint = { x: centerOrigin.x, y: centerOrigin.y };
    const headSocket: JointPoint = { x: rootSocket.x, y: rootSocket.y - bodyH * 0.52 };
    const leftArmSocket: JointPoint = { x: rootSocket.x - bodyW * 0.44, y: rootSocket.y - bodyH * 0.05 };
    const rightArmSocket: JointPoint = { x: rootSocket.x + bodyW * 0.44, y: rootSocket.y - bodyH * 0.05 };
    const leftLegSocket: JointPoint = { x: rootSocket.x - bodyW * 0.32, y: rootSocket.y + bodyH * 0.42 };
    const rightLegSocket: JointPoint = { x: rootSocket.x + bodyW * 0.32, y: rootSocket.y + bodyH * 0.42 };
    const leftWingSocket: JointPoint = { x: rootSocket.x - bodyW * 0.46, y: rootSocket.y - bodyH * 0.25 };
    const rightWingSocket: JointPoint = { x: rootSocket.x + bodyW * 0.46, y: rootSocket.y - bodyH * 0.25 };
    const hornsSocket: JointPoint = { x: headSocket.x, y: headSocket.y - 32 * dna.scale };
    const tailSocket: JointPoint = { x: rootSocket.x - bodyW * 0.4, y: rootSocket.y + bodyH * 0.25 };

    // 1. Wings (Z-Index: 5, behind body)
    if (dna.wingsVariant) {
      parts.push({
        id: 'wing-left',
        type: 'wings',
        name: 'Left Wing',
        variant: dna.wingsVariant,
        zIndex: 5,
        jointAnchor: leftWingSocket,
        draw: (ctx, origin, s, c, anim) => {
          ctx.save();
          ctx.translate(origin.x, origin.y + anim.bob);
          ctx.rotate(-0.25 - anim.flap);
          ctx.fillStyle = c.secondary;
          ctx.strokeStyle = c.dark;
          ctx.lineWidth = 2.5;

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-55 * s, -45 * s, -75 * s, -10 * s);
          ctx.quadraticCurveTo(-45 * s, 10 * s, 0, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });

      parts.push({
        id: 'wing-right',
        type: 'wings',
        name: 'Right Wing',
        variant: dna.wingsVariant,
        zIndex: 5,
        jointAnchor: rightWingSocket,
        draw: (ctx, origin, s, c, anim) => {
          ctx.save();
          ctx.translate(origin.x, origin.y + anim.bob);
          ctx.rotate(0.25 + anim.flap);
          ctx.fillStyle = c.secondary;
          ctx.strokeStyle = c.dark;
          ctx.lineWidth = 2.5;

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(55 * s, -45 * s, 75 * s, -10 * s);
          ctx.quadraticCurveTo(45 * s, 10 * s, 0, 0);
          ctx.fill();
          ctx.stroke();
          ctx.restore();
        },
      });
    }

    // 2. Tail (Z-Index: 8)
    if (dna.tailVariant) {
      parts.push({
        id: 'tail',
        type: 'tail',
        name: 'Tail',
        variant: dna.tailVariant,
        zIndex: 8,
        jointAnchor: tailSocket,
        draw: (ctx, origin, s, c, anim) => {
          ctx.save();
          ctx.translate(origin.x, origin.y + anim.bob);
          ctx.rotate(-0.15 + anim.sway * 1.5);
          ctx.strokeStyle = c.primary;
          ctx.fillStyle = c.secondary;
          ctx.lineWidth = 7 * s;
          ctx.lineCap = 'round';

          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.quadraticCurveTo(-40 * s, -15 * s, -60 * s, 25 * s);
          ctx.stroke();

          // Tail tip tuft
          ctx.beginPath();
          ctx.arc(-60 * s, 25 * s, 10 * s, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        },
      });
    }

    // 3. Limbs (Rear/Back Legs, Z-Index: 10)
    parts.push({
      id: 'leg-left',
      type: 'limbs',
      name: 'Left Leg',
      variant: dna.limbsVariant,
      zIndex: 10,
      jointAnchor: leftLegSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y);
        ctx.fillStyle = c.primary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.ellipse(0, 10 * s, 14 * s, 20 * s, -0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    });

    parts.push({
      id: 'leg-right',
      type: 'limbs',
      name: 'Right Leg',
      variant: dna.limbsVariant,
      zIndex: 10,
      jointAnchor: rightLegSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y);
        ctx.fillStyle = c.primary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.ellipse(0, 10 * s, 14 * s, 20 * s, 0.15, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    });

    // 4. Body Torso (Z-Index: 20)
    parts.push({
      id: 'body',
      type: 'body',
      name: 'Body Torso',
      variant: dna.bodyVariant,
      zIndex: 20,
      jointAnchor: rootSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob);

        // Core Torso with subtle breathing expansion
        const breathScale = 1 + anim.breath;
        ctx.scale(breathScale, breathScale);

        ctx.fillStyle = c.primary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 3.0;

        ctx.beginPath();
        ctx.ellipse(0, 0, 45 * s, 40 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        // Belly highlight patch
        ctx.fillStyle = c.highlight;
        ctx.beginPath();
        ctx.ellipse(0, 8 * s, 24 * s, 20 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      },
    });

    // 5. Front Arms (Z-Index: 25)
    parts.push({
      id: 'arm-left',
      type: 'limbs',
      name: 'Left Arm',
      variant: dna.limbsVariant,
      zIndex: 25,
      jointAnchor: leftArmSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob);
        ctx.rotate(0.2 + anim.sway * 0.8);
        ctx.fillStyle = c.secondary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.ellipse(-8 * s, 8 * s, 10 * s, 16 * s, -0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    });

    parts.push({
      id: 'arm-right',
      type: 'limbs',
      name: 'Right Arm',
      variant: dna.limbsVariant,
      zIndex: 25,
      jointAnchor: rightArmSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob);
        ctx.rotate(-0.2 - anim.sway * 0.8);
        ctx.fillStyle = c.secondary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 2.5;

        ctx.beginPath();
        ctx.ellipse(8 * s, 8 * s, 10 * s, 16 * s, 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      },
    });

    // 6. Head (Z-Index: 30)
    parts.push({
      id: 'head',
      type: 'head',
      name: 'Head',
      variant: dna.headVariant,
      zIndex: 30,
      jointAnchor: headSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob * 1.15);

        ctx.fillStyle = c.primary;
        ctx.strokeStyle = c.dark;
        ctx.lineWidth = 3.0;

        ctx.beginPath();
        ctx.ellipse(0, 0, 36 * s, 32 * s, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        ctx.restore();
      },
    });

    // 7. Horns (Z-Index: 32)
    if (dna.hornsVariant) {
      parts.push({
        id: 'horns',
        type: 'horns',
        name: 'Horns',
        variant: dna.hornsVariant,
        zIndex: 32,
        jointAnchor: hornsSocket,
        draw: (ctx, origin, s, c, anim) => {
          ctx.save();
          ctx.translate(origin.x, origin.y + anim.bob * 1.15);
          ctx.fillStyle = c.highlight;
          ctx.strokeStyle = c.dark;
          ctx.lineWidth = 2.0;

          // Left Horn
          ctx.beginPath();
          ctx.moveTo(-18 * s, 0);
          ctx.quadraticCurveTo(-28 * s, -24 * s, -14 * s, -28 * s);
          ctx.quadraticCurveTo(-10 * s, -16 * s, -8 * s, 0);
          ctx.fill();
          ctx.stroke();

          // Right Horn
          ctx.beginPath();
          ctx.moveTo(8 * s, 0);
          ctx.quadraticCurveTo(10 * s, -16 * s, 14 * s, -28 * s);
          ctx.quadraticCurveTo(28 * s, -24 * s, 18 * s, 0);
          ctx.fill();
          ctx.stroke();

          ctx.restore();
        },
      });
    }

    // 8. Eyes (Z-Index: 35)
    parts.push({
      id: 'eyes',
      type: 'eyes',
      name: 'Eyes',
      variant: dna.eyesVariant,
      zIndex: 35,
      jointAnchor: headSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob * 1.15);

        // Left eye
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(-14 * s, -4 * s, 8 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.arc(-14 * s, -3 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();

        // Right eye
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(14 * s, -4 * s, 8 * s, 9 * s, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = c.dark;
        ctx.beginPath();
        ctx.arc(14 * s, -3 * s, 4.5 * s, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
      },
    });

    // 9. Mouth (Z-Index: 36)
    parts.push({
      id: 'mouth',
      type: 'mouth',
      name: 'Mouth',
      variant: dna.mouthVariant,
      zIndex: 36,
      jointAnchor: headSocket,
      draw: (ctx, origin, s, c, anim) => {
        ctx.save();
        ctx.translate(origin.x, origin.y + anim.bob * 1.15);
        ctx.strokeStyle = c.dark;
        ctx.fillStyle = '#ffffff';
        ctx.lineWidth = 2.0;

        ctx.beginPath();
        ctx.arc(0, 10 * s, 7 * s, 0.1 * Math.PI, 0.9 * Math.PI, false);
        ctx.stroke();

        if (dna.mouthVariant === 'fang') {
          // Cute fangs
          ctx.beginPath();
          ctx.moveTo(-5 * s, 10 * s);
          ctx.lineTo(-3 * s, 16 * s);
          ctx.lineTo(-1 * s, 10 * s);
          ctx.fill();
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(1 * s, 10 * s);
          ctx.lineTo(3 * s, 16 * s);
          ctx.lineTo(5 * s, 10 * s);
          ctx.fill();
          ctx.stroke();
        }

        ctx.restore();
      },
    });

    return {
      dna,
      parts: parts.sort((a, b) => a.zIndex - b.zIndex),
      colors,
      sockets: {
        root: rootSocket,
        head: headSocket,
        leftArm: leftArmSocket,
        rightArm: rightArmSocket,
        leftLeg: leftLegSocket,
        rightLeg: rightLegSocket,
        leftWing: leftWingSocket,
        rightWing: rightWingSocket,
        horns: hornsSocket,
        tail: tailSocket,
      },
    };
  }

  /**
   * Renders the composite creature to an HTML5 canvas with elemental affinity shaders
   */
  public static renderCritter(
    ctx: CanvasRenderingContext2D,
    manifest: CritterManifest,
    timeMs: number
  ): void {
    const timeSec = timeMs * 0.001;

    // Smooth idle bobbing and breathing calculation
    const anim = {
      bob: Math.sin(timeSec * 2.2) * 5.0,
      breath: Math.sin(timeSec * 2.2 + 0.4) * 0.04,
      sway: Math.sin(timeSec * 1.6) * 0.12,
      flap: Math.sin(timeSec * 4.2) * 0.22,
    };

    // Ambient elemental glow background halo
    const root = manifest.sockets.root;
    const radial = ctx.createRadialGradient(
      root.x,
      root.y + anim.bob,
      10,
      root.x,
      root.y + anim.bob,
      120 * manifest.dna.scale
    );
    radial.addColorStop(0, manifest.colors.glow);
    radial.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = radial;
    ctx.beginPath();
    ctx.arc(root.x, root.y + anim.bob, 120 * manifest.dna.scale, 0, Math.PI * 2);
    ctx.fill();

    // Render ordered parts
    for (const part of manifest.parts) {
      part.draw(ctx, part.jointAnchor, manifest.dna.scale, manifest.colors, anim);
    }
  }

  /**
   * Exports spliced creature into a high-resolution 2D card thumbnail
   */
  public static async exportToCardThumbnail(
    dna: CritterDNA,
    width = 400,
    height = 560
  ): Promise<string> {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Failed to get 2D canvas context');

    const colors = AFFINITY_COLOR_SCHEMES[dna.affinity];

    // 1. Card Background & Outer Frame
    const bgGradient = ctx.createLinearGradient(0, 0, width, height);
    bgGradient.addColorStop(0, '#090d16');
    bgGradient.addColorStop(0.5, '#0f172a');
    bgGradient.addColorStop(1, colors.dark);
    ctx.fillStyle = bgGradient;
    ctx.fillRect(0, 0, width, height);

    // Beveled Border
    ctx.strokeStyle = colors.primary;
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, width - 12, height - 12);

    ctx.strokeStyle = colors.highlight;
    ctx.lineWidth = 2;
    ctx.strokeRect(12, 12, width - 24, height - 24);

    // 2. Creature Portrait Frame
    const portraitW = width - 48;
    const portraitH = height * 0.55;
    ctx.fillStyle = '#020617';
    ctx.fillRect(24, 60, portraitW, portraitH);
    ctx.strokeStyle = colors.accent;
    ctx.lineWidth = 3;
    ctx.strokeRect(24, 60, portraitW, portraitH);

    // Render Critter in center of portrait
    const manifest = this.assembleManifest(dna, {
      x: width / 2,
      y: 60 + portraitH * 0.55,
    });
    this.renderCritter(ctx, manifest, 0);

    // 3. Header: Species Name & Affinity Badge
    ctx.fillStyle = '#ffffff';
    ctx.font = '900 22px system-ui, sans-serif';
    ctx.fillText(dna.speciesName.toUpperCase(), 28, 42);

    ctx.fillStyle = colors.primary;
    ctx.font = '800 13px system-ui, sans-serif';
    ctx.fillText(`[${dna.affinity.toUpperCase()}]`, width - 110, 42);

    // 4. Stats Summary Area
    const statY = 60 + portraitH + 28;
    ctx.fillStyle = '#94a3b8';
    ctx.font = '600 13px system-ui, sans-serif';
    ctx.fillText(`GEN ${dna.generation} HYBRID`, 28, statY);

    const drawStatBar = (
      label: string,
      val: number,
      y: number,
      barColor: string
    ) => {
      ctx.fillStyle = '#cbd5e1';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(label, 28, y);
      ctx.fillText(`${val}`, 85, y);

      // Bar container
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(115, y - 10, width - 150, 12);

      // Bar fill
      ctx.fillStyle = barColor;
      const fillW = Math.min((val / 120) * (width - 150), width - 150);
      ctx.fillRect(115, y - 10, fillW, 12);
    };

    drawStatBar('HP', dna.stats.hp, statY + 28, '#10b981');
    drawStatBar('ATK', dna.stats.attack, statY + 48, '#ef4444');
    drawStatBar('DEF', dna.stats.defense, statY + 68, '#3b82f6');
    drawStatBar('SPD', dna.stats.speed, statY + 88, '#f59e0b');

    // 5. SunShade Ecosystem Card Watermark
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.font = '10px monospace';
    ctx.fillText('SUNSHADE CRITTERVERSE © 2026', 28, height - 20);

    return canvas.toDataURL('image/png');
  }
}
