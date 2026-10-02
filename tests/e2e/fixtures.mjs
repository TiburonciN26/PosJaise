import { test as base, expect } from 'playwright/test';
import { readFile } from 'node:fs/promises';
import { assertLocalTest, localNetworkOnly } from './local-safety.mjs';
import { issueURLs } from './fixtures/accounts.mjs';
import { issueStatus, expectedFailureIDs } from './fixtures/issue-status.mjs';

export const test = base.extend({
  data: async ({}, use) => {
    const data = JSON.parse(await readFile('tests/e2e/fixtures/runtime.json', 'utf8'));
    if (!data.setupComplete) throw new Error('Isolated fixture setup incomplete.');
    await use(data);
  },
  // Setup/safety failures occur before test.fail(), so they stay unexpected.
  page: async ({ page, context }, use, info) => {
    await assertLocalTest();
    await localNetworkOnly(context);
    const consoleErrors = [];
    const httpErrors = [];
    page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
    page.on('pageerror', error => consoleErrors.push(error.message));
    page.on('response', response => {
      if (response.status() >= 400) {
        const url = new URL(response.url());
        httpErrors.push({ method: response.request().method(), path: url.pathname, status: response.status() });
      }
    });
    await use(page);
    if (!page.isClosed()) await info.attach('ui-final', { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' }).catch(() => {});
    await info.attach('diagnostics', { body: Buffer.from(JSON.stringify({ consoleErrors, httpErrors }, null, 2)), contentType: 'application/json' });
  },
});
export { expect };

export function knownIssue(info, id) {
  info.annotations.push({ type: 'issue', description: `${id}: ${issueURLs[id]} (Notion: ${issueStatus[id] ?? 'Pendiente'}; requiere prueba)` });
}

export function expectKnownFailure(id) {
  // Call only after preconditions/actions succeed. A setup/locator error must
  // remain unexpected, rather than masquerading as a reproduced application bug.
  // Verificado is the owner's manual confirmation of a defect, NOT a fix.
  // An explicit correction/re-test is needed before removing this marker.
  test.fail(expectedFailureIDs.has(id), `${id}: incidencia conocida sin corrección confirmada; se verifica el comportamiento correcto.`);
}
