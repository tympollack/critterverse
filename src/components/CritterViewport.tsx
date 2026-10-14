'use client';

import React, { useEffect, useRef, useState, useCallback } from 'react';
import {
  CritterDNA,
  ElementalAffinity,
  CritterStats,
} from '../types/critter';
import {
  CritterAssembler,
  AFFINITY_COLOR_SCHEMES,
} from '../engine/CritterAssembler';
import {
  Flame,
  Droplets,
  Leaf,
  Moon,
  Dna,
  Shuffle,
  Download,
  Sparkles,
  Shield,
  Zap,
  Heart,
  Swords,
  ChevronRight,
} from 'lucide-react';

const AFFINITY_CONFIG: Record<
  ElementalAffinity,
  { name: string; icon: React.ComponentType<{ className?: string }>; bg: string; border: string; text: string }
> = {
  fire: {
    name: 'Fire',
    icon: Flame,
    bg: 'bg-red-500/10 hover:bg-red-500/20',
    border: 'border-red-500/30',
    text: 'text-red-400',
  },
  water: {
    name: 'Water',
    icon: Droplets,
    bg: 'bg-cyan-500/10 hover:bg-cyan-500/20',
    border: 'border-cyan-500/30',
    text: 'text-cyan-400',
  },
  grass: {
    name: 'Grass',
    icon: Leaf,
    bg: 'bg-emerald-500/10 hover:bg-emerald-500/20',
    border: 'border-emerald-500/30',
    text: 'text-emerald-400',
  },
  shadow: {
    name: 'Shadow',
    icon: Moon,
    bg: 'bg-purple-500/10 hover:bg-purple-500/20',
    border: 'border-purple-500/30',
    text: 'text-purple-400',
  },
};

