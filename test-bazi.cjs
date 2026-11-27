/*
 * Run: node --test test-bazi.cjs
 * Set LUNAR_JS to a local lunar-javascript 1.6.12 lunar.js for offline use.
 * Optional browser checks: set BAZI_BROWSER to a Chromium executable and install playwright.
 * No request is sent to Supabase.
 */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {test, before} = require('node:test');
const assert = require('node:assert/strict');

const html = fs.readFileSync(path.join(__dirname, 'test.html'), 'utf8');
const libraryURL = html.match(/<script src="([^"]*lunar-javascript[^"]*)"/)[1];
let library;
let api;
before(async () => {
  if (process.env.LUNAR_JS) library = fs.readFileSync(process.env.LUNAR_JS, 'utf8');
  else {
    const response = await fetch(libraryURL, {signal: AbortSignal.timeout(10000)});
    assert.ok(response.ok, 'lunar-javascript failed to load');
    library = await response.text();
  }
  const context = vm.createContext({});
  vm.runInContext(library, context);
  const script = html.split('<script>')[1].split('// 八字核心結束')[0];
  vm.runInContext(script + '\n globalThis.api = {Solar, chartModel, solarTerms, reading, activeLuck, slices, keyOf};', context);
  api = context.api;
});

const date = (year, month, day, hour = 0, minute = 0, second = 0) =>
  api.Solar.fromYmdHms(year, month, day, hour, minute, second);
const model = (stamp, gender = 'female') => api.chartModel(date(...stamp), gender);
const pillars = profile => Array.from(profile.pillars);

test('臺北天文年鑑 2024 立春與驚蟄分鐘對照，節氣前後完整四柱', () => {
  // 臺北市立天文科學教育館《2024 天文年鑑》曆象表
  // https://www-ws.gov.taipei/001/Upload/439/relfile/21703/3425086/d6082728-c8bb-4be4-a15f-e507264ee47a.pdf
  // 年鑑以最近分鐘顯示，函式庫提供秒。以下用前後整分鐘避開捨入差異。
  const terms = api.solarTerms(2024);
  const nearestMinute = solar => new Date(Date.parse(api.keyOf(solar).replace(' ', 'T') + 'Z') + 30000)
    .toISOString().slice(0,16);
  assert.equal(nearestMinute(terms[0]), '2024-02-04T16:27');
  assert.equal(nearestMinute(terms[1]), '2024-03-05T10:23');
  assert.equal(api.keyOf(terms[0]), '2024-02-04 16:27:05');
  assert.equal(pillars(model([2024,2,4,16,27,4]))[0], '癸卯');
  assert.equal(pillars(model([2024,2,4,16,27,5]))[0], '甲辰');
  assert.deepEqual(pillars(model([2024,2,4,16,26])), ['癸卯','乙丑','戊戌','庚申']);
  assert.deepEqual(pillars(model([2024,2,4,16,28])), ['甲辰','丙寅','戊戌','庚申']);
  assert.deepEqual(pillars(model([2024,3,5,10,22])), ['甲辰','丙寅','戊辰','丁巳']);
  assert.deepEqual(pillars(model([2024,3,5,10,24])), ['甲辰','丁卯','戊辰','丁巳']);
  assert.equal(api.keyOf(terms[11]).slice(0,10), '2025-01-05');
  assert.equal(api.reading(model([2000,1,1]), terms[11], {monthly:true, yearAnchor:terms[0]}).month, '丁丑');
});

test('曆法獨立算例：JDN 日干支、甲己日子時起甲及晚子時', () => {
  // Gregorian JDN 2451545 (2000-01-01); (JDN + 49) modulo 60 = 戊午。
  assert.deepEqual(pillars(model([2000,1,1,12])), ['己卯','丙子','戊午','戊午']);
  assert.equal(pillars(model([2000,1,1,23,59]))[2], '戊午');
  assert.equal(pillars(model([2000,1,2,0,0]))[2], '己未');
  assert.equal(pillars(model([2000,1,2,0,0]))[3], '甲子');
});

