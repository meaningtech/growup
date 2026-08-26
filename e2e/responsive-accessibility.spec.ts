import { expect, test } from '@playwright/test';
import { DESIGN_SPECIES_BY_ID } from '../src/data/designSpecies';
import { TEMPERATE_OPEN_FIELD_FIXTURE } from '../test/fixtures/sites';
import { importSiteFixture } from './support/siteFixture';
import { mockPlanningApi } from './support/mockPlanningApi';

async function readTabRow(locator: { evaluate: (fn: (element: Element) => unknown) => Promise<unknown> }) {
  return locator.evaluate((element) => {
    const style = getComputedStyle(element);
    const buttons = [...element.querySelectorAll('[role="tab"]')].map((button) => Math.round(button.getBoundingClientRect().y));
    return {
      display: style.display,
      wrap: style.flexWrap,
      overflowX: style.overflowX,
      position: style.position,
      uniqueRows: new Set(buttons).size,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
    };
  }) as Promise<{
    display: string;
    wrap: string;
    overflowX: string;
    position: string;
    uniqueRows: number;
    scrollWidth: number;
    clientWidth: number;
  }>;
}

test('places the mobile flow guide directly below the map without covering the panel title', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('growup:onboarding:v1', JSON.stringify({
      status: 'skipped',
      step: 'welcome',
      updatedAt: new Date().toISOString(),
    }));
  });
  await page.goto('/');

  const [mapBox, headerBox, bodyBox, titleBox] = await Promise.all([
    page.locator('.map-stage').boundingBox(),
    page.locator('.inspector-header').boundingBox(),
    page.locator('.panel-body').boundingBox(),
    page.locator('.panel-intro h1').boundingBox(),
  ]);
  expect(mapBox).not.toBeNull();
  expect(headerBox).not.toBeNull();
  expect(bodyBox).not.toBeNull();
  expect(titleBox).not.toBeNull();

  const mapBottom = mapBox!.y + mapBox!.height;
  const headerBottom = headerBox!.y + headerBox!.height;
  expect(Math.abs(headerBox!.y - mapBottom)).toBeLessThanOrEqual(1);
  expect(bodyBox!.y).toBeGreaterThanOrEqual(headerBottom - 1);
  expect(titleBox!.y).toBeGreaterThanOrEqual(headerBottom + 20);

  await page.screenshot({ path: testInfo.outputPath('growup-mobile-flow-layout.png'), fullPage: false });
});

test('keeps the Google sign-in dialog inside narrow mobile viewports', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('growup.locale', 'it');
    (window as any).google = {
      accounts: {
        id: {
          initialize: () => undefined,
          renderButton: (element: HTMLElement, options: { width: number }) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = 'Continua con Google';
            button.style.width = `${options.width}px`;
            button.style.minHeight = '44px';
            element.append(button);
          },
        },
      },
    };
  });
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    googleMapsApiKey: '',
    initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
    climatePeriod: '2021-01-01 to 2025-12-31',
    modelVersion: 'responsive-test',
    assistant: { configured: false, interface: 'openai-compatible' },
    auth: { configured: true, googleClientId: 'responsive-test.apps.googleusercontent.com' },
    sharing: { configured: false },
  } }));
  await page.route('**/api/catalog/stats', (route) => route.fulfill({ json: {
    total: 0,
    treeLike: 0,
    globUnt: 0,
    designReady: 0,
  } }));
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
    authenticated: false,
    configured: true,
    user: null,
  } }));
  await page.goto('/');
  const topbarAccount = page.getByTestId('topbar-account');
  await expect(topbarAccount).toHaveAttribute('aria-label', 'Accedi');
  await topbarAccount.click();

  const dialog = page.getByRole('dialog', { name: 'Tutti i progetti dei terreni, insieme.' });
  const googleButton = dialog.getByRole('button', { name: 'Continua con Google' });
  await expect(googleButton).toBeVisible();

  for (const viewport of [{ width: 390, height: 844 }, { width: 320, height: 720 }]) {
    await page.setViewportSize(viewport);
    await expect.poll(async () => {
      const [panelBox, closeBox, googleBox] = await Promise.all([
        dialog.boundingBox(),
        dialog.getByRole('button', { name: 'Chiudi accesso' }).boundingBox(),
        googleButton.boundingBox(),
      ]);
      if (!panelBox || !closeBox || !googleBox) return false;
      const panelRight = panelBox.x + panelBox.width;
      return panelBox.x >= 0
        && panelRight <= viewport.width
        && closeBox.x + closeBox.width <= panelRight
        && googleBox.x >= panelBox.x
        && googleBox.x + googleBox.width <= panelRight;
    }).toBe(true);
    const overflow = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      content: document.documentElement.scrollWidth,
    }));
    expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-google-login.png'), fullPage: false });
});

