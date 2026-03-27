import { ConfigProvider, notification } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Sidebar } from './components/Sidebar';
import { TopAppBar } from './components/TopAppBar';
import { Footer } from './components/SystemDetails';
import { Dashboard } from './pages/Dashboard';
import { BatteryStatus } from './pages/BatteryStatus';
import { PowerStatistics } from './pages/PowerStatistics';
import { HistoryPage } from './pages/HistoryPage';
import { EventsPage } from './pages/EventsPage';
import { SettingsPage } from './pages/SettingsPage';
import { useUPSData } from './hooks/useUPSData';
import { useEffect } from 'react';

// Register Service Worker for push notifications
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}

function App() {
  const { data, connected, error, parsed, history, events } = useUPSData();

  useEffect(() => {
    if (error && !connected) {
      notification.error({
        message: 'Conexión Perdida',
        description: 'No se pudo contactar al backend del UPS. Reintentando...',
        placement: 'bottomRight',
        duration: 3,
      });
    }
  }, [error, connected]);

  return (
    <ConfigProvider
      theme={{
          token: {
            colorPrimary: '#77dd6d',
            colorBgContainer: '#1a1c1e',
            colorBgElevated: '#1a1c1e',
            colorBgBase: '#121416',
            colorText: '#e2e2e5',
            colorTextSecondary: '#94a3b8',
            colorTextPlaceholder: '#64748b',
            colorBorder: 'rgba(255,255,255,0.1)',
            colorBorderSecondary: 'rgba(255,255,255,0.06)',
          },
        }}
    >
      <BrowserRouter>
        <div className="flex min-h-screen bg-background text-on-background font-body selection:bg-primary selection:text-on-primary">
          <Sidebar data={data} events={events} />
          
          <main className="flex-1 md:ml-64 flex flex-col min-h-screen relative bg-industrial-gradient pb-20 md:pb-0">
            <TopAppBar />
            
            <div className="p-6 lg:p-10 space-y-10 max-w-7xl mx-auto w-full flex-1">
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/dashboard" element={<Dashboard data={data} parsed={parsed} connected={connected} history={history} />} />
                <Route path="/battery" element={<BatteryStatus data={data} parsed={parsed} connected={connected} />} />
                <Route path="/power" element={<PowerStatistics data={data} parsed={parsed} connected={connected} />} />
                <Route path="/history" element={<HistoryPage history={history} />} />
                <Route path="/events" element={<EventsPage events={events} />} />
                <Route path="/settings" element={<SettingsPage />} />
              </Routes>
            </div>

            <Footer />
          </main>
        </div>
      </BrowserRouter>
    </ConfigProvider>
  );
}

export default App;
