const https = require('https');

const url = "https://docs.google.com/spreadsheets/d/1_M1IB3VKq83sgvXdDxwS9W8cvvfkXbO4zf7e1XLnAgU/export?format=csv&gid=1529486829";

https.get(url, (res) => {
    let rawData = '';
    res.on('data', (chunk) => { rawData += chunk; });
    res.on('end', () => {
        try {
            console.log(rawData);
        } catch (e) {
            console.error(e.message);
        }
    });
}).on('error', (e) => {
    console.error(`Got error: ${e.message}`);
});