test('keeps the signed-in identity visible outside the menu on narrow screens', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.route('**/api/config', (route) => route.fulfill({ json: {
    googleMapsApiKey: '',
    initialMapViewport: { center: { lat: 0, lng: 0 }, zoom: 2 },
    climatePeriod: '2021-01-01 to 2025-12-31',
    modelVersion: 'responsive-test',
    assistant: { configured: false, interface: 'openai-compatible' },
    auth: { configured: true, googleClientId: 'responsive-test.apps.googleusercontent.com' },
    sharing: { configured: true },
  } }));
  await page.route('**/api/catalog/stats', (route) => route.fulfill({ json: {
    total: 51,
    treeLike: 51,
    globUnt: 0,
    designReady: 51,
  } }));
  await page.route('**/api/auth/session', (route) => route.fulfill({ json: {
    authenticated: true,
    configured: true,
    user: {
      id: 'responsive-user',
      email: 'sebastiano@example.test',
      name: 'Sebastiano',
      pictureUrl: `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#c7e36f"/><text x="16" y="21" text-anchor="middle" fill="#10281e" font-size="15">S</text></svg>')}`,
      locale: 'it',
      preferences: {},
    },
  } }));
  await page.route('**/api/projects', (route) => route.fulfill({ json: [] }));
  await page.goto('/');

  const account = page.getByTestId('topbar-account');
  await expect(account).toHaveAttribute('aria-label', 'Signed in as Sebastiano');
  const avatar = account.locator('img');
  await expect(avatar).toBeVisible();
  const accountGeometry = await account.evaluate((button) => {
    const image = button.querySelector('img');
    if (!image) return null;
    const buttonBox = button.getBoundingClientRect();
    const imageBox = image.getBoundingClientRect();
    return {
      buttonRadius: getComputedStyle(button).borderRadius,
      imageRadius: getComputedStyle(image).borderRadius,
      widthDelta: Math.abs(buttonBox.width - imageBox.width),
      heightDelta: Math.abs(buttonBox.height - imageBox.height),
    };
  });
  expect(accountGeometry).not.toBeNull();
  expect(accountGeometry!.buttonRadius).toBe('50%');
  expect(accountGeometry!.imageRadius).toBe('50%');
  expect(accountGeometry!.widthDelta).toBeLessThanOrEqual(1);
  expect(accountGeometry!.heightDelta).toBeLessThanOrEqual(1);
  const box = await account.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(320);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-account-status.png'), fullPage: false });

  await account.click();
  const menu = page.getByRole('dialog', { name: 'Menu' });
  await expect(menu).toContainText('Sebastiano');
  const signOut = page.getByTestId('menu-sign-out');
  await expect(signOut).toBeVisible();
  await expect(signOut).toContainText('Sign out');
  await expect(signOut.locator('img')).toHaveCount(0);
  await menu.screenshot({ path: testInfo.outputPath('growup-mobile-account-menu.png') });
  const overflow = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
  }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
});

