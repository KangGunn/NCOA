const allDates = ["6.3", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.11", "6.12"];

const dateObjects = Array.from(new Set(allDates)).map(d => {
    const [m, day] = d.split('.').map(Number);
    return { str: d, date: new Date(2026, m - 1, day) };
}).sort((a, b) => a.date.getTime() - b.date.getTime());

const startDate = new Date(dateObjects[0].date);
const currentDay = startDate.getDay();
const diffToWed = (currentDay - 3 + 7) % 7;
startDate.setDate(startDate.getDate() - diffToWed);

const endDate = new Date(dateObjects[dateObjects.length - 1].date);
const timeline = [];
const curr = new Date(startDate);
while (curr <= endDate) {
    timeline.push(`${curr.getMonth() + 1}.${curr.getDate()}`);
    curr.setDate(curr.getDate() + 1);
}

console.log("StartDate:", startDate.toDateString());
console.log("EndDate:", endDate.toDateString());
console.log("Timeline:", timeline);
