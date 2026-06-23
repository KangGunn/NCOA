const utils = require('./src/utils/movement.utils.ts');

// Wait, we can't require TS directly like this in Node without ts-node.
// Let's just copy the function:

function extractDayCountFromText(reasonStr) {
    if (!reasonStr) return null;
    const clean = reasonStr.trim().toLowerCase();
    
    // Match numeric days like "3일", "4.5일", "4 데이", "3.5데이"
    const numericMatch = clean.match(/(\d+(?:\.\d+)?)\s*(?:데이|일)/);
    if (numericMatch) {
        return parseFloat(numericMatch[1]);
    }
    
    // Match Korean day words
    const textDayMap = {
        '원': 1, 'one': 1,
        '투': 2, 'two': 2,
        '쓰리': 3, 'three': 3,
        '포': 4, 'four': 4,
        '파이브': 5, 'five': 5,
        '식스': 6, 'six': 6,
        '세븐': 7, 'seven': 7,
        '에잇': 8, 'eight': 8,
        '나인': 9, 'nine': 9,
        '텐': 10, 'ten': 10
    };
    
    for (const [key, val] of Object.entries(textDayMap)) {
        if (clean.includes(`${key}데이`) || clean.includes(`${key} 데이`)) {
            return val;
        }
    }
    
    return null;
}

const reasons = [
    '돈사 쓰리데이',
    '토당으로 인한 PAO 08-26 투데이',
    '금당으로 인한 원데이',
    'Juneteenth Holiday 포데이',
    'PAO 07-26 포데이',
    'Independence Day Holiday 포데이',
    '일반 투데이',
    'PAO 08.26 투데이'
];

reasons.forEach(r => console.log(r, '=>', extractDayCountFromText(r)));
