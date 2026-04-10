const { Pool } = require('pg');

let pool = null;
if (process.env.DATABASE_URL) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000
  });
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
      EXCEPTION WHEN OTHERS THEN NULL;
      END $$;

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
      -- One row per backup snapshot — never overwritten, pruned to keep last 5 per item.
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
    `);
    console.log('[DB] Schema ready');
  } catch (e) {
    console.error('[DB] Schema init error:', e.message);
  }
}

module.exports = { query, initSchema, hasDb: () => !!pool };
