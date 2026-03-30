import { NavLink } from 'react-router-dom';
import type { UPSData } from '../hooks/useUPSData';
import type { UPSEvent } from '../hooks/useUPSData';
import { useAuth } from '../contexts/AuthContext';
import { LogoutOutlined } from '@ant-design/icons';

interface Props {
  data: UPSData | null;
  events?: UPSEvent[];
}

export function Sidebar({ data, events = [] }: Props) {
  const { logout } = useAuth();
  const isOnline = data?.STATUS?.includes('ONLINE');
  const criticalCount = events.filter(e => e.severity === 'critical').length;

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "flex items-center gap-3 px-6 py-3 text-[#77dd6d] border-r-2 border-[#77dd6d] bg-[#121416] transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium"
      : "flex items-center gap-3 px-6 py-3 text-slate-500 hover:text-slate-200 hover:bg-[#282a2c] transition-all duration-200 ease-in-out font-['Inter'] text-sm font-medium";

  const mobileNavLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? "flex flex-col items-center gap-1 text-[#77dd6d]"
      : "flex flex-col items-center gap-1 text-slate-500";

  return (
    <>
      <aside className="hidden md:flex flex-col h-screen w-64 left-0 border-r border-[#3f4a3b]/15 bg-[#1a1c1e] py-4 fixed z-50">
        <div className="px-6 mb-8">
          <img src="/logo.svg" alt="Mira" className="h-8" />
          <div className="text-[10px] uppercase tracking-widest text-slate-500 font-bold mt-1">
            {isOnline ? 'Online' : 'On Battery'} - {data?.LINEV || 'N/A'}
          </div>
        </div>
        <nav className="flex-1 space-y-1">
          <NavLink to="/dashboard" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="dashboard">dashboard</span>
            <span className="font-medium text-sm">Resumen</span>
          </NavLink>
          <NavLink to="/battery" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="battery_charging_full">battery_charging_full</span>
            <span className="font-medium text-sm">Estado de Batería</span>
          </NavLink>
          <NavLink to="/power" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="bar_chart">bar_chart</span>
            <span className="font-medium text-sm">Estadísticas de Energía</span>
          </NavLink>
          <NavLink to="/history" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="analytics">analytics</span>
            <span className="font-medium text-sm">Historial</span>
          </NavLink>
          <NavLink to="/events" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="warning_amber">warning_amber</span>
            <span className="font-medium text-sm flex-1">Eventos</span>
            {criticalCount > 0 && (
              <span className="text-[9px] font-black bg-red-500 text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center leading-none">
                {criticalCount}
              </span>
            )}
          </NavLink>
          <NavLink to="/settings" className={navLinkClass}>
            <span className="material-symbols-outlined mr-3" data-icon="settings">settings</span>
            <span className="font-medium text-sm">Configuración</span>
          </NavLink>
        </nav>
        <div className="px-6 mt-auto mb-4 space-y-4">
          <button
            onClick={logout}
            className="flex items-center gap-3 px-4 py-2 w-full text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors rounded-lg font-['Inter'] text-sm font-medium border border-red-500/20"
          >
            <LogoutOutlined />
            <span>Cerrar Sesión</span>
          </button>
          <div className="p-3 rounded bg-surface-container-lowest border border-outline-variant/10 text-center">
            <span className="text-[10px] text-slate-500 uppercase font-bold">Controlador:</span>
            <p className="text-xs text-on-surface truncate">{data?.DRIVER || 'N/A'}</p>
          </div>
        </div>
      </aside>

      {/* Mobile Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[#121416] flex justify-around items-center py-3 z-50 border-t border-outline-variant/10 pb-6">
        <NavLink to="/dashboard" className={mobileNavLinkClass}>
          <span className="material-symbols-outlined" data-icon="dashboard">dashboard</span>
        </NavLink>
        <NavLink to="/battery" className={mobileNavLinkClass}>
          <span className="material-symbols-outlined" data-icon="battery_charging_full">battery_charging_full</span>
        </NavLink>
        <NavLink to="/power" className={mobileNavLinkClass}>
          <span className="material-symbols-outlined" data-icon="bar_chart">bar_chart</span>
        </NavLink>
        <NavLink to="/history" className={mobileNavLinkClass}>
          <span className="material-symbols-outlined" data-icon="analytics">analytics</span>
        </NavLink>
        <NavLink to="/events" className={mobileNavLinkClass}>
          <div className="relative">
            <span className="material-symbols-outlined" data-icon="warning_amber">warning_amber</span>
            {criticalCount > 0 && (
              <span className="absolute -top-1 -right-1 text-[8px] font-black bg-red-500 text-white rounded-full w-3.5 h-3.5 flex items-center justify-center">
                {criticalCount > 9 ? '9+' : criticalCount}
              </span>
            )}
          </div>
        </NavLink>
        <NavLink to="/settings" className={mobileNavLinkClass}>
          <span className="material-symbols-outlined" data-icon="settings">settings</span>
        </NavLink>
      </nav>
    </>
  );
}
