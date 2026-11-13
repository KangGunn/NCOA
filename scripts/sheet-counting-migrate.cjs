/**
 * NEW 탭 집계 규칙 변경: 수식(23~30행, 35~38행), 드롭다운, 예전 값 변환.
 *
 * 사용법 (functions를 먼저 빌드: npm --prefix functions run build)
 *   node scripts/sheet-counting-migrate.cjs <spreadsheetId>          → 바뀔 내용만 보여 준다 (쓰지 않음)
 *   node scripts/sheet-counting-migrate.cjs <spreadsheetId> --apply  → 실제로 적용
 *
 * 규칙: 셀 값은 그날 일어난 일(외박출발·외박복귀·휴가출발·휴가복귀)을 '/'로 이은 것.
 *  - 출발·복귀 집계(35~38행)는 그 단어가 들어 있으면 센다.
 *  - 마지막 항목이 그날 밤 상태: 외박/외박출발로 끝나면 외박, 휴가/휴가출발로 끝나면 휴가, 복귀로 끝나면 부대.
 *  - 33행(잔류)=41행(현재원)=40행(총원)-42행(열외), 42행(열외)=23~30행 합 — 기존 구조를 그대로 쓴다.
 */
const path = require('path');
const { getGoogleSheetsInstance } = require(path.join(__dirname, '../functions/lib/repositories/sheet.repository.js'));

const SHEET = 'NEW';
const FIRST_ROW = 3; // 대원 행 시작 (1-based)
const LAST_ROW = 22; // 대원 행 끝

const AWAY_PASS = ['외박', '외박출발', '외박복귀/외박출발', '휴가복귀/외박출발', '휴가출발/휴가복귀/외박출발'];
const AWAY_VACATION = ['휴가', '휴가출발', '외박복귀/휴가출발'];
const DROPDOWN = [
    '외박', '외박출발', '외박복귀',
    '휴가', '휴가출발', '휴가복귀',
    '외박복귀/휴가출발',
    '휴가복귀/외박출발',
    '휴가출발/휴가복귀', '휴가출발/휴가복귀/외박출발',
    '외박복귀/외박출발',
    '외출', '당직',
];
const RENAME = {
    '휴가출발(연계)': '외박복귀/휴가출발',
    '휴가복귀(연계)/외박출발': '휴가복귀/외박출발',
    '외박출발(연계)': '휴가복귀(연계)/외박출발',
    '외박 휴가복귀/외박출발': '휴가복귀/외박출발',
    // 같은 날 휴가출발과 외박출발 = 당일 휴가 후 외박 출발
    '휴가출발/외박출발(연계)': '휴가출발/휴가복귀/외박출발',
};
const RANK_ROWS = [
    { row: 23, rank: '병장', list: AWAY_VACATION }, { row: 24, rank: '병장', list: AWAY_PASS },
    { row: 25, rank: '상병', list: AWAY_VACATION }, { row: 26, rank: '상병', list: AWAY_PASS },
    { row: 27, rank: '일병', list: AWAY_VACATION }, { row: 28, rank: '일병', list: AWAY_PASS },
    { row: 29, rank: '이병', list: AWAY_VACATION }, { row: 30, rank: '이병', list: AWAY_PASS },
];
const TOKEN_ROWS = [
    { row: 35, label: '휴가출발' }, { row: 36, label: '휴가복귀' },
    { row: 37, label: '외박출발' }, { row: 38, label: '외박복귀' },
];

const colLetter = (idx) => { let s = ''; let n = idx; while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } return s; };
const arr = (list) => `{${list.map(v => `"${v}"`).join(',')}}`;
const rng = (c) => `INDEX(${c}:${c}, ${FIRST_ROW}):INDEX(${c}:${c}, ${LAST_ROW})`;

function rankFormula(c, rank, list) {
    return `=SUMPRODUCT(ISNUMBER(SEARCH("${rank}", INDIRECT("A${FIRST_ROW}:A${LAST_ROW}"))) * ISNUMBER(MATCH(${rng(c)}, ${arr(list)}, 0)))`;
}
const tokenFormula = (c, token) => `=COUNTIF(${rng(c)}, "*${token}*")`;

