import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings, isReady, type ModeId, type Settings } from './lib/settings';
import { loadProfile, saveProfile, hasProfile, type Profile } from './lib/profile';
import { LiveScreen, type LiveHandle } from './screens/LiveScreen';
import { NotesScreen } from './screens/NotesScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { PrepScreen } from './screens/PrepScreen';
import { MeScreen, type MeTab } from './screens/MeScreen';
import { current, loadSchedule, onAppointmentOpened } from './lib/schedule';
import { Icon } from './components/Icon';
import { Capacitor } from '@capacitor/core';

type Tab = 'live' | 'notes' | 'practice' | 'prep' | 'me';
const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'live', label: 'Live', icon: 'live' },
  { id: 'notes', label: 'Notes', icon: 'notes' },
  { id: 'practice', label: 'Practice', icon: 'practice' },
  { id: 'prep', label: 'Prep', icon: 'prep' },
  { id: 'me', label: 'Me', icon: 'me' },
];

export default function App() {
  const [settings, setSettingsState] = useState<Settings>(() => loadSettings());
  const [profile, setProfileState] = useState<Profile>(() => loadProfile());
  const [tab, setTab] = useState<Tab>(() => (isReady(loadSettings()) ? 'live' : 'me'));
  const [meTab, setMeTab] = useState<MeTab>(() => (!isReady(loadSettings()) ? 'settings' : !hasProfile(loadProfile()) ? 'profile' : 'settings'));
  const [notesVersion, setNotesVersion] = useState(0);
  const live = useRef<LiveHandle>(null);

  const setSettings = useCallback((s: Settings) => { setSettingsState(s); saveSettings(s); }, []);
  const setProfile = useCallback((p: Profile) => { setProfileState(p); saveProfile(p); }, []);
  const startLive = useCallback((mode?: ModeId) => { setTab('live'); window.setTimeout(() => live.current?.startListening(mode), 50); }, []);

  // Turn itself on: when the app opens (setting), when an interview on the
  // schedule is happening now, or when its "starting" notification is tapped.
  useEffect(() => {
    const appt = current(loadSchedule());
    if (appt) startLive(appt.mode);
    else if (loadSettings().autoListen) startLive();
    let off: (() => void) | undefined;
    void onAppointmentOpened((mode, auto) => { if (auto) startLive(mode); else setTab('prep'); }).then((f) => { off = f; });
    // Coming back to the app during a scheduled interview starts listening too.
    let offResume: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App: CapApp }) => CapApp.addListener('resume', () => {
        const now = current(loadSchedule());
        if (now) startLive(now.mode);
      })).then((h) => { offResume = () => void h.remove(); }).catch(() => {});
    }
    return () => { off?.(); offResume?.(); };
  }, [startLive]);

  const needsKey = !isReady(settings);
  return (
    <div className="app">
      <div className="bg" aria-hidden />
      <nav className="rail glass">
        <img src="./icon.png" alt="Soro X" className="logo" />
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id}>
            <span className="ti"><Icon name={t.icon} /></span><span>{t.label}</span>
          </button>
        ))}
      </nav>
      <div className="main">
        <header className="top">
          <img src="./icon.png" alt="" className="logo" />
          <span className="brand">Soro X</span>
          <span className="sub">{TABS.find((t) => t.id === tab)?.label}</span>
        </header>
        {needsKey && tab !== 'me' && (
          <button className="banner" onClick={() => { setTab('me'); setMeTab('settings'); }}>Add your AI key to get answers →</button>
        )}
        {!needsKey && !hasProfile(profile) && (tab === 'live' || tab === 'prep' || tab === 'practice') && (
          <button className="banner soft" onClick={() => { setTab('me'); setMeTab('profile'); }}>Add your CV and the job for answers in your own words →</button>
        )}
        <main className={`content ${tab === 'live' ? 'is-live' : ''}`}>
          {/* Live stays mounted so listening continues while you look at notes or prep. */}
          <div className="live-wrap" hidden={tab !== 'live'}>
            <LiveScreen ref={live} settings={settings} profile={profile} active={tab === 'live'} onSettings={setSettings} onSessionSaved={() => setNotesVersion((v) => v + 1)} />
          </div>
          {tab === 'notes' && <NotesScreen settings={settings} profile={profile} version={notesVersion} />}
          {tab === 'practice' && <PracticeScreen settings={settings} profile={profile} />}
          {tab === 'prep' && <PrepScreen settings={settings} profile={profile} />}
          {tab === 'me' && <MeScreen settings={settings} profile={profile} onSettings={setSettings} onProfile={setProfile} onStartNow={startLive} tab={meTab} onTab={setMeTab} />}
        </main>
        <nav className="tabs glass">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)} aria-current={tab === t.id}>
              <span className="ti"><Icon name={t.icon} /></span><span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
