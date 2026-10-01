// Run shell: top bar, current room, map overlay, stacked overlays (rewards, card choices), game over.
/* eslint-disable @typescript-eslint/no-explicit-any */
import { G, $, N, list } from '../game';
import { ui, invalidate } from '../store';
import { imageUrl, anyImage } from '../assets';
import { CombatScreen, staticTip } from './combat';
import { Card } from './card';
import { RichText } from './richtext';
import { setTips, hoverTipsOf } from './tooltip';
import { loc, locv, t } from '../i18n';
import { Backdrop } from './backdrop';
import { restSiteBackdrop, fullScreenScene } from '../render/scene';
import { playOneShot, playLoop, stopLoop } from '../audio';
import { useEffect, useRef } from 'preact/hooks';
import { CardsView, inspectCard } from './cards-view';
import { MapScreen, isMapVisible } from './map';
import { OverlayLayer } from './overlays';
import { EventScreen } from './event';
import { RestScreen } from './rest';
import { ShopScreen, FakeMerchantScreen } from './shop';
import { TreasureScreen } from './treasure';
import { GameOver } from './gameover';
import { CrystalSphereScreen } from './crystal-sphere';
import { HurtVignette } from './hurt-vignette';
import { seenFtue, showFtue } from './ftue';
import { CapstoneBackstop, CapstoneStack } from './pause';
import { TopBar } from './topbar';
import { targetManager } from '../cardnodes';
import { CardLayer } from './cardlayer';
import { CardFxCanvas } from '../render/cardfx';

const safe = <T,>(f: () => T, d: T) => { try { return f(); } catch { return d; } };

const roomIds = new WeakMap<object, number>();
let nextRoomId = 0;
const roomKey = (r: any) => (r ? roomIds.get(r) ?? (roomIds.set(r, ++nextRoomId), nextRoomId) : 0);

export function RunScreen() {
  const rs = G.RunManager.Instance.State;
  const room = ui.room;
  return (
    <div class="run">
      {/* NTransition.RoomFadeIn: every new room fades in from black (the layer remounts per room) */}
      <div class="room-layer" key={roomKey(room)}>
        {room?.kind === 'combat' && <CombatScreen view={room} />}
        {room?.kind === 'event' && (room.custom ? <FakeMerchantScreen view={room.custom} /> : <EventScreen view={room} />)}
        {room?.kind === 'rest' && <RestScreen view={room} />}
        {room?.kind === 'shop' && <ShopScreen view={room} />}
        {room?.kind === 'treasure' && <TreasureScreen view={room} />}
        {(!room || room.kind === 'maproom') && <div class="room-empty" />}
      </div>
      {/* NOverlayStack: the screens under the shared backstop (the map's Opened / Closed hide and show them) */}
      <OverlayLayer fallback={(o) => (o.kind === 'crystalsphere' ? <CrystalSphereScreen v={o} /> : o.kind === 'gameover' ? <GameOver g={o.g} /> : null)} />
      {/* NGlobalUi order: overlays < NMapScreen < capstone (deck / pile views) < relics and top bar */}
      {rs && isMapVisible() && <MapScreen />}
      <CapstoneBackstop />
      {ui.cardsView && rs && <CardsView />}
      <CapstoneStack />
      {rs && <TopBar rs={rs} />}
      <HurtVignette />
      <GlobalCards />
      {ftueChecks(rs)}
    </div>
  );
}

/** NGlobalUi's card previews (cards obtained outside combat show, then fly to the deck) and their trails. */
function GlobalCards() {
  const gui = N('NRun').Instance?.GlobalUi;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!gui?.IsAncestorOf) return;
    const fx = new CardFxCanvas('global', (n) => gui.IsAncestorOf(n), (n) => gui.IsAncestorOf(n));
    void fx.mount(host.current!);
    return () => fx.destroy();
  }, [gui]);
  if (!gui?.IsAncestorOf) return null;
  return (
    <div class="global-cards">
      <CardLayer root={gui} />
      <div class="card-fx-host" ref={host} />
    </div>
  );
}

/** The UI-side FTUE checks (NMapScreen, NRestSiteRoom, NPotionContainer, NRewardsScreen, NTreasureRoom, NCardRewardSelectionScreen). */
function ftueChecks(rs: any): null {
  if (!rs) return null;
  const once = (id: string, key: string, when: boolean) => { if (when && !seenFtue(id)) showFtue(id, key); };
  const top = ui.overlays[ui.overlays.length - 1];
  once('obtain_potion_ftue', 'POTION_FTUE', safe(() => list(rs.Players[0].PotionSlots).some(Boolean), false));
  once('obtain_relic_ftue', 'RELIC_FTUE', top?.kind === 'rewards' && top.buttons.some((r: any) => r instanceof G.RelicReward));
  return null;
}

// ------------------------------------------------------------------ overlays
