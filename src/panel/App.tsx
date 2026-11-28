/**
 * Panel composition root: layout shell + the global wiring that legacy
 * main.ts/global-events did imperatively (init, tab activation, selection
 * relay, system-prompt sync) + the feature controllers' liftoff.
 * F17: the bootstrap half moved to hooks/usePanelLiftoff (shared with the
 * fullscreen page); App is the side panel's layout only.
 */
import { MotionConfig } from 'motion/react';
import { Header } from './components/layout/Header';
import { QuickActions } from './components/layout/QuickActions';
import { Toasts } from './components/layout/Toasts';
import { TtsIndicator } from './components/layout/TtsIndicator';
import { MessageList } from './components/chat/MessageList';
import { Composer } from './components/composer/Composer';
import { Sheets } from './components/panels/Sheets';
import { ShareModal } from './components/panels/ShareModal';
import { QuizCard } from './components/panels/QuizCard';
import { PodcastCard } from './components/panels/PodcastCard';
import { PodcastMiniPlayer } from './components/panels/PodcastMiniPlayer';
import { usePanelLiftoff } from './hooks/usePanelLiftoff';

export default function App() {
  // Side-panel semantics: follow the window's active tab (the fullscreen
  // chat tab is skipped inside) and consume the F8 context-menu queue.
  usePanelLiftoff({ followTabActivation: true, panelActions: true });

  return (
    <MotionConfig reducedMotion="user">
      <div className="panel-root">
        <Header />
        <QuickActions />
        <TtsIndicator />
        <MessageList />
        <QuizCard />
        <PodcastCard />
        <Composer />
        <PodcastMiniPlayer />
        <Sheets />
        <ShareModal />
        <Toasts />
      </div>
    </MotionConfig>
  );
}
