import { CritterViewport } from '@/src/components/CritterViewport';

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-center items-center py-6 px-4">
      <CritterViewport />
    </main>
  );
}