test('陽年與陰年的男女順逆、第 2 法起運及交運邊界', () => {
  const male = model([2000,1,1,12], 'male');
  const female = model([2000,1,1,12]);
  assert.equal(male.forward, false);
  assert.equal(female.forward, true);
  assert.equal(model([1988,8,8,8], 'male').forward, true);
  assert.equal(model([1988,8,8,8]).forward, false);
  assert.equal(male.periods[0].pillar, '乙亥');
  assert.equal(female.periods[0].pillar, '丁丑');
  assert.equal(api.keyOf(male.start), '2008-03-12 14:00:00');
  assert.equal(api.keyOf(female.start), '2001-08-16 12:00:00');
  assert.equal(api.activeLuck(male, date(2008,3,12,13,59,59)), undefined);
  assert.equal(api.activeLuck(male, date(2008,3,12,14)).pillar, '乙亥');
  assert.equal(api.activeLuck(male, date(2018,3,12,13,59,59)).pillar, '乙亥');
  assert.equal(api.activeLuck(male, date(2018,3,12,14)).pillar, '甲戌');
  assert.equal(api.slices(male,date(2018,3,5),date(2018,4,5)).length, 2);
});

test('虛構真實日期命盤：身強、身弱、從格與專旺候選', () => {
  const weak = model([1988,8,8,8]);
  const follow = model([1992,11,16,0]);
  const strong = model([1992,12,13,0]);
  assert.deepEqual(pillars(weak), ['戊辰','庚申','乙未','庚辰']);
  assert.equal(weak.state, '身弱');
  assert.equal(follow.special, '從殺');
  assert.equal(strong.state, '身強');
  assert.equal(strong.special, '潤下專旺');
  assert.equal(strong.priority[0], 4);
});

test('虛構真實日期命盤：合而不化、天干判化、六合判化及轉化入權重', () => {
  const blocked = model([1990,1,1,6]);
  const joins = model([1990,1,7,0]);
  const stem = model([1992,11,16,0]);
  assert.ok(blocked.hits.some(hit => hit.symbols === '丙辛' && !hit.transforms && hit.reason.includes('本根')));
  assert.ok(joins.hits.some(hit => hit.symbols === '子丑' && hit.transforms));
  assert.ok(stem.hits.some(hit => hit.symbols === '丙辛' && hit.transforms));
  assert.ok(Math.abs(stem.weights.reduce((sum, value) => sum + value, 0) - 9) < 1e-10);
  assert.ok(stem.weights[4] > stem.weights[3]);
});

test('同流年不同盤、同一盤同流年跨大運，分數與實際行動評語均不同', () => {
  const now = date(2026,10,3,10);
  const a = api.reading(model([1988,8,8,8]), now);
  const b = api.reading(model([1992,12,13,0]), now);
  assert.equal(a.year, b.year);
  assert.notEqual(a.overall, b.overall);
  assert.ok(a.scores.filter((item,index) => item.advice !== b.scores[index].advice).length >= 6);
  const person = model([2000,1,1,12], 'male');
  const before = api.reading(person, date(2018,3,12,13,59,59));
  const after = api.reading(person, date(2018,3,12,14));
  assert.equal(before.year, after.year);
  assert.notEqual(before.overall, after.overall);
  assert.ok(before.scores.some((item,index) => item.advice !== after.scores[index].advice));
});

test('十二節月與十日干共 120 組可排盤，每組都有分月調候候選', () => {
  const covered = new Set();
  for (let month = 1; month <= 12; month++) {
    for (let day = 10; day < 20; day++) {
      const profile = model([2024,month,day,12]);
      const monthBranch = profile.pillars[1][1];
      covered.add(monthBranch + profile.day);
      assert.ok(profile.preference.every(Number.isFinite));
      const candidates = Array.from(profile.seasonalCandidates, candidate => candidate.stem);
      assert.ok(candidates.length > 0);
      assert.equal(new Set(candidates).size, candidates.length);
      assert.ok(candidates.every(stem => '甲乙丙丁戊己庚辛壬癸'.includes(stem)));
      assert.ok(Math.abs(profile.weights.reduce((sum, weight) => sum + weight, 0) - 9) < 1e-10);
    }
  }
  assert.equal(covered.size, 120);
});

test('同為寅月，丙、丁日取用不同；癸日辰月按穀雨秒級分段', () => {
  const targets = p => Array.from(p.seasonalCandidates, candidate => candidate.stem).join('');
  const before = model([2024,4,19,12]);
  const after = model([2024,4,19,23]);
  assert.equal(before.day, '癸');
  assert.equal(after.day, '癸');
  assert.equal(before.pillars[1], after.pillars[1]);
  assert.equal(targets(before), '丙');
  assert.equal(targets(after), '丙辛甲');
  const spring = Array.from({length:10}, (_, index) => model([2024,2,index+10,12]));
  assert.equal(targets(spring.find(profile => profile.day === '丙')), '壬庚');
  assert.equal(targets(spring.find(profile => profile.day === '丁')), '庚');
});