test('keeps supporting text readable without oversized form controls', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('step-species').click();
  await page.getByTestId('species-tab-palette').click();

  const readTypeScale = () => page.locator('.catalogue-advanced-filters').evaluate((panel) => {
    const label = panel.querySelector('label');
    const description = panel.querySelector('p');
    const select = panel.querySelector('select');
    if (!label || !description || !select) return null;
    const selectStyle = getComputedStyle(select);
    return {
      labelPx: Number.parseFloat(getComputedStyle(label).fontSize),
      descriptionPx: Number.parseFloat(getComputedStyle(description).fontSize),
      selectPx: Number.parseFloat(selectStyle.fontSize),
      selectWeight: Number.parseInt(selectStyle.fontWeight, 10),
      selectHeight: select.getBoundingClientRect().height,
    };
  });

  const mobile = await readTypeScale();
  expect(mobile).not.toBeNull();
  expect(mobile!.labelPx).toBeGreaterThanOrEqual(10);
  expect(mobile!.descriptionPx).toBeGreaterThanOrEqual(11);
  expect(mobile!.selectPx).toBe(16);
  expect(mobile!.selectWeight).toBeLessThanOrEqual(500);
  expect(mobile!.selectHeight).toBeLessThanOrEqual(42);

  await page.setViewportSize({ width: 1280, height: 887 });
  const desktop = await readTypeScale();
  expect(desktop).not.toBeNull();
  expect(desktop!.labelPx).toBeGreaterThanOrEqual(10);
  expect(desktop!.descriptionPx).toBeGreaterThanOrEqual(11);
  expect(desktop!.selectPx).toBeGreaterThanOrEqual(12);
  expect(desktop!.selectPx).toBeLessThanOrEqual(13);
  await page.locator('.catalogue-advanced-filters').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('growup-desktop-readable-type.png'), fullPage: false });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('.catalogue-advanced-filters').scrollIntoViewIfNeeded();
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-readable-type.png'), fullPage: false });
});

