const { Pool } = require('pg');

// Accept either a full connection string (DATABASE_URL / POSTGRES_URL /
// DATABASE_PUBLIC_URL) or individual PG* vars (PGHOST, PGUSER, PGPASSWORD,
// PGDATABASE, PGPORT) — Railway exposes both shapes depending on how the
// Postgres plugin is linked.
let pool = null;
const connectionString =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_PUBLIC_URL ||
  null;

const hasPgVars = process.env.PGHOST && process.env.PGUSER && process.env.PGPASSWORD && process.env.PGDATABASE;

if (connectionString) {
  pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  console.log('[DB] Using connection string from env');
} else if (hasPgVars) {
  pool = new Pool({
    host: process.env.PGHOST,
    port: parseInt(process.env.PGPORT || '5432', 10),
    user: process.env.PGUSER,
    password: process.env.PGPASSWORD,
    database: process.env.PGDATABASE,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
  console.log('[DB] Using PGHOST/PGUSER/PGPASSWORD/PGDATABASE from env');
}

if (pool) {
  pool.on('error', e => console.error('[DB] Pool error:', e.message));
}

async function query(sql, params = []) {
  if (!pool) throw new Error('DATABASE_URL not configured');
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

async function initSchema() {
  if (!pool) { console.log('[DB] No DATABASE_URL — using JSON fallback'); return; }
  try {
    await query(`
      CREATE EXTENSION IF NOT EXISTS "pgcrypto";

      CREATE TABLE IF NOT EXISTS rp_users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        username TEXT UNIQUE NOT NULL,
        email TEXT,
        password_hash TEXT NOT NULL,
        token TEXT UNIQUE NOT NULL,
        plan TEXT NOT NULL DEFAULT 'free',
        plan_expires_at TIMESTAMPTZ,
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rp_sessions (
        user_id UUID PRIMARY KEY REFERENCES rp_users(id) ON DELETE CASCADE,
        csrf TEXT NOT NULL,
        cookies TEXT NOT NULL,
        domain TEXT NOT NULL DEFAULT 'www.vinted.co.uk',
        member_id TEXT,
        stored_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS rp_items (
        item_id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        title TEXT,
        description TEXT,
        price NUMERIC(10,2),
        currency TEXT DEFAULT 'GBP',
        status TEXT DEFAULT 'active',
        image TEXT,
        views INTEGER DEFAULT 0,
        favourites INTEGER DEFAULT 0,
        repost_count INTEGER DEFAULT 0,
        last_repost TIMESTAMPTZ,
        cost_price NUMERIC(10,2),
        stock_qty INTEGER DEFAULT 1,
        first_seen TIMESTAMPTZ DEFAULT NOW(),
        sold_at TIMESTAMPTZ,
        raw_data JSONB DEFAULT '{}',
        PRIMARY KEY (item_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rp_sold_items (
        item_id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        title TEXT,
        price NUMERIC(10,2),
        sold_at TIMESTAMPTZ,
        image TEXT,
        buyer_name TEXT DEFAULT '',
        PRIMARY KEY (item_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rp_snapshots (
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        snap_date DATE NOT NULL,
        total_views INTEGER DEFAULT 0,
        total_favs INTEGER DEFAULT 0,
        item_count INTEGER DEFAULT 0,
        PRIMARY KEY (user_id, snap_date)
      );

      CREATE TABLE IF NOT EXISTS rp_messages (
        id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        conv_id TEXT,
        type TEXT,
        username TEXT,
        body TEXT,
        time TIMESTAMPTZ DEFAULT NOW(),
        auto_replied BOOLEAN DEFAULT false,
        item_title TEXT,
        PRIMARY KEY (id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rp_schedules (
        id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        name TEXT,
        active BOOLEAN DEFAULT true,
        freq INTEGER DEFAULT 1,
        hour_of_day INTEGER DEFAULT 12,
        start_hour INTEGER DEFAULT 9,
        end_hour INTEGER DEFAULT 21,
        item_ids TEXT[] DEFAULT '{}',
        next_run TIMESTAMPTZ,
        last_run TIMESTAMPTZ,
        date TEXT,
        slot TEXT,
        executed BOOLEAN DEFAULT false,
        PRIMARY KEY (id, user_id)
      );
      DO $$ BEGIN
        ALTER TABLE rp_schedules ADD COLUMN IF NOT EXISTS date TEXT;
        ALTER TABLE rp_schedules ADD COLUMN IF NOT EXISTS slot TEXT;
        ALTER TABLE rp_schedules ADD COLUMN IF NOT EXISTS executed BOOLEAN DEFAULT false;
        ALTER TABLE rp_schedules ADD COLUMN IF NOT EXISTS tz_offset INTEGER DEFAULT 0;
        ALTER TABLE rp_items ADD COLUMN IF NOT EXISTS previous_item_id TEXT;
        -- Password reset
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS reset_code TEXT;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS reset_expires TIMESTAMPTZ;
        -- Telegram integration
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS telegram_username TEXT;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS telegram_chat_id TEXT;
        -- Referral system
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS referral_code TEXT;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS referred_by UUID;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS referral_rewards INTEGER DEFAULT 0;
        -- Multi-Vinted-account support: which Vinted account is the current target for this RP user
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS active_member_id TEXT;
        -- Vinted display name, written by the extension during sync so the
        -- Telegram bot doesn't have to probe Vinted from Railway's datacenter IP.
        ALTER TABLE rp_sessions ADD COLUMN IF NOT EXISTS vinted_name TEXT;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Multi-Vinted-account: rp_sessions PK flips from (user_id) to (user_id, member_id).
      -- Idempotent: if the PK is already composite, the DROP+ADD is a no-op-equivalent; the
      -- DELETE clears any pre-migration rows with NULL member_id that can't be addressed.
      DO $$
      DECLARE
        pk_cols TEXT;
      BEGIN
        SELECT string_agg(a.attname, ',' ORDER BY array_position(i.indkey, a.attnum))
          INTO pk_cols
          FROM pg_index i
          JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey)
         WHERE i.indrelid = 'rp_sessions'::regclass AND i.indisprimary;
        IF pk_cols IS DISTINCT FROM 'user_id,member_id' THEN
          DELETE FROM rp_sessions WHERE member_id IS NULL;
          EXECUTE 'ALTER TABLE rp_sessions DROP CONSTRAINT IF EXISTS rp_sessions_pkey';
          EXECUTE 'ALTER TABLE rp_sessions ADD PRIMARY KEY (user_id, member_id)';
        END IF;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;
      -- Unique index on referral_code (nulls excluded so only one constraint per non-null code)
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_users_referral_code ON rp_users(referral_code) WHERE referral_code IS NOT NULL;

      CREATE TABLE IF NOT EXISTS rp_pending_activations (
        item_id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        activate_at TIMESTAMPTZ NOT NULL,
        draft_data JSONB DEFAULT '{}',
        upload_session_id TEXT,
        PRIMARY KEY (item_id, user_id)
      );

      CREATE TABLE IF NOT EXISTS rp_settings (
        user_id UUID PRIMARY KEY REFERENCES rp_users(id) ON DELETE CASCADE,
        data JSONB NOT NULL DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS rp_actions (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        type TEXT NOT NULL,
        item_id TEXT,
        new_item_id TEXT,
        item_title TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        details JSONB DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rp_actions_user_time ON rp_actions(user_id, created_at DESC);

      -- Append-only item backups so a lost/failed-repost item can always be recovered.
      -- One row per backup snapshot — never overwritten, pruned to keep last 10 per item.
      CREATE TABLE IF NOT EXISTS rp_item_backups (
        id BIGSERIAL PRIMARY KEY,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        item_id TEXT NOT NULL,
        title TEXT,
        description TEXT,
        price NUMERIC(10,2),
        currency TEXT,
        brand TEXT,
        size TEXT,
        photos JSONB DEFAULT '[]',
        raw_data JSONB DEFAULT '{}',
        backed_up_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rp_item_backups_user_item ON rp_item_backups(user_id, item_id, backed_up_at DESC);

      -- Prevent concurrent reposts of the same item
      CREATE TABLE IF NOT EXISTS rp_repost_locks (
        item_id TEXT NOT NULL,
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        locked_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (item_id, user_id)
      );

      -- Extension <-> Telegram command channel
      CREATE TABLE IF NOT EXISTS rp_commands (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES rp_users(id) ON DELETE CASCADE,
        target_member_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        stage TEXT,
        stage_label TEXT,
        progress_pct INTEGER DEFAULT 0,
        eta_ms INTEGER,
        payload JSONB NOT NULL DEFAULT '{}',
        result JSONB DEFAULT '{}',
        source TEXT DEFAULT 'telegram',
        idempotency_key TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        claimed_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_rp_commands_user_status
        ON rp_commands(user_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_rp_commands_idempo
        ON rp_commands(user_id, idempotency_key)
        WHERE idempotency_key IS NOT NULL;

      CREATE TABLE IF NOT EXISTS rp_command_photos (
        command_id UUID NOT NULL REFERENCES rp_commands(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        mime TEXT,
        data BYTEA NOT NULL,
        PRIMARY KEY (command_id, idx)
      );

      DO $$ BEGIN
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS last_extension_poll_at TIMESTAMPTZ;
        ALTER TABLE rp_commands ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ;
        -- Email verification
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS email_verify_code TEXT;
        ALTER TABLE rp_users ADD COLUMN IF NOT EXISTS email_verify_expires TIMESTAMPTZ;
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

      -- Listing snapshots for retry persistence (last 5 per user)
      CREATE TABLE IF NOT EXISTS rp_listing_snapshots (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        chat_id TEXT NOT NULL,
        user_id UUID REFERENCES rp_users(id) ON DELETE CASCADE,
        command_id UUID REFERENCES rp_commands(id) ON DELETE SET NULL,
        listing JSONB NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_rp_listing_snap_chat ON rp_listing_snapshots(chat_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS rp_listing_snapshot_photos (
        snapshot_id UUID NOT NULL REFERENCES rp_listing_snapshots(id) ON DELETE CASCADE,
        idx INTEGER NOT NULL,
        data BYTEA NOT NULL,
        mime TEXT DEFAULT 'image/jpeg',
        PRIMARY KEY (snapshot_id, idx)
      );
    `);

    // Prune stale commands (>48h). Fire-and-forget; cascades to staged photos.
    try {
      await query(`DELETE FROM rp_commands WHERE created_at < NOW() - interval '48 hours'`);
    } catch (e) { /* ignore */ }
    console.log('[DB] Schema ready');
  } catch (e) {
    console.error('[DB] Schema init error:', e.message);
  }
}

module.exports = { query, initSchema, hasDb: () => !!pool };
