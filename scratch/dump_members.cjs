const https = require('https');
const fs = require('fs');
const path = require('path');

// Load environment variables manually from root .env if running locally
try {
    const envPath = path.resolve(__dirname, '../.env');
    if (fs.existsSync(envPath)) {
        const envContent = fs.readFileSync(envPath, 'utf-8');
        envContent.split(/\r?\n/).forEach(line => {
            const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
            if (match) {
                const key = match[1];
                let value = match[2] || '';
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1);
                } else if (value.startsWith("'") && value.endsWith("'")) {
                    value = value.slice(1, -1);
                }
                process.env[key] = value.trim();
            }
        });
    }
} catch (e) {
    console.warn('Could not load .env file:', e.message);
}

const project = process.env.FIRESTORE_PROJECT_ID || 'seniorkatusa-aa594';
const database = process.env.FIRESTORE_DATABASE_ID || '(default)';
const url = `https://firestore.googleapis.com/v1/projects/${project}/databases/${database}/documents/members?pageSize=100`;

const req = https.get(url, (res) => {
    if (res.statusCode < 200 || res.statusCode >= 300) {
        console.error(`HTTP request failed with status code ${res.statusCode}`);
        res.resume(); // consume response data to free up memory
        return;
    }
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
        try {
            const parsed = JSON.parse(data);
            if (parsed.documents) {
                parsed.documents.forEach(doc => {
                    const fields = doc.fields;
                    const name = fields.name?.stringValue || 'N/A';
                    const keys = Object.keys(fields);
                    console.log(`Member: ${name}, Keys: ${keys.join(', ')}`);
                    if (fields.phoneNumber || fields.phone || fields.contact || fields.englishName) {
                        const mask = (str) => {
                            if (!str) return 'N/A';
                            if (str.length <= 4) return '***';
                            return str.slice(0, 3) + '*'.repeat(str.length - 6) + str.slice(-3);
                        };
                        console.log(`  -> Found extra field values:`, {
                            phoneNumber: mask(fields.phoneNumber?.stringValue),
                            phone: mask(fields.phone?.stringValue),
                            contact: mask(fields.contact?.stringValue),
                            englishName: fields.englishName?.stringValue
                        });
                    }
                });
            } else {
                console.log('No documents found or error:', data);
            }
        } catch (e) {
            console.error('JSON parsing error:', e);
        }
    });
});

req.on('error', (e) => {
    console.error('Request network or configuration error:', e);
});