test('keeps planning subtabs and the primary action available above mobile navigation', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByTestId('step-species').click();

  const planningTabs = page.getByTestId('planning-tabs');
  const speciesSubtabs = page.getByTestId('species-subtabs');
  const title = page.locator('.panel-intro h1');
  const action = page.locator('.generate-design-action');
  const navigation = page.locator('.step-rail');
  await expect(planningTabs).toBeVisible();
  await expect(page.getByTestId('step-species')).toContainText('Planning');
  await expect(page.getByRole('tab', { name: 'Species' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByTestId('design-config')).toBeVisible();
  await expect(page.getByTestId('recommendation-basis')).toContainText(`curated ${DESIGN_SPECIES_BY_ID.size}-species design catalogue`);
  await planningTabs.scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();

  const [titleBox, tabsBox, subtabsBox] = await Promise.all([title.boundingBox(), planningTabs.boundingBox(), speciesSubtabs.boundingBox()]);
  expect(titleBox).not.toBeNull();
  expect(tabsBox).not.toBeNull();
  expect(subtabsBox).not.toBeNull();
  expect(tabsBox!.y).toBeGreaterThan(titleBox!.y + titleBox!.height - 1);
  expect(subtabsBox!.y).toBeGreaterThan(tabsBox!.y + tabsBox!.height - 1);

  const tabRow = await readTabRow(planningTabs);
  expect(tabRow.display).toBe('flex');
  expect(tabRow.wrap).toBe('nowrap');
  expect(['auto', 'scroll', 'overlay']).toContain(tabRow.overflowX);
  expect(tabRow.position).not.toBe('sticky');
  expect(tabRow.uniqueRows).toBe(1);

  await page.screenshot({ path: testInfo.outputPath('growup-mobile-planning-tabs-top.png'), fullPage: false });

  await page.getByRole('tab', { name: 'Firebreak' }).click();
  await expect(page.getByTestId('firebreak-config')).toBeVisible();
  await expect(page.getByTestId('design-config')).toBeHidden();

  await page.getByRole('tab', { name: 'Work equipment' }).click();
  await expect(page.getByTestId('machinery-config')).toBeVisible();
  await expect(page.getByTestId('firebreak-config')).toBeHidden();

  await page.getByRole('tab', { name: 'Species' }).click();
  await page.getByTestId('species-tab-palette').click();
  await page.locator('.catalogue-advanced-filters').scrollIntoViewIfNeeded();
  await expect(action).toBeVisible();

  const [actionBox, navigationBox] = await Promise.all([action.boundingBox(), navigation.boundingBox()]);
  expect(actionBox).not.toBeNull();
  expect(navigationBox).not.toBeNull();
  expect(actionBox!.y + actionBox!.height).toBeLessThanOrEqual(navigationBox!.y - 6);
  expect(actionBox!.x).toBeGreaterThanOrEqual(12);
  expect(actionBox!.x + actionBox!.width).toBeLessThanOrEqual(378);
  const labelsFitNavigationButtons = await navigation.locator('button > span:last-child').evaluateAll((labels) => labels.every((label) => {
    const labelBox = label.getBoundingClientRect();
    const buttonBox = label.parentElement?.getBoundingClientRect();
    return Boolean(buttonBox && labelBox.left >= buttonBox.left && labelBox.right <= buttonBox.right);
  }));
  expect(labelsFitNavigationButtons).toBe(true);

  await page.screenshot({ path: testInfo.outputPath('growup-mobile-planning-tabs.png'), fullPage: false });
});

test('keeps Italian inspector tabs on one scrollable row below the title on a phone', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    localStorage.setItem('growup.locale', 'it');
  });
  await mockPlanningApi(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await page.goto('/');
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  await expect(page.getByRole('button', { name: 'Analizza questo terreno' })).toBeEnabled();
  await page.getByRole('button', { name: 'Analizza questo terreno' }).click();

  const evidenceTabs = page.getByTestId('evidence-tabs');
  const evidenceTitle = page.locator('.panel-intro h1');
  await expect(evidenceTabs.getByRole('tab')).toHaveCount(6);
  const [evidenceTitleBox, evidenceTabsBox] = await Promise.all([evidenceTitle.boundingBox(), evidenceTabs.boundingBox()]);
  expect(evidenceTitleBox).not.toBeNull();
  expect(evidenceTabsBox).not.toBeNull();
  expect(evidenceTabsBox!.y).toBeGreaterThan(evidenceTitleBox!.y + evidenceTitleBox!.height - 1);
  const evidenceRow = await readTabRow(evidenceTabs);
  expect(evidenceRow.wrap).toBe('nowrap');
  expect(evidenceRow.position).not.toBe('sticky');
  expect(evidenceRow.uniqueRows).toBe(1);
  expect(evidenceRow.scrollWidth).toBeGreaterThan(evidenceRow.clientWidth);
  await evidenceTabs.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(evidenceTabs.getByRole('tab').last()).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-evidence-tabs-it.png'), fullPage: false });

  await page.getByTestId('step-species').click();
  const planningTabs = page.getByTestId('planning-tabs');
  const planningTitle = page.locator('.panel-intro h1');
  await expect(planningTabs.getByRole('tab', { name: 'Mezzi di lavoro' })).toBeVisible();
  const [planningTitleBox, planningTabsBox] = await Promise.all([planningTitle.boundingBox(), planningTabs.boundingBox()]);
  expect(planningTitleBox).not.toBeNull();
  expect(planningTabsBox).not.toBeNull();
  expect(planningTabsBox!.y).toBeGreaterThan(planningTitleBox!.y + planningTitleBox!.height - 1);
  const planningRow = await readTabRow(planningTabs);
  expect(planningRow.wrap).toBe('nowrap');
  expect(planningRow.position).not.toBe('sticky');
  expect(planningRow.uniqueRows).toBe(1);
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-planning-tabs-it.png'), fullPage: false });

  await page.getByRole('button', { name: /Genera tre progetti valutati/ }).click();
  const layoutTabs = page.getByTestId('layout-tabs');
  const layoutTitle = page.locator('.panel-intro h1');
  await expect(layoutTabs.getByRole('tab')).toHaveCount(5);
  await expect(layoutTabs.getByRole('tab', { name: 'Sezione' })).toBeVisible();
  const [layoutTitleBox, layoutTabsBox] = await Promise.all([layoutTitle.boundingBox(), layoutTabs.boundingBox()]);
  expect(layoutTitleBox).not.toBeNull();
  expect(layoutTabsBox).not.toBeNull();
  expect(layoutTabsBox!.y).toBeGreaterThan(layoutTitleBox!.y + layoutTitleBox!.height - 1);
  const layoutRow = await readTabRow(layoutTabs);
  expect(layoutRow.wrap).toBe('nowrap');
  expect(layoutRow.position).not.toBe('sticky');
  expect(layoutRow.uniqueRows).toBe(1);
  expect(layoutRow.scrollWidth).toBeGreaterThan(layoutRow.clientWidth);
  await layoutTabs.evaluate((element) => { element.scrollLeft = element.scrollWidth; });
  await expect(layoutTabs.getByRole('tab', { name: 'Modifica' })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('growup-mobile-layout-tabs-it.png'), fullPage: false });
});

