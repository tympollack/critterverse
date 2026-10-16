import {
  AffinityColors,
  CritterAnimationState,
  JointPoint,
} from '../types/critter';

export function drawWing(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  wingVariant: string,
  isRight: boolean
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob);
  const dir = isRight ? 1 : -1;
  ctx.rotate(dir * (0.25 + anim.flap));
  ctx.fillStyle = c.secondary;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2.5;

  if (wingVariant === 'feathered') {
    // Angelic / avian layered feathers
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * 45 * s, -40 * s, dir * 75 * s, -20 * s);
    ctx.quadraticCurveTo(dir * 65 * s, -5 * s, dir * 70 * s, 0);
    ctx.quadraticCurveTo(dir * 55 * s, 6 * s, dir * 58 * s, 12 * s);
    ctx.quadraticCurveTo(dir * 40 * s, 10 * s, dir * 42 * s, 18 * s);
    ctx.quadraticCurveTo(dir * 20 * s, 10 * s, 0, 0);
    ctx.fill();
    ctx.stroke();

    // Feather shaft detail
    ctx.strokeStyle = c.highlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 50 * s, -5 * s);
    ctx.stroke();
  } else if (wingVariant === 'bat') {
    // Webbed gothic bat wing with finger struts
    ctx.fillStyle = c.dark;
    ctx.strokeStyle = c.primary;
    ctx.lineWidth = 2.0;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 30 * s, -38 * s); // elbow
    ctx.lineTo(dir * 78 * s, -15 * s); // tip 1
    ctx.quadraticCurveTo(dir * 64 * s, 2 * s, dir * 54 * s, 18 * s); // tip 2
    ctx.quadraticCurveTo(dir * 38 * s, 8 * s, dir * 26 * s, 20 * s); // tip 3
    ctx.quadraticCurveTo(dir * 12 * s, 8 * s, 0, 0);
    ctx.fill();
    ctx.stroke();

    // Wing struts
    ctx.strokeStyle = c.secondary;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(dir * 30 * s, -38 * s);
    ctx.lineTo(dir * 54 * s, 18 * s);
    ctx.moveTo(dir * 30 * s, -38 * s);
    ctx.lineTo(dir * 26 * s, 20 * s);
    ctx.stroke();
  } else {
    // 'dragon' (default): Spiked reptilian wing with thumb spur
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(dir * 25 * s, -35 * s);
    ctx.lineTo(dir * 22 * s, -42 * s); // thumb spur
    ctx.lineTo(dir * 28 * s, -37 * s);
    ctx.lineTo(dir * 75 * s, -22 * s); // main tip
    ctx.quadraticCurveTo(dir * 55 * s, -8 * s, dir * 50 * s, 12 * s);
    ctx.quadraticCurveTo(dir * 30 * s, 6 * s, 0, 0);
    ctx.fill();
    ctx.stroke();
  }

  ctx.restore();
}

export function drawTail(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  tailVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob);

  if (tailVariant === 'whip') {
    // Sinuous whip tail
    ctx.rotate(-0.15 + anim.sway * 2.0);
    ctx.strokeStyle = c.primary;
    ctx.lineWidth = 5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.bezierCurveTo(-25 * s, 8 * s, -55 * s, 28 * s, -65 * s, 12 * s);
    ctx.bezierCurveTo(-72 * s, -2 * s, -60 * s, -12 * s, -50 * s, -6 * s);
    ctx.stroke();

    // Tip accent ring
    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.arc(-50 * s, -6 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
  } else if (tailVariant === 'demon') {
    // Spaded demon tail
    ctx.rotate(-0.15 + anim.sway * 1.5);
    ctx.strokeStyle = c.primary;
    ctx.lineWidth = 4.5 * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-35 * s, -10 * s, -55 * s, 20 * s);
    ctx.stroke();

    // Spade arrowhead
    ctx.save();
    ctx.translate(-55 * s, 20 * s);
    ctx.rotate(0.5);
    ctx.fillStyle = c.secondary;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, -12 * s);
    ctx.lineTo(12 * s, 6 * s);
    ctx.lineTo(4 * s, 4 * s);
    ctx.lineTo(0, 10 * s);
    ctx.lineTo(-4 * s, 4 * s);
    ctx.lineTo(-12 * s, 6 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    // 'fluffy' (default): Bushy fox tail
    ctx.rotate(-0.15 + anim.sway * 1.5);
    ctx.fillStyle = c.secondary;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.5;

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(-30 * s, 5 * s, -55 * s, 5 * s);
    ctx.quadraticCurveTo(-80 * s, -10 * s, -75 * s, -35 * s);
    ctx.quadraticCurveTo(-50 * s, -40 * s, -35 * s, -20 * s);
    ctx.quadraticCurveTo(-15 * s, -10 * s, 0, 0);
    ctx.fill();
    ctx.stroke();

    // Tip fluff highlight
    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.moveTo(-55 * s, -30 * s);
    ctx.quadraticCurveTo(-70 * s, -38 * s, -75 * s, -35 * s);
    ctx.quadraticCurveTo(-65 * s, -15 * s, -55 * s, -30 * s);
    ctx.closePath();
    ctx.fill();
  }

  ctx.restore();
}

