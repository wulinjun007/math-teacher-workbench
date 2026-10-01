const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:8177';
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail: detail || '' });
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''));
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- 桌面截图 ---------- */
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const desktop = [
    ['/', 'home'],
    ['/topics/monotonicity/', 'topic'],
    ['/learn/concept-intro/', 'u1'],
    ['/learn/definition-proof/', 'u2'],
    ['/learn/error-diagnosis/', 'u3'],
    ['/workspace/', 'workspace-empty'],
    ['/records/', 'records-empty'],
    ['/about/', 'about'],
    ['/privacy/', 'privacy'],
  ];
  for (const [route, name] of desktop) {
    await page.goto(BASE + route, { waitUntil: 'networkidle' });
    await page.waitForTimeout(900); // blur-reveal 完成
    await page.screenshot({ path: path.join(OUT, 'd-' + name + '.png'), fullPage: true });
  }

  /* ---------- 首页 Shell 切换 ---------- */
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  await page.click('.session[data-tpl="u2"]');
  await page.waitForTimeout(300);
  const shellTitle = await page.textContent('#shell-title');
  check('shell-switch-u2', shellTitle.trim() === '定义与证明', 'title=' + shellTitle.trim());
  await page.locator('.shell').screenshot({ path: path.join(OUT, 'd-shell-u2.png') });

  /* ---------- 练习状态机（U2 练习1） ---------- */
  await page.goto(BASE + '/learn/definition-proof/', { waitUntil: 'networkidle' });
  const p1 = page.locator('[data-qid="q1"]');
  // 空提交应被拒绝
  await p1.locator('[data-action="submit"]').click();
  await page.waitForTimeout(200);
  let badge = (await p1.locator('[data-state-badge]').textContent()).trim();
  check('practice-empty-rejected', badge === '未回答', 'badge=' + badge);
  // 选 B + 理由 → 提交
  await p1.locator('input[value="B"]').check();
  await p1.locator('textarea').fill('两个点不能代表整个区间，需要任取两点。');
  await p1.locator('[data-action="submit"]').click();
  await page.waitForTimeout(300);
  badge = (await p1.locator('[data-state-badge]').textContent()).trim();
  check('practice-answered', badge === '已回答', 'badge=' + badge);
  // 查看参考
  await p1.locator('[data-action="view-ref"]').click();
  await page.waitForTimeout(300);
  badge = (await p1.locator('[data-state-badge]').textContent()).trim();
  const refVisible = await p1.locator('.reference').isVisible();
  check('practice-viewed', badge === '已查看参考' && refVisible, 'badge=' + badge + ' ref=' + refVisible);
  // 修订
  await p1.locator('textarea').fill('两个点不能代表整个区间，需要任取两点比较函数值的符号。');
  await p1.locator('[data-action="submit"]').click();
  await page.waitForTimeout(300);
  badge = (await p1.locator('[data-state-badge]').textContent()).trim();
  check('practice-revised', badge === '已修订', 'badge=' + badge);
  // 重复点击提交不产生重复记录
  const attemptsBefore = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mtw_store_v1'));
    return s.practice['definition-proof::q1'].attempts.length;
  });
  await p1.locator('[data-action="submit"]').click();
  await page.waitForTimeout(200);
  const attemptsAfter = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mtw_store_v1'));
    return s.practice['definition-proof::q1'].attempts.length;
  });
  check('practice-no-dup', attemptsBefore === attemptsAfter, attemptsBefore + '→' + attemptsAfter);
  // 量规
  await page.locator('input[name="rub-dp-1"][value="2"]').check();
  await page.locator('input[name="rub-dp-2"][value="2"]').check();
  await page.locator('input[name="rub-dp-3"][value="1"]').check();
  await page.locator('input[name="rub-dp-4"][value="2"]').check();
  await page.waitForTimeout(300);
  const rubricTxt = (await page.locator('.rubric-score b').textContent()).trim();
  check('rubric-saved', rubricTxt.includes('7/8'), rubricTxt);
  await page.screenshot({ path: path.join(OUT, 'd-u2-practice.png'), fullPage: true });

  /* ---------- 工作台：新建 → 填写 → 自动保存 → 刷新恢复 ---------- */
  await page.goto(BASE + '/workspace/?unit=definition-proof&new=1', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const editorHidden = await page.locator('#ws-editor').getAttribute('class');
  check('ws-created', editorHidden.indexOf('is-hidden') < 0, 'class=' + editorHidden);
  await page.fill('#f-title', '单调性第一课时 · 问题链改写');
  await page.fill('#f-goal', '学生能解释为什么 f(1)、f(2) 两个例子不能完成证明，并写出任意两点的比较过程。');
  await page.locator('#chain-editor .chain-row').first().locator('[data-role="ask"]').fill('讨论 [0,2] 上的严格递增，需要比较哪两个点？');
  await page.locator('#chain-editor .chain-row').first().locator('[data-role="expect"]').fill('任取 0 ≤ x₁ < x₂ ≤ 2');
  await page.locator('#chain-editor .chain-row').first().locator('[data-role="follow"]').fill('只比较 1 和 2 行吗？');
  await page.click('#chain-add');
  await page.locator('#chain-editor .chain-row').nth(1).locator('[data-role="ask"]').fill('f(x₂)−f(x₁) 可以怎样改写？');
  await page.fill('#f-errors', '学生用两个数值例子代替论证 → 追问：这两个点能代表全部吗？');
  await page.fill('#f-check', '问「两个例子为什么不够」；能说清例子≠论证即通过。');
  await page.check('#f-selfcheck');
  await page.waitForTimeout(1300); // 等防抖自动保存
  const savedTxt = (await page.locator('#ws-savestate').textContent()).trim();
  check('ws-autosave', savedTxt.includes('已保存'), savedTxt);
  const draftUrl = page.url();
  // 刷新恢复
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const titleAfter = await page.inputValue('#f-title');
  const chainRows = await page.locator('#chain-editor .chain-row').count();
  check('ws-restore-after-reload', titleAfter.includes('问题链改写') && chainRows === 2, 'title=' + titleAfter + ' rows=' + chainRows);
  // 预览
  await page.click('#btn-preview');
  await page.waitForTimeout(300);
  const previewText = await page.locator('.preview-doc').textContent();
  check('ws-preview', previewText.includes('四项核心字段完整') || previewText.includes('可观察目标'), previewText.slice(0, 40));
  await page.locator('#preview-panel').screenshot({ path: path.join(OUT, 'd-ws-preview.png') });
  // 完整度 tag（侧栏）
  const sideTxt = await page.locator('#ws-list .session.is-active .session__preview').textContent();
  check('ws-complete-tag', sideTxt.includes('四项完整'), sideTxt.trim());
  // Markdown 下载
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#btn-md'),
  ]);
  check('ws-md-download', !!dl && dl.suggestedFilename().endsWith('.md'), dl && dl.suggestedFilename());
  // JSON 备份下载
  const [dl2] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#btn-json'),
  ]);
  check('ws-json-download', !!dl2 && dl2.suggestedFilename().endsWith('.json'), dl2 && dl2.suggestedFilename());
  // 复制为新版本
  await page.click('#btn-fork');
  await page.waitForTimeout(600);
  const metaTxt = await page.textContent('#ws-draft-meta');
  check('ws-fork-v2', metaTxt.includes('v2'), metaTxt.trim());
  await page.screenshot({ path: path.join(OUT, 'd-workspace-filled.png'), fullPage: true });

  /* ---------- 记录页：使用与复盘 ---------- */
  await page.goto(BASE + '/records/', { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const rowCnt = await page.locator('#records-list .row-card').count();
  check('records-rows', rowCnt >= 2, 'rows=' + rowCnt);
  await page.locator('#records-list .row-card').first().locator('.row-card__head').click();
  await page.waitForTimeout(200);
  const firstBody = page.locator('#records-list .row-card').first();
  // 计划使用
  await firstBody.locator('[data-role="u-status"]').selectOption('planned');
  await firstBody.locator('[data-act="usage-save"]').click();
  await page.waitForTimeout(400);
  check('usage-planned', (await firstBody.locator('.row-card__title .tag:not(.tag--plain)').last().textContent()).includes('计划使用'));
  // 已实际使用 + 复盘
  await page.locator('#records-list .row-card').first().locator('.row-card__head').click();
  const body2 = page.locator('#records-list .row-card').first();
  await body2.locator('[data-role="u-status"]').selectOption('used');
  await page.waitForTimeout(200);
  await body2.locator('[data-role="u-date"]').fill('2026-10-16');
  await body2.locator('[data-role="u-obs"]').fill('3 名学生仍用两个例子说明递增；2 名说出了“任取”。');
  await body2.locator('[data-role="u-int"]').fill('问题链第 2 步停留时间不够，任意性没有被充分讨论。');
  await body2.locator('[data-role="u-next"]').fill('下一步：在第 2 步后加一个反例提问。');
  await body2.locator('[data-act="usage-save"]').click();
  await page.waitForTimeout(500);
  const reflectSnap = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('mtw_store_v1'));
    const u = Object.values(s.usage)[0];
    return { status: u.status, snap: !!u.snapshot, refl: u.reflections.length };
  });
  check('usage-used-snapshot', reflectSnap.status === 'used' && reflectSnap.snap && reflectSnap.refl === 1, JSON.stringify(reflectSnap));
  await page.locator('#records-list .row-card').first().screenshot({ path: path.join(OUT, 'd-records-row.png') });
  // 导出全部数据
  const [dl3] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#btn-export-all'),
  ]);
  check('records-export-all', !!dl3 && dl3.suggestedFilename().endsWith('.json'), dl3 && dl3.suggestedFilename());
  await page.screenshot({ path: path.join(OUT, 'd-records-filled.png'), fullPage: true });

  /* ---------- 纠错表单 ---------- */
  await page.goto(BASE + '/about/', { waitUntil: 'networkidle' });
  await page.selectOption('#errata-unit', 'MT-MONO-U2');
  await page.fill('#errata-desc', '图 1 的绿色段标注建议补充区间文字。');
  const [dl4] = await Promise.all([
    page.waitForEvent('download', { timeout: 5000 }),
    page.click('#errata-form button[type="submit"]'),
  ]);
  check('errata-download', !!dl4 && dl4.suggestedFilename().endsWith('.txt'), dl4 && dl4.suggestedFilename());

  /* ---------- 移动端 390×844 ---------- */
  const mp = await browser.newPage({ viewport: { width: 390, height: 844 } });
  for (const [route, name] of [['/', 'm-home'], ['/topics/monotonicity/', 'm-topic'], ['/learn/definition-proof/', 'm-u2'], ['/workspace/', 'm-ws'], ['/records/', 'm-records']]) {
    await mp.goto(BASE + route, { waitUntil: 'networkidle' });
    await mp.waitForTimeout(800);
    await mp.screenshot({ path: path.join(OUT, name + '.png'), fullPage: true });
  }
  // 移动端横向溢出检查
  for (const [route, name] of [['/', 'home'], ['/learn/definition-proof/', 'u2'], ['/workspace/', 'ws'], ['/records/', 'records']]) {
    await mp.goto(BASE + route, { waitUntil: 'networkidle' });
    const overflow = await mp.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check('mobile-no-overflow-' + name, overflow <= 0, 'overflowPx=' + overflow);
  }

  /* ---------- 汇总 ---------- */
  const fails = results.filter(r => !r.ok);
  console.log('\n==== QA SUMMARY: ' + (results.length - fails.length) + '/' + results.length + ' PASS ====');
  if (fails.length) { console.log('FAILED:'); fails.forEach(f => console.log(' - ' + f.name + ' ' + f.detail)); }

  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error('QA crashed:', e); process.exit(2); });