test('keeps the complete map-layer control keyboard-accessible on a mobile viewport', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const menuTrigger = page.getByRole('button', { name: 'Open menu' });
  const assistantTrigger = page.getByRole('button', { name: 'Ask' });
  await expect(menuTrigger).toBeVisible();
  await expect(assistantTrigger).toBeVisible();
  expect((await assistantTrigger.textContent())?.trim()).toBe('');
  const [menuTriggerBox, assistantTriggerBox] = await Promise.all([menuTrigger.boundingBox(), assistantTrigger.boundingBox()]);
  expect(menuTriggerBox).not.toBeNull();
  expect(assistantTriggerBox).not.toBeNull();
  expect(menuTriggerBox!.y).toBe(assistantTriggerBox!.y);
  expect(menuTriggerBox!.height).toBe(assistantTriggerBox!.height);
  expect(assistantTriggerBox!.width).toBe(assistantTriggerBox!.height);
  expect(assistantTriggerBox!.width).toBe(menuTriggerBox!.width);
  expect(menuTriggerBox!.x).toBeGreaterThan(assistantTriggerBox!.x);
  expect(390 - (menuTriggerBox!.x + menuTriggerBox!.width)).toBeLessThanOrEqual(12);
  await menuTrigger.click();
  const mobileMenu = page.getByRole('dialog', { name: 'Menu' });
  await expect(mobileMenu).toBeVisible();
  await expect(mobileMenu.getByRole('group', { name: 'Language' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'English' })).toHaveAttribute('aria-pressed', 'true');
  await expect(mobileMenu.getByRole('button', { name: 'Italiano' })).toContainText('🇮🇹');
  await expect(mobileMenu.getByRole('button', { name: 'Tour' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'Info' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'Save' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'History' })).toBeVisible();
  await expect(mobileMenu.getByRole('button', { name: 'Sign in' })).toBeVisible();
  await mobileMenu.getByRole('button', { name: 'Close menu' }).click();
  await expect(mobileMenu).toBeHidden();
  await importSiteFixture(page, TEMPERATE_OPEN_FIELD_FIXTURE);
  const toolbar = page.locator('.map-toolbar');
  const mapStage = page.locator('.map-stage');
  const [toolbarBox, mapBox] = await Promise.all([toolbar.boundingBox(), mapStage.boundingBox()]);
  expect(toolbarBox).not.toBeNull();
  expect(mapBox).not.toBeNull();
  expect((mapBox!.y + mapBox!.height) - (toolbarBox!.y + toolbarBox!.height)).toBeLessThanOrEqual(14);
  const toolbarButtonTops = await toolbar.locator('button').evaluateAll((buttons) => buttons.map((button) => Math.round(button.getBoundingClientRect().top)));
  expect(new Set(toolbarButtonTops).size).toBe(1);
  await expect(page.getByLabel('Search place or address')).toHaveCSS('font-size', '16px');
  await page.getByRole('button', { name: 'Map layers' }).focus();
  await page.keyboard.press('Enter');

  const panel = page.getByTestId('map-layer-panel');
  await expect(panel).toBeVisible();
  const box = await panel.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await page.locator('.map-layer-toggle').first().evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');

  const unlabeled = await page.locator('.app-shell button, .app-shell a, .app-shell input, .app-shell select, .app-shell textarea').evaluateAll((elements) => elements
    .filter((element) => {
      const htmlElement = element as HTMLElement;
      if (!htmlElement.offsetParent || htmlElement.getAttribute('aria-hidden') === 'true') return false;
      const ariaLabel = htmlElement.getAttribute('aria-label')?.trim();
      const labelledBy = htmlElement.getAttribute('aria-labelledby')?.trim();
      const title = htmlElement.getAttribute('title')?.trim();
      const text = htmlElement.textContent?.trim();
      const labels = 'labels' in element ? Array.from((element as HTMLInputElement).labels ?? []).map((label) => label.textContent?.trim()).filter(Boolean) : [];
      return !ariaLabel && !labelledBy && !title && !text && labels.length === 0;
    })
    .map((element) => element.outerHTML.slice(0, 180)));
  expect(unlabeled).toEqual([]);

  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
  await page.screenshot({ path: testInfo.outputPath('growup-checkpoint-mobile-layers.png'), fullPage: false });
});

