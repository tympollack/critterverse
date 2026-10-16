import {
  AffinityColors,
  CritterAnimationState,
  JointPoint,
} from '../types/critter';

export function drawHead(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  headVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob * 1.15);

  ctx.fillStyle = c.primary;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 3.0;

  if (headVariant === 'draconic') {
    // Angular draconic snout and swept brow ridges
    ctx.beginPath();
    ctx.moveTo(-30 * s, -26 * s);
    ctx.lineTo(0, -32 * s);
    ctx.lineTo(30 * s, -26 * s);
    ctx.lineTo(36 * s, -8 * s);
    ctx.lineTo(24 * s, 18 * s);
    ctx.lineTo(0, 24 * s);
    ctx.lineTo(-24 * s, 18 * s);
    ctx.lineTo(-36 * s, -8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Brow ridge line
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(-25 * s, -14 * s);
    ctx.lineTo(0, -8 * s);
    ctx.lineTo(25 * s, -14 * s);
    ctx.stroke();
  } else if (headVariant === 'feline') {
    // Feline head with triangular ears
    ctx.beginPath();
    ctx.moveTo(-28 * s, -15 * s);
    ctx.lineTo(-34 * s, -38 * s); // left ear
    ctx.lineTo(-12 * s, -26 * s);
    ctx.lineTo(12 * s, -26 * s);
    ctx.lineTo(34 * s, -38 * s); // right ear
    ctx.lineTo(28 * s, -15 * s);
    ctx.quadraticCurveTo(38 * s, 15 * s, 0, 28 * s);
    ctx.quadraticCurveTo(-38 * s, 15 * s, -28 * s, -15 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Inner ear fur
    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.moveTo(-26 * s, -18 * s);
    ctx.lineTo(-31 * s, -33 * s);
    ctx.lineTo(-16 * s, -24 * s);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(26 * s, -18 * s);
    ctx.lineTo(31 * s, -33 * s);
    ctx.lineTo(16 * s, -24 * s);
    ctx.closePath();
    ctx.fill();
  } else if (headVariant === 'avian') {
    // Avian raptor skull with rear crest
    ctx.fillStyle = c.secondary;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(-10 * s, -28 * s);
    ctx.quadraticCurveTo(-28 * s, -44 * s, -40 * s, -32 * s);
    ctx.quadraticCurveTo(-26 * s, -22 * s, -18 * s, -18 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.primary;
    ctx.lineWidth = 3.0;
    ctx.beginPath();
    ctx.moveTo(-24 * s, -20 * s);
    ctx.quadraticCurveTo(0, -34 * s, 26 * s, -18 * s);
    ctx.quadraticCurveTo(34 * s, 5 * s, 20 * s, 22 * s);
    ctx.quadraticCurveTo(0, 30 * s, -24 * s, 16 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // 'round' (default): Sphere skull with cheek patches
    ctx.beginPath();
    ctx.ellipse(0, 0, 36 * s, 32 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.arc(-22 * s, 8 * s, 5 * s, 0, Math.PI * 2);
    ctx.arc(22 * s, 8 * s, 5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawHorns(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  hornsVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob * 1.15);
  ctx.fillStyle = c.highlight;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2.0;

  if (hornsVariant === 'ram') {
    // Spiral curled ram horns
    ctx.strokeStyle = c.highlight;
    ctx.lineWidth = 6 * s;
    ctx.beginPath();
    ctx.arc(-22 * s, -6 * s, 12 * s, 0.4 * Math.PI, 1.8 * Math.PI);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(22 * s, -6 * s, 12 * s, 1.2 * Math.PI, 2.6 * Math.PI);
    ctx.stroke();
  } else if (hornsVariant === 'crown') {
    // Three-pointed crystal tiara crown
    ctx.beginPath();
    ctx.moveTo(-22 * s, 0);
    ctx.lineTo(-24 * s, -20 * s);
    ctx.lineTo(-14 * s, -10 * s);
    ctx.lineTo(0, -28 * s);
    ctx.lineTo(14 * s, -10 * s);
    ctx.lineTo(24 * s, -20 * s);
    ctx.lineTo(22 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Center jewel
    ctx.fillStyle = c.accent;
    ctx.beginPath();
    ctx.arc(0, -8 * s, 4 * s, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // 'curved' (default): Swept-back curved horns
    ctx.beginPath();
    ctx.moveTo(-18 * s, 0);
    ctx.quadraticCurveTo(-30 * s, -26 * s, -16 * s, -32 * s);
    ctx.quadraticCurveTo(-10 * s, -18 * s, -8 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(8 * s, 0);
    ctx.quadraticCurveTo(10 * s, -18 * s, 16 * s, -32 * s);
    ctx.quadraticCurveTo(30 * s, -26 * s, 18 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

export function drawEyes(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  eyesVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob * 1.15);

  if (eyesVariant === 'focused') {
    // Sharp predator slit eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(dir * 14 * s, -4 * s, 8 * s, 6 * s, dir * 0.15, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.dark;
      ctx.beginPath();
      ctx.ellipse(dir * 14 * s, -4 * s, 2.5 * s, 5.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (eyesVariant === 'wide') {
    // Large round curious eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(dir * 14 * s, -4 * s, 9 * s, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.dark;
      ctx.beginPath();
      ctx.arc(dir * 14 * s, -4 * s, 6 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc((dir * 14 - 2) * s, -6 * s, 2.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (eyesVariant === 'mystic') {
    // Glowing runic / elemental sigil eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = c.highlight;
      ctx.beginPath();
      ctx.arc(dir * 14 * s, -4 * s, 8 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = c.accent;
      ctx.lineWidth = 2.0;
      ctx.beginPath();
      ctx.arc(dir * 14 * s, -4 * s, 4.5 * s, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(dir * 14 * s, -4 * s, 2 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  } else {
    // 'cute' (default): Chibi anime double sparkle eyes
    for (const dir of [-1, 1]) {
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = c.dark;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(dir * 14 * s, -4 * s, 8.5 * s, 10 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = c.dark;
      ctx.beginPath();
      ctx.ellipse(dir * 14 * s, -3 * s, 6.5 * s, 7.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc((dir * 14 - 2.5) * s, -6 * s, 2.8 * s, 0, Math.PI * 2);
      ctx.fill();

      ctx.beginPath();
      ctx.arc((dir * 14 + 2) * s, -1 * s, 1.5 * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

export function drawMouth(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  mouthVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob * 1.15);
  ctx.strokeStyle = c.dark;
  ctx.fillStyle = '#ffffff';
  ctx.lineWidth = 2.0;

  if (mouthVariant === 'smile') {
    // Open smiling mouth with rosy tongue
    ctx.beginPath();
    ctx.arc(0, 8 * s, 10 * s, 0, Math.PI, false);
    ctx.fillStyle = c.dark;
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.secondary;
    ctx.beginPath();
    ctx.arc(0, 14 * s, 6 * s, Math.PI, 0, false);
    ctx.fill();
  } else if (mouthVariant === 'neutral') {
    // Stoic straight mouth
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(-8 * s, 12 * s);
    ctx.lineTo(8 * s, 12 * s);
    ctx.stroke();
  } else if (mouthVariant === 'beak') {
    // Pointed avian beak
    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.moveTo(-8 * s, 7 * s);
    ctx.lineTo(0, 18 * s);
    ctx.lineTo(8 * s, 7 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(0, 7 * s);
    ctx.lineTo(0, 18 * s);
    ctx.stroke();
  } else {
    // 'fang' (default): Smile with two hanging fangs
    ctx.beginPath();
    ctx.arc(0, 10 * s, 7 * s, 0.1 * Math.PI, 0.9 * Math.PI, false);
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(-5 * s, 10 * s);
    ctx.lineTo(-3 * s, 16 * s);
    ctx.lineTo(-1 * s, 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(1 * s, 10 * s);
    ctx.lineTo(3 * s, 16 * s);
    ctx.lineTo(5 * s, 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}
