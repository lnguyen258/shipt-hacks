'use client';

import { useEffect, useState } from 'react';
import './splash.css';

/** How long the avocado takes to walk the whole track. Splash never hides before this. */
const WALK_MS = 3600;
const FADE_MS = 450;

/** Full-screen loading splash: the avocado mascot walks left to right, then the app fades in. */
export default function Splash() {
  const [phase, setPhase] = useState<'walk' | 'fade' | 'done'>('walk');

  useEffect(() => {
    const t1 = setTimeout(() => setPhase('fade'), WALK_MS);
    const t2 = setTimeout(() => setPhase('done'), WALK_MS + FADE_MS);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, []);

  if (phase === 'done') return null;
  return (
    <div className={`rpgb-splash${phase === 'fade' ? ' is-fading' : ''}`} role="status" aria-label="Loading">
      <div className="rpgb-splash__title">RPG Birmingham</div>
      <div className="rpgb-splash__track" style={{ ['--walk' as string]: `${WALK_MS}ms` }}>
        <div className="rpgb-splash__walker">
          <svg className="rpgb-avo" viewBox="0 0 64 80" width="64" height="80" aria-hidden>
            <g className="rpgb-avo__leg rpgb-avo__leg--l"><rect x="20" y="62" width="9" height="14" rx="4" fill="#3f7a2e" /><ellipse cx="22" cy="76" rx="8" ry="3.5" fill="#4a3328" /></g>
            <g className="rpgb-avo__leg rpgb-avo__leg--r"><rect x="35" y="62" width="9" height="14" rx="4" fill="#3f7a2e" /><ellipse cx="42" cy="76" rx="8" ry="3.5" fill="#4a3328" /></g>
            <g className="rpgb-avo__body">
              <path d="M32 4C20 4 12 22 12 40c0 14 8 26 20 26s20-12 20-26C52 22 44 4 32 4z" fill="#5f9a3f" />
              <path d="M32 11C23 11 17 25 17 40c0 11 6 21 15 21s15-10 15-21C47 25 41 11 32 11z" fill="#d9e8a0" />
              <circle cx="32" cy="46" r="10" fill="#8a5a3c" />
              <circle cx="29" cy="43" r="3" fill="#b07a55" />
              <circle cx="26" cy="30" r="2.4" fill="#4a3328" />
              <circle cx="38" cy="30" r="2.4" fill="#4a3328" />
              <path d="M28 35q4 3 8 0" stroke="#4a3328" strokeWidth="2" fill="none" strokeLinecap="round" />
              <circle cx="22" cy="35" r="2.5" fill="#f4a58a" opacity=".7" />
              <circle cx="42" cy="35" r="2.5" fill="#f4a58a" opacity=".7" />
            </g>
          </svg>
        </div>
        <div className="rpgb-splash__ground" />
        <div className="rpgb-splash__flag" aria-hidden>🏁</div>
      </div>
      <div className="rpgb-splash__hint">Loading the city…</div>
    </div>
  );
}
