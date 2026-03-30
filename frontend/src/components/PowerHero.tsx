import type { UPSData } from '../hooks/useUPSData';

export function PowerHero({ data }: { data: UPSData | null; parsed: unknown }) {
  const linefreq = data?.LINEFREQ ? parseFloat(data.LINEFREQ).toFixed(1) : '60.0';
  const model = data?.MODEL || '';
  const uptime = data?.STARTTIME || 'Desconocida';

  return (
    <div className="flex flex-col md:flex-row justify-between items-end gap-6 border-b border-outline-variant/10 pb-8">
      <div>
        <div className="text-primary text-xs font-bold uppercase tracking-widest mb-2 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
          Datos de Calidad de Energía en Vivo
        </div>
        <h1 className="font-headline text-3xl md:text-4xl font-bold tracking-tight text-on-background">{model}</h1>
        <p className="text-slate-400 mt-2 font-body max-w-lg">Monitoreando en tiempo real la estabilidad de la energía, umbrales de voltaje e historial de transferencias.</p>
      </div>
      <div className="flex gap-4">
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase font-bold">Hora de Inicio</div>
          <div className="font-headline text-lg tabular-nums mt-1">{uptime}</div>
        </div>
        <div className="w-px h-10 bg-outline-variant/20 self-center"></div>
        <div className="text-right">
          <div className="text-[10px] text-slate-500 uppercase font-bold">Frecuencia de Entrada</div>
          <div className="font-headline text-lg tabular-nums text-primary mt-1">{linefreq} <span className="text-sm font-normal text-slate-500">Hz</span></div>
        </div>
      </div>
    </div>
  );
}
