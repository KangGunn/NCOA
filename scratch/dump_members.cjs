const https = require('https');

https.get('https://firestore.googleapis.com/v1/projects/seniorkatusa-aa594/databases/(default)/documents/members?pageSize=100', (res) => {
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
                        console.log(`  -> Found extra field values:`, {
                            phoneNumber: fields.phoneNumber?.stringValue,
                            phone: fields.phone?.stringValue,
                            contact: fields.contact?.stringValue,
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
