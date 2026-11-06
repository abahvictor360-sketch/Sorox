import { useCallback, useEffect, useRef, useState } from 'react';
import { loadSettings, saveSettings, isReady, type ModeId, type Settings } from './lib/settings';
import { loadProfile, saveProfile, hasProfile, type Profile } from './lib/profile';
import { LiveScreen, type LiveHandle } from './screens/LiveScreen';
import { NotesScreen } from './screens/NotesScreen';
import { PracticeScreen } from './screens/PracticeScreen';
import { PrepScreen } from './screens/PrepScreen';
import { MeScreen, type MeTab } from './screens/MeScreen';
import { onAppointmentOpened, takeDueAppointment } from './lib/schedule';
import { Icon } from './components/Icon';
import { checkForUpdate, dismissUpdate, type UpdateInfo } from './lib/updates';
import { ChevronRight, Download, X } from 'lucide-react';
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
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  // Tell the user when a newer version is out: on open and when coming back to the app.
  useEffect(() => {
    const platform = Capacitor.getPlatform() === 'ios' ? 'ios' : Capacitor.getPlatform() === 'android' ? 'android' : 'web';
    const run = () => { void checkForUpdate(platform).then((u) => { if (u) setUpdate(u); }); };
    run();
    const onVis = () => { if (document.visibilityState === 'visible') run(); };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const setSettings = useCallback((s: Settings) => { setSettingsState(s); saveSettings(s); }, []);
  const setProfile = useCallback((p: Profile) => { setProfileState(p); saveProfile(p); }, []);
  const startLive = useCallback((mode?: ModeId, standby = false) => { setTab('live'); window.setTimeout(() => live.current?.startListening(mode, { standby }), 50); }, []);

  // Turn itself on: when the app opens (setting), when an interview on the
  // schedule is happening now, or when its "starting" notification is tapped.
  useEffect(() => {
    // A scheduled interview that has started (and was not started before).
    const due = takeDueAppointment();
    if (due) startLive(due.mode);
    else if (loadSettings().autoListen) startLive(undefined, loadSettings().standby);
    // While the app is open, start on time without needing the notification.
    const timer = window.setInterval(() => { const d = takeDueAppointment(); if (d) startLive(d.mode); }, 15_000);
    let off: (() => void) | undefined;
    void onAppointmentOpened((mode, auto) => { if (auto) startLive(mode); else setTab('prep'); }).then((f) => { off = f; });
    // Coming back to the app during a scheduled interview starts listening too.
    let offResume: (() => void) | undefined;
    if (Capacitor.isNativePlatform()) {
      void import('@capacitor/app').then(({ App: CapApp }) => CapApp.addListener('resume', () => {
        const d = takeDueAppointment();
        if (d) startLive(d.mode);
      })).then((h) => { offResume = () => void h.remove(); }).catch(() => {});
    }
    return () => { window.clearInterval(timer); off?.(); offResume?.(); };
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
        {update && (
          <div className="update-banner glass" role="status">
            <Download size={18} aria-hidden />
            <span className="grow"><b>Update available</b> ({update.version}). Install it to get the latest fixes.</span>
            <a className="primary small update-get" href={update.url} target="_blank" rel="noreferrer">Download</a>
            <button className="ghost small" aria-label="Later" onClick={() => { dismissUpdate(update.version); setUpdate(null); }}><X size={16} aria-hidden /></button>
          </div>
        )}
        {needsKey && tab !== 'me' && (
          <button className="banner" onClick={() => { setTab('me'); setMeTab('settings'); }}>Add your AI key to get answers <ChevronRight size={16} aria-hidden /></button>
        )}
        {!needsKey && !hasProfile(profile) && (tab === 'live' || tab === 'prep' || tab === 'practice') && (
          <button className="banner soft" onClick={() => { setTab('me'); setMeTab('profile'); }}>Add your CV and the job for answers in your own words <ChevronRight size={16} aria-hidden /></button>
        )}
        <main className={`content ${tab === 'live' ? 'is-live' : ''}`}>
          {/* Live stays mounted so listening continues while you look at notes or prep. */}
          <div className="live-wrap" hidden={tab !== 'live'}>
            <LiveScreen ref={live} settings={settings} profile={profile} active={tab === 'live'} onSettings={setSettings} onSessionSaved={() => setNotesVersion((v) => v + 1)} />
          </div>
          {tab === 'notes' && <NotesScreen settings={settings} profile={profile} version={notesVersion} />}
          {tab === 'practice' && <PracticeScreen settings={settings} profile={profile} onSaved={() => setNotesVersion((v) => v + 1)} />}
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