test('keeps map, inspector and workflow navigation usable on a tablet viewport', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto('/');
  await expect(page.locator('.map-stage')).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.step-rail')).toBeVisible();
  const overflow = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth }));
  expect(overflow.content).toBeLessThanOrEqual(overflow.viewport);
});

test('keeps the desktop product menu right-aligned and gives map tools distinct icons and explanatory tooltips', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 887 });
  await page.goto('/');

  const menuTrigger = page.getByRole('button', { name: 'Open menu' });
  const assistantTrigger = page.getByRole('button', { name: 'Ask' });
  const [menuBox, assistantBox] = await Promise.all([menuTrigger.boundingBox(), assistantTrigger.boundingBox()]);
  expect(menuBox).not.toBeNull();
  expect(assistantBox).not.toBeNull();
  expect(menuBox!.x).toBeGreaterThan(assistantBox!.x);
  expect(1280 - (menuBox!.x + menuBox!.width)).toBeLessThanOrEqual(10);

  const toolNames = ['Edit field vertices', 'Edit constraint vertices', 'Edit irrigation pipes'];
  const iconMarkup = await Promise.all(toolNames.map((name) => page.getByRole('button', { name }).locator('svg').first().innerHTML()));
  expect(new Set(iconMarkup).size).toBe(3);
  await expect(page.getByRole('button', { name: 'Draw a management path' })).toHaveCount(0);

  const constraintEditor = page.getByRole('button', { name: 'Edit constraint vertices' });
  await constraintEditor.hover();
  const tooltip = constraintEditor.getByRole('tooltip');
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText('Move exclusion, access, tree and water-source control points.');

  await menuTrigger.click();
  const productMenu = page.getByRole('dialog', { name: 'Menu' });
  const productMenuBox = await productMenu.boundingBox();
  expect(productMenuBox).not.toBeNull();
  expect(1280 - (productMenuBox!.x + productMenuBox!.width)).toBeLessThanOrEqual(10);
});

test('prevents focus zoom on a phone in landscape without disabling page zoom', async ({ page }) => {
  await page.setViewportSize({ width: 844, height: 390 });
  await page.goto('/');
  await expect(page.getByLabel('Search place or address')).toHaveCSS('font-size', '16px');
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute('content', 'width=device-width, initial-scale=1.0');
});