export const CritterViewport: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const [activeCritter, setActiveCritter] = useState<CritterDNA>(() =>
    CritterAssembler.generateRandomDNA('fire')
  );
  const [parentCritter, setParentCritter] = useState<CritterDNA | null>(null);
  const [exportedImage, setExportedImage] = useState<string | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  // Initialize and run the 60fps canvas animation loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let startTime = performance.now();

    const render = (now: number) => {
      const elapsed = now - startTime;

      // Clear Canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Canvas background grid & subtle vignette
      const bgGrad = ctx.createRadialGradient(
        canvas.width / 2,
        canvas.height / 2,
        40,
        canvas.width / 2,
        canvas.height / 2,
        canvas.width * 0.7
      );
      bgGrad.addColorStop(0, '#111827');
      bgGrad.addColorStop(1, '#030712');
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Subtle isometric grid lines
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
      ctx.lineWidth = 1;
      const step = 30;
      for (let x = 0; x < canvas.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Assemble manifest and render
      const manifest = CritterAssembler.assembleManifest(activeCritter, {
        x: canvas.width / 2,
        y: canvas.height / 2 + 10,
      });

      CritterAssembler.renderCritter(ctx, manifest, elapsed);

      animFrameRef.current = requestAnimationFrame(render);
    };

    animFrameRef.current = requestAnimationFrame(render);

    return () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
      }
    };
  }, [activeCritter]);

  // Handle randomize
  const handleRandomize = useCallback((affinity?: ElementalAffinity) => {
    const nextDNA = CritterAssembler.generateRandomDNA(affinity ?? activeCritter.affinity);
    setActiveCritter(nextDNA);
  }, [activeCritter.affinity]);

  // Handle affinity shift
  const handleAffinityChange = useCallback((affinity: ElementalAffinity) => {
    setActiveCritter((prev) => ({
      ...prev,
      affinity,
    }));
  }, []);

  // Handle DNA Splicing
  const handleSplice = useCallback(() => {
    const mate = parentCritter ?? CritterAssembler.generateRandomDNA();
    const hybrid = CritterAssembler.spliceDNA(activeCritter, mate);
    setParentCritter(activeCritter);
    setActiveCritter(hybrid);
  }, [activeCritter, parentCritter]);

  // Handle Export to 2D card thumbnail
  const handleExportCard = useCallback(async () => {
    setIsExporting(true);
    try {
      const dataUrl = await CritterAssembler.exportToCardThumbnail(activeCritter);
      setExportedImage(dataUrl);

      // Create download trigger
      const link = document.createElement('a');
      link.download = `${activeCritter.speciesName.toLowerCase()}-card.png`;
      link.href = dataUrl;
      link.click();
    } catch (e) {
      console.error('Failed to export card thumbnail', e);
    } finally {
      setIsExporting(false);
    }
  }, [activeCritter]);

  const affinityDetails = AFFINITY_CONFIG[activeCritter.affinity];
  const colorScheme = AFFINITY_COLOR_SCHEMES[activeCritter.affinity];

  return (
    <div className="w-full max-w-6xl mx-auto p-4 md:p-8 flex flex-col gap-6 text-slate-100 font-sans">
      {/* Top Header */}
      <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-slate-800 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-lg bg-indigo-500/20 text-indigo-400 border border-indigo-500/30">
              <Dna className="w-5 h-5" />
            </span>
            <h1 className="text-2xl md:text-3xl font-extrabold tracking-tight">
              Critterverse Splicer
            </h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              Kenney Modular Rig
            </span>
          </div>
          <p className="text-sm text-slate-400 mt-1">
            Procedural modular monster generator with elemental affinity tint shaders and DNA splicing
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={() => handleRandomize()}
            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 text-sm font-semibold rounded-lg border border-slate-700 transition"
          >
            <Shuffle className="w-4 h-4 text-slate-400" />
            Randomize
          </button>
          <button
            onClick={handleSplice}
            className="flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-indigo-600 to-violet-600 hover:from-indigo-500 hover:to-violet-500 active:scale-95 text-white text-sm font-semibold rounded-lg shadow-lg shadow-indigo-600/30 transition"
          >
            <Sparkles className="w-4 h-4" />
            Splice DNA (Gen {activeCritter.generation})
          </button>
        </div>
      </header>

      {/* Main Workspace: Canvas Stage + Controls Sidebar */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Viewport Canvas Stage (7 cols) */}
        <div className="lg:col-span-7 flex flex-col gap-3">
          <div className="relative rounded-2xl overflow-hidden border border-slate-800 shadow-2xl bg-slate-950 flex items-center justify-center">
            {/* Viewport Canvas */}
            <canvas
              ref={canvasRef}
              width={480}
              height={440}
              className="w-full h-auto max-w-full block"
            />

            {/* In-Canvas Badge Overlays */}
            <div className="absolute top-4 left-4 flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 backdrop-blur-md border border-slate-700/60 shadow-lg text-xs font-bold uppercase tracking-wider">
              <span
                className="w-2.5 h-2.5 rounded-full animate-pulse"
                style={{ backgroundColor: colorScheme.primary }}
              />
              <span style={{ color: colorScheme.highlight }}>
                {activeCritter.speciesName}
              </span>
              <span className="text-slate-400 font-normal">
                [Gen {activeCritter.generation}]
              </span>
            </div>

            <div className="absolute bottom-4 left-4 right-4 flex items-center justify-between text-xs text-slate-400 bg-slate-950/70 backdrop-blur-sm px-3 py-2 rounded-xl border border-slate-800/80">
              <div className="flex gap-4">
                <span>Head: <strong className="text-slate-200 capitalize">{activeCritter.headVariant}</strong></span>
                <span>Body: <strong className="text-slate-200 capitalize">{activeCritter.bodyVariant}</strong></span>
                <span>Wings: <strong className="text-slate-200 capitalize">{activeCritter.wingsVariant ?? 'None'}</strong></span>
              </div>
              <span className="font-mono text-slate-500">60 FPS SINE BOB</span>
            </div>
          </div>

          {/* Export Action Bar */}
          <div className="flex items-center justify-between bg-slate-900/80 border border-slate-800 p-3 rounded-xl">
            <span className="text-xs text-slate-400">
              Ready to export creature into 2D trading card raster format.
            </span>
            <button
              onClick={handleExportCard}
              disabled={isExporting}
              className="flex items-center gap-2 px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white text-xs font-bold rounded-lg shadow-md transition"
            >
              <Download className="w-3.5 h-3.5" />
              {isExporting ? 'Exporting...' : 'Export 2D Card Thumbnail'}
            </button>
          </div>
        </div>

        {/* Controls & Splicer Deck (5 cols) */}
        <div className="lg:col-span-5 flex flex-col gap-5">
          {/* Affinity Shader Matrix */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider flex items-center justify-between">
              <span>Elemental Affinity Tint</span>
              <span
                className="text-xs font-mono uppercase px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: colorScheme.glow,
                  color: colorScheme.highlight,
                }}
              >
                {activeCritter.affinity}
              </span>
            </h2>

            <div className="grid grid-cols-2 gap-3">
              {(['fire', 'water', 'grass', 'shadow'] as ElementalAffinity[]).map((aff) => {
                const config = AFFINITY_CONFIG[aff];
                const Icon = config.icon;
                const isSelected = activeCritter.affinity === aff;

                return (
                  <button
                    key={aff}
                    onClick={() => handleAffinityChange(aff)}
                    className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-all ${
                      isSelected
                        ? `${config.bg} ${config.border} ring-2 ring-offset-2 ring-offset-slate-950 ring-indigo-500/50`
                        : 'bg-slate-950/40 border-slate-800 hover:bg-slate-800/40'
                    }`}
                  >
                    <span className={`p-2 rounded-lg bg-slate-900/80 ${config.text}`}>
                      <Icon className="w-4 h-4" />
                    </span>
                    <div>
                      <div className="text-sm font-bold text-slate-200 capitalize">
                        {config.name}
                      </div>
                      <div className="text-xs text-slate-500">
                        Tint & Aura
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Critter Stats & Attributes */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-4">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Creature DNA Attributes
            </h2>

            <div className="flex flex-col gap-3">
              <StatBar
                label="Health Points"
                value={activeCritter.stats.hp}
                max={120}
                icon={Heart}
                colorClass="bg-emerald-500"
              />
              <StatBar
                label="Attack Power"
                value={activeCritter.stats.attack}
                max={120}
                icon={Swords}
                colorClass="bg-red-500"
              />
              <StatBar
                label="Defense Armor"
                value={activeCritter.stats.defense}
                max={120}
                icon={Shield}
                colorClass="bg-cyan-500"
              />
              <StatBar
                label="Agility Speed"
                value={activeCritter.stats.speed}
                max={120}
                icon={Zap}
                colorClass="bg-amber-500"
              />
            </div>
          </div>

          {/* Splicing History / Genealogy */}
          <div className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-lg flex flex-col gap-3">
            <h2 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
              Splicing Genealogy
            </h2>
            <div className="flex items-center gap-3 text-xs bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
              <div className="flex-1">
                <div className="text-slate-500">Parent Anchor</div>
                <div className="font-semibold text-slate-200">
                  {parentCritter ? parentCritter.speciesName : 'Wild Stock Alpha'}
                </div>
              </div>
              <ChevronRight className="w-4 h-4 text-slate-600" />
              <div className="flex-1">
                <div className="text-slate-500">Current Offspring</div>
                <div className="font-semibold text-indigo-400">
                  {activeCritter.speciesName}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Export Preview Modal */}
      {exportedImage && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-sm w-full p-5 flex flex-col gap-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-400" />
                2D Card Generated
              </h3>
              <button
                onClick={() => setExportedImage(null)}
                className="text-slate-400 hover:text-white text-sm"
              >
                ✕
              </button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={exportedImage}
              alt="Exported Critter Card"
              className="w-full rounded-xl border border-slate-800 shadow-md"
            />
            <button
              onClick={() => setExportedImage(null)}
              className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold rounded-lg transition"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

interface StatBarProps {
  label: string;
  value: number;
  max: number;
  icon: React.ComponentType<{ className?: string }>;
  colorClass: string;
}

const StatBar: React.FC<StatBarProps> = ({
  label,
  value,
  max,
  icon: Icon,
  colorClass,
}) => {
  const percent = Math.min(Math.round((value / max) * 100), 100);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 text-slate-400 font-medium">
          <Icon className="w-3.5 h-3.5" />
          {label}
        </span>
        <span className="font-mono font-bold text-slate-200">{value}</span>
      </div>
      <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
        <div
          className={`h-full ${colorClass} transition-all duration-300 rounded-full`}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
};

export default CritterViewport;
