const { MediaMetadataModel } = require('./backend/src/models/Image/MediaMetadataModel');
const { db } = require('./backend/src/database/init');
const path = require('path');

// Mock db initialization if needed, but it should work if we are in the right place
try {
    const result1 = MediaMetadataModel.findAllWithFilesCursor({ limit: 50 });
    console.log('First page count:', result1.items.length);
    const lastItem = result1.items[result1.items.length - 1];
    console.log('Last item cursor:', lastItem.first_seen_date, lastItem.composite_hash);

    const result2 = MediaMetadataModel.findAllWithFilesCursor({
        limit: 50,
        cursorDate: lastItem.first_seen_date,
        cursorHash: lastItem.composite_hash
    });
    console.log('Second page count:', result2.items.length);
    if (result2.items.length > 0) {
        console.log('First item of second page:', result2.items[0].first_seen_date, result2.items[0].composite_hash);
    }
} catch (e) {
    console.error(e);
}
