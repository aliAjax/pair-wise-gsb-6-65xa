import { useState } from 'react';
import { ArrowLeftRight, Type } from 'lucide-react';
import MigrationConsole from './MigrationConsole';
import Studio from './Studio';

type View = 'migration' | 'studio';

export default function App() {
  const [view, setView] = useState<View>('migration');
  return (
    <div className="app-shell">
      <div className="app-switch">
        <button className={view === 'migration' ? 'active' : ''} onClick={() => setView('migration')}>
          <ArrowLeftRight size={14} /> 品牌隔离迁移
        </button>
        <button className={view === 'studio' ? 'active' : ''} onClick={() => setView('studio')}>
          <Type size={14} /> 旧版配对 Studio（全局数据，原样保留）
        </button>
      </div>
      {view === 'migration' ? <MigrationConsole /> : <Studio />}
    </div>
  );
}
