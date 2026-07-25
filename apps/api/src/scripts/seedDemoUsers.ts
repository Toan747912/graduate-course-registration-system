/**
 * Creates the demo accounts referenced by the BA portfolio (1 TRAINING_STAFF,
 * 2 ACTIVE STUDENT) via the Supabase Admin API. Uses SUPABASE_SECRET_KEY from
 * the local apps/api/.env file — never run this against a shared/CI
 * environment, and never commit real credentials.
 *
 * SUPABASE_SECRET_KEY grants full database access, bypassing RLS. It is read
 * ONLY in this script, nowhere else in the codebase, and must never be sent
 * to the frontend, logged, or committed to a .env file.
 *
 * Idempotent: if an account with the given email already exists, its profile
 * role/student_status is (re)synced instead of failing.
 *
 * Usage: npm run seed:demo-users --workspace apps/api
 */
import 'dotenv/config';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';

const demoUserEnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SECRET_KEY: z.string().min(1),
  DEMO_STAFF_EMAIL: z.string().email(),
  DEMO_STAFF_PASSWORD: z.string().min(8),
  DEMO_STUDENT1_EMAIL: z.string().email(),
  DEMO_STUDENT1_PASSWORD: z.string().min(8),
  DEMO_STUDENT2_EMAIL: z.string().email(),
  DEMO_STUDENT2_PASSWORD: z.string().min(8),
});

interface DemoAccount {
  email: string;
  password: string;
  fullName: string;
  role: 'STUDENT' | 'TRAINING_STAFF';
  studentStatus: 'ACTIVE' | null;
}

async function findUserIdByEmail(secretClient: SupabaseClient, email: string): Promise<string | null> {
  // Admin listUsers is paginated; the demo user set is tiny so one page suffices.
  const { data, error } = await secretClient.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) {
    throw new Error(`Failed to list users while looking up ${email}: ${error.message}`);
  }
  const match = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  return match?.id ?? null;
}

async function ensureDemoAccount(secretClient: SupabaseClient, account: DemoAccount): Promise<void> {
  let userId = await findUserIdByEmail(secretClient, account.email);

  if (userId) {
    const { error: passwordError } = await secretClient.auth.admin.updateUserById(userId, {
      password: account.password,
    });
    if (passwordError) {
      throw new Error(`Failed to reset password for ${account.email}: ${passwordError.message}`);
    }
    console.log(`[password-synced] ${account.email} already exists (${userId})`);
  } else {
    const { data, error } = await secretClient.auth.admin.createUser({
      email: account.email,
      password: account.password,
      email_confirm: true,
      user_metadata: { full_name: account.fullName },
    });

    if (error || !data.user) {
      throw new Error(`Failed to create ${account.email}: ${error?.message ?? 'unknown error'}`);
    }

    userId = data.user.id;
    console.log(`[created] ${account.email} (${userId})`);
  }

  // The on_auth_user_created trigger inserts a default STUDENT/ACTIVE profile;
  // sync it to the intended role/status (e.g. promote the staff demo account).
  const { error: profileError } = await secretClient
    .from('profiles')
    .update({
      full_name: account.fullName,
      role: account.role,
      student_status: account.studentStatus,
    })
    .eq('id', userId);

  if (profileError) {
    throw new Error(`Failed to sync profile for ${account.email}: ${profileError.message}`);
  }

  console.log(`[synced] ${account.email} -> role=${account.role} student_status=${account.studentStatus ?? 'null'}`);
}

async function main(): Promise<void> {
  const parsed = demoUserEnvSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Missing demo user environment variables:', parsed.error.flatten().fieldErrors);
    console.error(
      'Set SUPABASE_URL / SUPABASE_SECRET_KEY / DEMO_STAFF_EMAIL / DEMO_STAFF_PASSWORD / DEMO_STUDENT1_* / DEMO_STUDENT2_* in apps/api/.env',
    );
    process.exitCode = 1;
    return;
  }
  const env = parsed.data;

  // Built here, scoped to this script only — never exported for reuse by the
  // running server (see lib/supabaseClient.ts, which only ever uses the
  // Publishable key).
  const secretClient: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const accounts: DemoAccount[] = [
    {
      email: env.DEMO_STAFF_EMAIL,
      password: env.DEMO_STAFF_PASSWORD,
      fullName: 'Demo Training Staff',
      role: 'TRAINING_STAFF',
      studentStatus: null,
    },
    {
      email: env.DEMO_STUDENT1_EMAIL,
      password: env.DEMO_STUDENT1_PASSWORD,
      fullName: 'Demo Student One',
      role: 'STUDENT',
      studentStatus: 'ACTIVE',
    },
    {
      email: env.DEMO_STUDENT2_EMAIL,
      password: env.DEMO_STUDENT2_PASSWORD,
      fullName: 'Demo Student Two',
      role: 'STUDENT',
      studentStatus: 'ACTIVE',
    },
  ];

  for (const account of accounts) {
    await ensureDemoAccount(secretClient, account);
  }

  console.log('Demo users seeded successfully.');
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
