#!/usr/bin/env node
import { db, migrationManager, initializeDatabase } from './init';

// Initialize database and run migrations
(async () => {
  try {
    console.log('🔄 Initializing database and running migrations...');
    await initializeDatabase();
    console.log('✅ Database initialization and migrations completed successfully!');
    db.close();
    process.exit(0);
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    db.close();
    process.exit(1);
  }
})();
