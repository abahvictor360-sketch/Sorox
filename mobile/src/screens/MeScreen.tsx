// "Me": your profile, your schedule and settings, behind one tab.
import { useState } from 'react';
import type { ModeId, Settings } from '../lib/settings';
import type { Profile } from '../lib/profile';
import { ProfileScreen } from './ProfileScreen';
import { ScheduleScreen } from './ScheduleScreen';
import { SettingsScreen } from './SettingsScreen';

export type MeTab = 'profile' | 'schedule' | 'settings';

export function MeScreen(p: { settings: Settings; profile: Profile; onSettings: (s: Settings) => void; onProfile: (p: Profile) => void; onStartNow: (m: ModeId) => void; tab: MeTab; onTab: (t: MeTab) => void }) {
  return (
    <section>
      <div className="seg-ctl">
        <button className={p.tab === 'profile' ? 'on' : ''} onClick={() => p.onTab('profile')}>Profile</button>
        <button className={p.tab === 'schedule' ? 'on' : ''} onClick={() => p.onTab('schedule')}>Schedule</button>
        <button className={p.tab === 'settings' ? 'on' : ''} onClick={() => p.onTab('settings')}>Settings</button>
      </div>
      {p.tab === 'profile' && <ProfileScreen settings={p.settings} profile={p.profile} onChange={p.onProfile} />}
      {p.tab === 'schedule' && <ScheduleScreen onStartNow={p.onStartNow} />}
      {p.tab === 'settings' && <SettingsScreen settings={p.settings} onChange={p.onSettings} />}
    </section>
  );
}
