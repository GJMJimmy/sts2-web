// Shared run start for the browser tools: Singleplayer → Standard → (character n) → Confirm, answer the first-embark
// tutorials prompt, then take Neow's first offer (and what it asks for) until the map opens.
export async function toCharSelect(page) {
  // a fresh profile's first menu opens NEarlyAccessDisclaimer in the modal container
  if (await page.waitForSelector('.ea-proceed', { timeout: 1500 }).catch(() => null)) {
    await page.click('.ea-proceed');
    await page.waitForSelector('.ea-panel', { state: 'detached' });
  }
  await page.click('.mm-single_player');
  // the first run goes straight to character select; later ones through the singleplayer submenu's Standard
  await page.waitForSelector('.charselect, .sp-submenu');
  if (await page.$('.sp-submenu')) await page.click('.submenu-btn >> nth=0');
  await page.waitForSelector('.charselect .confirm-btn.shown');
}
export async function embark(page, char) {
  if (char) { await page.click(`.chs-buttons > :nth-child(${char})`); await page.waitForTimeout(200); }
  await page.click('.charselect .confirm-btn.shown');
}
export async function startRun(page, { char } = {}) {
  await toCharSelect(page);
  await embark(page, char);
  await page.click('.vp-btn.yes', { timeout: 2000 }).catch(() => {}); // NAcceptTutorialsFtue
  await page.waitForFunction(() => window.ui?.screen === 'run' && window.ui.room, null, { timeout: 60000 });
  for (let i = 0; i < 40 && !(await page.evaluate(() => window.ui.mapOpen)); i++) {
    // buttons take clicks; the overlay screens (card grids, choices, rewards) take the mouse like NButtons
    const at = await page.evaluate(() => {
      const q = (s) => document.querySelector(s);
      const click = q('.ftue-confirm') ?? q('.cr-arrow.right');
      const top = window.ui.overlays[window.ui.overlays.length - 1];
      const pick = !top ? null : top.preview ? q('.grid-preview .confirm-btn.shown')
        : q('.grid-screen') ? (top.selected.length < Math.max(1, top.min) ? q('.card-grid .gh-card') : q('.grid-screen > .confirm-btn.shown'))
        : q('.choose-card-screen .gh-card') ?? q('.card-reward-screen .gh-card') ?? q('.reward-btn') ?? q('.proceed-btn.shown');
      const room = window.ui.room;
      const opt = !click && !pick && room?.kind === 'event' && !room.disabled
        ? (q('.anc-hitbox') ?? document.querySelectorAll('.event-option')[room.options.findIndex((o) => !o.IsLocked)]) : null;
      if (click) { const r = click.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
      if (opt) { const r = opt.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
      if (pick) { const r = pick.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }
      q('.proceed:not([disabled])')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      return null;
    });
    if (at) { await page.mouse.move(at[0], at[1]); await page.waitForTimeout(60); await page.mouse.down(); await page.mouse.up(); await page.mouse.move(5, 5); }
    await page.waitForTimeout(400);
  }
  await page.waitForFunction(() => window.ui?.mapOpen, null, { timeout: 60000 });
}

/** Click the first travelable map node with the mouse (NMapPoint takes pointer enter / down / up), once it is on screen. */
export async function travel(page) {
  const at = await page.waitForFunction(() => {
    const el = document.querySelector('.map-screen .mp.travelable');
    const st = document.querySelector('.stage-root')?.getBoundingClientRect();
    if (!el || !st) return null;
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    return y > st.top + 80 && y < st.bottom - 40 ? [x, y] : null;
  }, null, { timeout: 30000 }).then((h) => h.jsonValue());
  await page.mouse.move(at[0], at[1]);
  await page.waitForTimeout(100);
  await page.mouse.down();
  await page.mouse.up();
}