export function drawLeg(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  limbsVariant: string,
  isRight: boolean
): void {
  ctx.save();
  // Animate with torso bob to prevent detachment
  ctx.translate(origin.x, origin.y + anim.bob);
  const dir = isRight ? 1 : -1;
  ctx.fillStyle = c.primary;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2.5;

  if (limbsVariant === 'claws') {
    // Raptor / dragon talons
    ctx.beginPath();
    ctx.ellipse(0, 8 * s, 13 * s, 16 * s, dir * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    for (const offset of [-7, 0, 7]) {
      ctx.beginPath();
      ctx.moveTo((offset - 2.5) * s, 20 * s);
      ctx.lineTo(offset * s, 28 * s);
      ctx.lineTo((offset + 2.5) * s, 20 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (limbsVariant === 'hooves') {
    // Heavy pillar leg ending in cloven hoof
    ctx.beginPath();
    ctx.rect(-10 * s, 0, 20 * s, 18 * s);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.dark;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.rect(-11 * s, 16 * s, 10 * s, 9 * s);
    ctx.rect(1 * s, 16 * s, 10 * s, 9 * s);
    ctx.fill();
    ctx.stroke();
  } else if (limbsVariant === 'fins') {
    // Aquatic rear flipper fin
    ctx.beginPath();
    ctx.moveTo(-6 * s, 0);
    ctx.quadraticCurveTo(dir * -18 * s, 14 * s, dir * -22 * s, 26 * s);
    ctx.quadraticCurveTo(0, 22 * s, dir * 16 * s, 26 * s);
    ctx.quadraticCurveTo(dir * 8 * s, 12 * s, 6 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = c.highlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 2 * s);
    ctx.lineTo(dir * -10 * s, 24 * s);
    ctx.moveTo(0, 2 * s);
    ctx.lineTo(0, 22 * s);
    ctx.moveTo(0, 2 * s);
    ctx.lineTo(dir * 10 * s, 24 * s);
    ctx.stroke();
  } else {
    // 'paws' (default): Rounded paws with toe pads
    ctx.beginPath();
    ctx.ellipse(0, 10 * s, 14 * s, 18 * s, dir * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.secondary;
    ctx.beginPath();
    ctx.arc(-7 * s, 23 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.arc(0, 25 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.arc(7 * s, 23 * s, 3.5 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawBody(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  bodyVariant: string
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob);

  const breathScale = 1 + anim.breath;
  ctx.scale(breathScale, breathScale);

  ctx.fillStyle = c.primary;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 3.0;

  if (bodyVariant === 'beast') {
    // Broad muscular shoulders tapering to waist
    ctx.beginPath();
    ctx.moveTo(-45 * s, -22 * s);
    ctx.quadraticCurveTo(0, -32 * s, 45 * s, -22 * s);
    ctx.quadraticCurveTo(38 * s, 8 * s, 28 * s, 36 * s);
    ctx.quadraticCurveTo(0, 42 * s, -28 * s, 36 * s);
    ctx.quadraticCurveTo(-38 * s, 8 * s, -45 * s, -22 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Pectoral armor plates
    ctx.fillStyle = c.secondary;
    ctx.beginPath();
    ctx.ellipse(-14 * s, -4 * s, 12 * s, 14 * s, 0.2, 0, Math.PI * 2);
    ctx.ellipse(14 * s, -4 * s, 12 * s, 14 * s, -0.2, 0, Math.PI * 2);
    ctx.fill();
  } else if (bodyVariant === 'serpentine') {
    // Sinuous elongated body with abdominal plates
    ctx.beginPath();
    ctx.ellipse(0, 0, 32 * s, 46 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.8;
    for (let yOff = -24; yOff <= 24; yOff += 12) {
      ctx.beginPath();
      ctx.ellipse(0, yOff * s, 16 * s, 5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (bodyVariant === 'compact') {
    // Crystalline / gem shell torso
    ctx.beginPath();
    ctx.moveTo(0, -38 * s);
    ctx.lineTo(38 * s, -12 * s);
    ctx.lineTo(32 * s, 28 * s);
    ctx.lineTo(0, 38 * s);
    ctx.lineTo(-32 * s, 28 * s);
    ctx.lineTo(-38 * s, -12 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // Core crystal
    ctx.fillStyle = c.highlight;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 2.0;
    ctx.beginPath();
    ctx.moveTo(0, -14 * s);
    ctx.lineTo(14 * s, 0);
    ctx.lineTo(0, 14 * s);
    ctx.lineTo(-14 * s, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else {
    // 'chubby' (default): Round cuddly torso with belly patch
    ctx.beginPath();
    ctx.ellipse(0, 0, 46 * s, 42 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.ellipse(0, 8 * s, 25 * s, 22 * s, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

export function drawArm(
  ctx: CanvasRenderingContext2D,
  origin: JointPoint,
  s: number,
  c: AffinityColors,
  anim: CritterAnimationState,
  limbsVariant: string,
  isRight: boolean
): void {
  ctx.save();
  ctx.translate(origin.x, origin.y + anim.bob);
  const dir = isRight ? 1 : -1;
  ctx.rotate(dir * 0.2 + (isRight ? -1 : 1) * anim.sway * 0.8);
  ctx.fillStyle = c.secondary;
  ctx.strokeStyle = c.dark;
  ctx.lineWidth = 2.5;

  if (limbsVariant === 'claws') {
    // Arm ending in sharp talons
    ctx.beginPath();
    ctx.ellipse(dir * 8 * s, 7 * s, 10 * s, 15 * s, dir * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    for (const offset of [-4, 4]) {
      ctx.beginPath();
      ctx.moveTo((dir * 8 + offset - 2) * s, 19 * s);
      ctx.lineTo((dir * 8 + offset) * s, 27 * s);
      ctx.lineTo((dir * 8 + offset + 2) * s, 19 * s);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
  } else if (limbsVariant === 'hooves') {
    // Foreleg with hoof cuff
    ctx.beginPath();
    ctx.ellipse(dir * 8 * s, 7 * s, 9 * s, 14 * s, dir * 0.25, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.dark;
    ctx.strokeStyle = c.dark;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.rect((dir * 8 - 7) * s, 16 * s, 14 * s, 7 * s);
    ctx.fill();
    ctx.stroke();
  } else if (limbsVariant === 'fins') {
    // Pectoral flipper fin
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(dir * 28 * s, 4 * s, dir * 34 * s, 20 * s);
    ctx.quadraticCurveTo(dir * 18 * s, 22 * s, 0, 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = c.highlight;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, 4 * s);
    ctx.lineTo(dir * 26 * s, 17 * s);
    ctx.stroke();
  } else {
    // 'paws' (default): Rounded arm with paw pads
    ctx.beginPath();
    ctx.ellipse(dir * 8 * s, 8 * s, 10 * s, 15 * s, dir * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = c.highlight;
    ctx.beginPath();
    ctx.arc(dir * 12 * s, 18 * s, 3.2 * s, 0, Math.PI * 2);
    ctx.arc(dir * 5 * s, 20 * s, 3.2 * s, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}