(async () => {
    const [id, flag] = process.argv.slice(2);
    if (!id) throw new Error('spreadsheetId가 필요합니다.');
    const apply = flag === '--apply';
    const sheets = await getGoogleSheetsInstance();

    const meta = await sheets.spreadsheets.get({ spreadsheetId: id, fields: 'properties(title),sheets(properties(sheetId,title,gridProperties))' });
    const tab = meta.data.sheets.find(s => s.properties.title === SHEET);
    if (!tab) throw new Error(`'${SHEET}' 탭이 없습니다.`);
    const sheetId = tab.properties.sheetId;

    const header = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${SHEET}'!1:1` })).data.values?.[0] || [];
    const lastCol = header.length - 1; // A=0, 날짜 열은 1..lastCol
    if (lastCol < 1) throw new Error('날짜 줄(1행)이 비어 있습니다.');

    const labels = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${SHEET}'!A23:A42` })).data.values || [];
    const labelAt = (row) => (labels[row - 23] || [])[0] || '';
    for (const r of RANK_ROWS) if (labelAt(r.row) !== `${r.rank} ${r.list === AWAY_PASS ? '외박' : '휴가'}`) throw new Error(`${r.row}행 이름이 예상과 다릅니다: '${labelAt(r.row)}'`);
    for (const r of TOKEN_ROWS) if (labelAt(r.row) !== r.label) throw new Error(`${r.row}행 이름이 예상과 다릅니다: '${labelAt(r.row)}'`);

    // 1) 수식
    const data = [];
    for (const r of RANK_ROWS) {
        const values = [];
        for (let c = 1; c <= lastCol; c++) values.push(rankFormula(colLetter(c), r.rank, r.list));
        data.push({ range: `'${SHEET}'!B${r.row}:${colLetter(lastCol)}${r.row}`, values: [values] });
    }
    for (const r of TOKEN_ROWS) {
        const values = [];
        for (let c = 1; c <= lastCol; c++) values.push(tokenFormula(colLetter(c), r.label));
        data.push({ range: `'${SHEET}'!B${r.row}:${colLetter(lastCol)}${r.row}`, values: [values] });
    }

    // 2) 예전 값 변환 + 드롭다운에 없는 값 찾기
    const body = (await sheets.spreadsheets.values.get({ spreadsheetId: id, range: `'${SHEET}'!A${FIRST_ROW}:${colLetter(lastCol)}${LAST_ROW}` })).data.values || [];
    const renames = [];
    const unknown = [];
    body.forEach((row, ri) => row.forEach((v, ci) => {
        if (ci === 0 || !v) return;
        const cell = `${colLetter(ci)}${FIRST_ROW + ri}`;
        if (RENAME[v]) {
            renames.push({ cell, from: v, to: RENAME[v] });
            data.push({ range: `'${SHEET}'!${cell}`, values: [[RENAME[v]]] });
        } else if (!DROPDOWN.includes(v)) {
            unknown.push({ cell, name: row[0], value: v });
        }
    }));

    console.log(`대상: ${meta.data.properties.title} / ${SHEET} (날짜 열 B~${colLetter(lastCol)}, ${lastCol}개)`);
    console.log(`수식: 23~30행, 35~38행 × ${lastCol}열`);
    console.log(`B24 예: ${rankFormula('B', '병장', AWAY_PASS)}`);
    console.log(`B37 예: ${tokenFormula('B', '외박출발')}`);
    console.log(`값 변환 ${renames.length}건:`, JSON.stringify(renames));
    console.log(`드롭다운에 없는 값 ${unknown.length}건 (그대로 둠):`, JSON.stringify(unknown));
    console.log(`드롭다운: ${DROPDOWN.join(' | ')}`);

    if (!apply) {
        console.log('\n(미리 보기만 했습니다. 적용하려면 --apply)');
        return;
    }

    await sheets.spreadsheets.values.batchUpdate({ spreadsheetId: id, requestBody: { valueInputOption: 'USER_ENTERED', data } });

    // 드롭다운을 API로 다시 넣으면 시트 화면에서 정한 칩 색이 모두 지워진다 → 목록이 이미 같으면 건드리지 않는다
    const current = await sheets.spreadsheets.get({
        spreadsheetId: id,
        ranges: [`'${SHEET}'!B${FIRST_ROW}:B${FIRST_ROW}`],
        fields: 'sheets(data(rowData(values(dataValidation))))',
    });
    const currentValues = (current.data.sheets?.[0]?.data?.[0]?.rowData?.[0]?.values?.[0]?.dataValidation?.condition?.values || [])
        .map(v => v.userEnteredValue);
    if (JSON.stringify(currentValues) === JSON.stringify(DROPDOWN)) {
        console.log('\n수식·값을 적용했습니다. 드롭다운 목록은 이미 같아서 그대로 두었습니다(칩 색 유지).');
        return;
    }
    console.log('\n주의: 드롭다운 목록을 바꿉니다. 칩 색이 모두 지워지므로 시트 화면(데이터 → 데이터 확인)에서 다시 지정해야 합니다.');
    await sheets.spreadsheets.batchUpdate({
        spreadsheetId: id,
        requestBody: {
            requests: [{
                setDataValidation: {
                    range: { sheetId, startRowIndex: FIRST_ROW - 1, endRowIndex: LAST_ROW, startColumnIndex: 1, endColumnIndex: lastCol + 1 },
                    rule: {
                        condition: { type: 'ONE_OF_LIST', values: DROPDOWN.map(v => ({ userEnteredValue: v })) },
                        strict: true,
                        showCustomUi: true,
                    },
                },
            }],
        },
    });
    console.log('\n적용했습니다.');
})().catch(e => { console.error('오류:', e.message); process.exit(1); });
