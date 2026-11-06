import { useCallback, useState } from 'react';
import { loadSettings, saveSettings, isReady, type Settings } from './lib/settings';
import { loadProfile, saveProfile, hasProfile, type Profile } from './lib/profile';
import { LiveScreen } from './screens/LiveScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { PrepScreen } from './screens/PrepScreen';
import { ProfileScreen } from './screens/ProfileScreen';
import { SettingsScreen } from './screens/SettingsScreen';

type Tab = 'live' | 'practice' | 'prep' | 'profile' | 'settings';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'live', label: 'Live', icon: '🎙' },
  { id: 'practice', label: 'Practice', icon: '🎯' },
  { id: 'prep', label: 'Prep', icon: '📋' },
  { id: 'profile', label: 'Profile', icon: '👤' },
  { id: 'settings', label: 'Settings', icon: '⚙' },
];

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const [profile, setProfileState] = useState<Profile>(() => loadProfile());
  const [tab, setTab] = useState<Tab>(() => (!isReady(loadSettings()) ? 'settings' : !hasProfile(loadProfile()) ? 'profile' : 'live'));

  const setSettings = useCallback((s: Settings) => { setSettingsState(s); saveSettings(s); }, []);
  const setProfile = useCallback((p: Profile) => { setProfileState(p); saveProfile(p); }, []);

  const needsKey = !isReady(settings);
  return (
    <div className="app">
      <header className="top">
        <img src="./icon.png" alt="" className="logo" />
        <span className="brand">Soro X</span>
        <span className="sub">{TABS.find((t) => t.id === tab)?.label}</span>
      </header>
      {needsKey && tab !== 'settings' && (
        <button className="banner" onClick={() => setTab('settings')}>Add your AI key in Settings to start →</button>
      )}
      {!needsKey && !hasProfile(profile) && tab !== 'profile' && tab !== 'settings' && (
        <button className="banner soft" onClick={() => setTab('profile')}>Add your CV and the job for tailored answers →</button>
      )}
      <main className="content">
        {/* Live stays mounted so listening continues while you glance at Prep. */}
        <div hidden={tab !== 'live'}><LiveScreen settings={settings} profile={profile} active={tab === 'live'} /></div>
        {tab === 'practice' && <PracticeScreen settings={settings} profile={profile} />}
        {tab === 'prep' && <PrepScreen settings={settings} profile={profile} />}
        {tab === 'profile' && <ProfileScreen settings={settings} profile={profile} onChange={setProfile} />}
        {tab === 'settings' && <SettingsScreen settings={settings} onChange={setSettings} />}
      </main>
      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            <span className="ti">{t.icon}</span><span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
