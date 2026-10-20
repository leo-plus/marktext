import { expect, test } from '@playwright/test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { launchWithMarkdown, expectNoRendererErrors, enterSourceMode } from './helpers'

const sample = process.env.MARKTEXT_DIAGRAM_TEST_FILE
  ? readFileSync(process.env.MARKTEXT_DIAGRAM_TEST_FILE, 'utf8')
  : '```mermaid\nsequenceDiagram\n    Alice->>Bob: Hello\n```\n'

test('edit a sequence diagram beside a live, zoomable preview', async() => {
  const { app, page } = await launchWithMarkdown(sample, { suppressErrorDialog: true })
  try {
    const block = page.locator('.editor-component figure.mu-diagram-block').first()
    await block.locator('.mu-diagram-preview svg').waitFor({ state: 'attached' })
    const preview = page.locator('.diagram-side-preview')
    if (!(await preview.isVisible())) await block.locator('.mu-diagram-preview').click()
    await expect(preview).toBeVisible()
    await expect(preview.locator('header')).toContainText('Diagram preview')
    await expect(preview.locator('svg[id]')).not.toHaveCount(0)
    await expect(block.locator('.mu-diagram-preview')).toBeHidden()
    const code = block.locator('.mu-code')
    await expect(code).toBeVisible()
    const codeBox = await code.boundingBox()
    const panelBox = await preview.boundingBox()
    if (!codeBox || !panelBox) throw new Error('Editor and preview must have visible bounds')
    expect(codeBox.x + codeBox.width).toBeLessThanOrEqual(panelBox.x + 2)

    const zoom = preview.locator('.zoom-level')
    await preview.getByRole('button', { name: 'Actual size', exact: true }).click()
    await expect(zoom).toHaveText('100%')
    await preview.getByRole('button', { name: 'Zoom in', exact: true }).click()
    await expect(zoom).toHaveText('125%')

    await code.click()
    await code.locator('.mu-codeblock-content').evaluate((element) => {
      const range = document.createRange()
      range.selectNodeContents(element)
      range.collapse(false)
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
    })
    await page.keyboard.press('ArrowLeft')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await page.keyboard.type('    Alice->>Bob: LIVE_PREVIEW_UPDATED')
    await expect(preview.locator('.mu-diagram-preview svg')).toContainText('LIVE_PREVIEW_UPDATED', {
      timeout: 20000
    })
    await expect(zoom).toHaveText('125%')

    const stage = preview.locator('.diagram-preview-stage')
    await stage.hover()
    await page.mouse.wheel(0, -100)
    await expect(zoom).not.toHaveText('125%')
    const figure = stage.locator('figure')
    const before = await figure.getAttribute('style')
    const box = await stage.boundingBox()
    if (!box || !before) throw new Error('Preview must be measurable before dragging')
    await page.mouse.move(box.x + 80, box.y + 80)
    await page.mouse.down()
    await page.mouse.move(box.x + 140, box.y + 120)
    await page.mouse.up()
    await expect(figure).not.toHaveAttribute('style', before)

    await preview.getByRole('button', { name: 'Fit to window', exact: true }).click()
    const fitted = await figure.boundingBox()
    if (!fitted) throw new Error('Fitted preview must be visible')
    expect(fitted.width).toBeLessThanOrEqual(box.width + 2)
    expect(fitted.height).toBeLessThanOrEqual(box.height + 2)
    if (process.env.MARKTEXT_DIAGRAM_SCREENSHOT) {
      await page.screenshot({ path: process.env.MARKTEXT_DIAGRAM_SCREENSHOT })
    }
    await enterSourceMode(page, app)
    await expect(preview).toBeHidden()
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('follows the selected diagram and closes outside diagrams without stale content', async() => {
  const doc =
    'Outside\n\n```mermaid\nflowchart LR\nA-->B\n```\n\n```mermaid\nflowchart LR\nC-->D\n```\n'
  const { app, page } = await launchWithMarkdown(doc, { suppressErrorDialog: true })
  try {
    const blocks = page.locator('.editor-component figure.mu-diagram-block')
    const preview = page.locator('.diagram-side-preview')
    await blocks.nth(0).locator('.mu-diagram-preview svg').waitFor({ state: 'attached' })
    await blocks.nth(0).locator('.mu-diagram-preview').click()
    await expect(preview.locator('.mu-diagram-preview')).toContainText('A')
    await blocks.nth(1).locator('.mu-diagram-preview').click()
    await expect(preview.locator('.mu-diagram-preview')).toContainText('C')
    await expect(preview.locator('.mu-diagram-preview')).not.toContainText('A')
    await page.locator('.editor-component .mu-paragraph-content').first().click()
    await expect(preview).toBeHidden()
    await expect(blocks.nth(1).locator('.mu-diagram-preview')).toBeVisible()
    await blocks.nth(1).locator('.mu-diagram-preview').click()
    await expect(preview).toBeVisible()
    await preview.getByRole('button', { name: 'Close', exact: true }).click()
    await expect(preview).toBeHidden()
    for (let attempt = 0; attempt < 2; attempt++) {
      await blocks
        .nth(1)
        .locator('.mu-codeblock-content')
        .click({ position: { x: 8, y: 8 } })
      await expect(preview).toBeVisible()
      await expect(preview.locator('.mu-diagram-preview svg')).toContainText('C')
      await preview.getByRole('button', { name: 'Close', exact: true }).click()
      await expect(preview).toBeHidden()
    }
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})

test('preview mode switches live through Preferences and is saved', async() => {
  const { app, page } = await launchWithMarkdown(sample, {
    suppressErrorDialog: true,
    preferences: { language: 'en', sideBarVisibility: true, diagramPreviewMode: 'bottom' }
  })
  try {
    const block = page.locator('.editor-component figure.mu-diagram-block').first()
    const panel = page.locator('.diagram-side-preview')
    const code = block.locator('.mu-codeblock-content')
    await block.locator('.mu-diagram-preview svg').waitFor({ state: 'attached' })
    await code.click({ position: { x: 8, y: 8 } })
    await expect(block.locator('.mu-diagram-preview')).toBeVisible()
    await expect(panel).toBeHidden()

    const opened = app.waitForEvent('window')
    await page.getByRole('button', { name: 'Settings', exact: true }).click()
    const preferences = await opened
    await preferences.waitForSelector('.pref-sidebar .category')
    await preferences.evaluate(() => {
      window.location.hash = '#/preference/markdown'
    })
    await preferences.waitForSelector('.pref-markdown')
    const select = preferences.locator('.el-select').filter({
      has: preferences.getByRole('combobox', { name: 'Diagram preview mode', exact: true })
    })
    await select.click({ timeout: 5000 })
    await preferences.getByRole('option', { name: 'Side preview (default)', exact: true }).click({ timeout: 5000 })
    await expect(panel).toBeVisible()
    await expect(block.locator('.mu-diagram-preview')).toBeHidden()
    const userData = await app.evaluate(({ app }) => app.getPath('userData'))
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')).diagramPreviewMode
      )
      .toBe('sidebar')

    await select.click({ timeout: 5000 })
    await preferences.getByRole('option', { name: 'Bottom preview', exact: true }).click({ timeout: 5000 })
    await expect(panel).toBeHidden()
    await expect(block.locator('.mu-diagram-preview')).toBeVisible()
    await code.click({ position: { x: 8, y: 8 } })
    await expect(panel).toBeHidden()
    await expect
      .poll(
        () =>
          JSON.parse(readFileSync(join(userData, 'preferences.json'), 'utf8')).diagramPreviewMode
      )
      .toBe('bottom')
    await expectNoRendererErrors(app)
  } finally {
    await app.close()
  }
})
