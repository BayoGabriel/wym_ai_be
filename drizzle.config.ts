import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema',
  out: './drizzle/migrations',
  dbCredentials: {
    url: process.env.DATABASE_URL || '',
    ssl: process.env.DATABASE_SSL === 'require' ? { rejectUnauthorized: false } : false,
  },
});