test('夏至、大暑、秋分與大寒分段會改變同節月的調候取用', () => {
  const fixtures = [
    [[2024,6,20,12], [2024,6,30,12], '乙', '午', '癸', /^(癸丙|丙癸)$/],
    [[2024,7,18,12], [2024,7,28,12], '癸', '未', '庚辛壬', /^庚辛$/],
    [[2024,9,18,12], [2024,9,28,12], '乙', '酉', '癸', /^丙癸$/],
    [[2024,1,19,12], [2024,1,29,12], '壬', '丑', '丙', /^丙甲$/]
  ];
  for (const [early, late, dayStem, monthBranch, expectedEarly, expectedLate] of fixtures) {
    const before = model(early);
    const after = model(late);
    assert.equal(before.day, dayStem);
    assert.equal(after.day, dayStem);
    assert.equal(before.pillars[1][1], monthBranch);
    assert.equal(after.pillars[1], before.pillars[1]);
    const targets = profile => Array.from(profile.seasonalCandidates, candidate => candidate.stem).join('');
    assert.equal(targets(before), expectedEarly);
    assert.match(targets(after), expectedLate);
  }
});

test('流年透干引動原局與大運六合，火土氣量同步轉移', () => {
  const person = model([1994,11,1,12]);
  const previous = api.reading(person, date(2027,7,15,12));
  const current = api.reading(person, date(2028,7,15,12));
  assert.equal(previous.luck, '辛未');
  assert.equal(current.luck, '辛未');
  assert.equal(previous.year, '丁未');
  assert.equal(current.year, '戊申');
  assert.ok(previous.natalShift.every(value => value === 0));
  assert.deepEqual(Array.from(current.natalShift), [0,-.7,.7,0,0]);
  assert.ok(current.hits.some(hit => hit.symbols === '午未' && hit.transforms));
});

test('Chromium 走試算、流月與列印入口，網路隔離', {skip: !process.env.BAZI_BROWSER}, async () => {
  const {chromium} = require('playwright');
  const browser = await chromium.launch({executablePath:process.env.BAZI_BROWSER, args:['--no-sandbox']});
  try {
    const page = await browser.newPage({viewport:{width:390,height:844}});
    const errors = [];
    const unexpected = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url === 'https://test.invalid/test.html') return route.fulfill({contentType:'text/html',body:html});
      if (url === libraryURL) return route.fulfill({contentType:'application/javascript',body:library});
      if (url.includes('supabase-js')) return route.fulfill({
        contentType:'application/javascript', body:'export const createClient = () => ({});',
        headers:{'access-control-allow-origin':'*'}
      });
      unexpected.push(url);
      return route.abort();
    });
    await page.clock.setFixedTime(new Date('2026-11-27T10:00:00Z'));
    await page.goto('https://test.invalid/test.html');
    await page.locator('[name=nickname]').fill('虛構命盤甲');
    await page.locator('[name=birth_date]').fill('1988-08-08');
    await page.locator('[name=birth_time]').fill('08:00:00');
    await page.locator('[name=birth_place]').fill('虛構城');
    await page.locator('#calculate').click();
    await page.getByText('八字本命盤').waitFor();
    await page.getByRole('heading', {name:'節月調候 · 乙日申月'}).waitFor();
    assert.deepEqual(await page.locator('.pillars .pillar b').allTextContents(), ['時柱','日柱','月柱','年柱']);
    assert.equal(await page.locator('.annual-card').count(), 10);
    assert.equal(await page.locator('.trend svg').count(), 1);
    const current = page.locator('.annual-card.current-year');
    await current.getByText('十二節氣月').click();
    await current.getByText(/立春 · .*%/).waitFor();
    assert.equal(await current.locator('details article').count(), 12);
    await page.evaluate(() => {
      window.print = () => {
        document.body.dataset.printableMonths = document.querySelectorAll('#chart .annual-card details[open] article').length;
      };
    });
    await page.locator('#chart').getByText('列印／儲存 PDF').click();
    assert.ok(Number(await page.locator('body').getAttribute('data-printable-months')) >= 120);
    assert.equal(await page.locator('.annual-card[open]').count(),1);
    assert.deepEqual(errors, []);
    assert.deepEqual(unexpected, []);
  } finally {
    await browser.close();
  }
});
