import 'dotenv/config';
import { z } from 'zod';

// The API server itself only ever needs the Publishable key: every request is
// made through a per-user client scoped to the caller's JWT (see
// lib/supabaseClient.ts), so RLS stays in force. SUPABASE_SECRET_KEY is
// intentionally NOT part of this schema — it is read separately, only by
// scripts/seedDemoUsers.ts, so the main server never has it in memory.
const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  SUPABASE_URL: z.string().url(),
  SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Missing or invalid environment variables. Check apps/api/.env against .env.example.');
}

export const env = parsed.data;
