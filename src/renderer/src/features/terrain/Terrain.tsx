import './terrain.css';
import { Workbench } from './Workbench';

export function Terrain({ active, settingsRevision }: { active: boolean; settingsRevision: number; onOpenSettings(): void }) {
  return <section className="terrain-system" hidden={!active} aria-label="地形"><Workbench key={settingsRevision} active={active} /></section>;
}
