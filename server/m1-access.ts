import assert from 'node:assert/strict'
import { Pool, escapeIdentifier, escapeLiteral } from 'pg'
import type { PoolClient } from 'pg'
import { assertRuntimeRole } from './database-access'
import { verifyMigrations } from './migrations'

// shortcut: isolated read-only preview; complete native writers and entry-point checks before cutover.
export async function configureM1ReadAccess(migrationUrl: string, readUrl: string) {
  const migration = new URL(migrationUrl), reader = new URL(readUrl)
  const role = decodeURIComponent(reader.username), password = decodeURIComponent(reader.password)
  assert(migration.host === reader.host && migration.pathname === reader.pathname && migration.username !== reader.username, 'Use separate identities in the same isolated database')
  assert(/^[a-z][a-z0-9_]{0,49}$/.test(role) && password.length >= 24, 'Use a dedicated M1 reader role')
  const scopeOwner = role + '_scope', ident = escapeIdentifier(role), owner = escapeIdentifier(scopeOwner)
  const pool = new Pool({ connectionString: migrationUrl }), client = await pool.connect()
  let broken = false
  const lost = () => { broken = true }
  client.on('error', lost)
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.m1.read_access',0))")
    await verifyMigrations(client, 'm1')
    for (const [name, helper] of [[role, false], [scopeOwner, true]] as const) {
      const existing = (await client.query(`SELECT r.*, EXISTS(SELECT 1 FROM pg_auth_members WHERE member=r.oid OR roleid=r.oid) AS memberships FROM pg_roles r WHERE rolname=$1`, [name])).rows[0]
      if (!existing) await client.query(`CREATE ROLE ${escapeIdentifier(name)} ${helper ? 'NOLOGIN NOINHERIT BYPASSRLS' : 'LOGIN NOINHERIT NOBYPASSRLS'}`)
      else assert(!existing.rolsuper && !existing.rolcreatedb && !existing.rolcreaterole && !existing.rolreplication && !existing.memberships && existing.rolbypassrls === helper && existing.rolcanlogin !== helper, 'Refusing to repurpose an elevated or inherited role')
    }
    await client.query(`ALTER ROLE ${ident} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`)
    const db = escapeIdentifier((await client.query('SELECT current_database() AS name')).rows[0].name)
    await client.query(`REVOKE CREATE,TEMPORARY ON DATABASE ${db} FROM PUBLIC;
      REVOKE CREATE ON SCHEMA public FROM PUBLIC;
      REVOKE ALL ON DATABASE ${db} FROM ${ident}; GRANT CONNECT ON DATABASE ${db} TO ${ident};
      CREATE SCHEMA IF NOT EXISTS m1_read; REVOKE ALL ON SCHEMA m1_read FROM PUBLIC;
      REVOKE ALL ON ALL TABLES IN SCHEMA public,pgboss,m1_read FROM ${ident};
      REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,pgboss,m1_read FROM ${ident};
      GRANT USAGE ON SCHEMA public,m1_read TO ${ident},${owner};
      GRANT SELECT ON public.conversations,public.events,public.members,public.profiles,public.messages,public.understandings,public.record_versions,public.record_sources TO ${owner}`)
    await client.query(`CREATE OR REPLACE FUNCTION m1_read.can_read_conversation(wanted uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $scope$
        SELECT EXISTS(SELECT 1 FROM public.conversations c JOIN public.events e ON e.id=c.event_id
          WHERE c.id=wanted AND c.id::text=NULLIF(current_setting('reso.conversation_id',true),'')
          AND c.status <> 'erasure_pending' AND e.erasure_requested_at IS NULL AND e.lifecycle_status NOT IN ('erasure_pending','erased')
          AND EXISTS(SELECT 1 FROM public.profiles p WHERE p.user_id=NULLIF(current_setting('reso.actor_id',true),'') AND p.account_state='active')
          AND ((c.kind IN ('private','intake') AND c.owner_user_id=NULLIF(current_setting('reso.actor_id',true),''))
            OR (c.kind='room' AND (e.owner_id=NULLIF(current_setting('reso.actor_id',true),'') OR EXISTS(
              SELECT 1 FROM public.members m WHERE m.event_id=e.id AND m.user_id=NULLIF(current_setting('reso.actor_id',true),'') AND m.active)))))
      $scope$;
      ALTER FUNCTION m1_read.can_read_conversation(uuid) OWNER TO ${owner};
      CREATE OR REPLACE FUNCTION m1_read.can_read_message(wanted uuid,message_id bigint) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $scope$
        SELECT m1_read.can_read_conversation(wanted) AND EXISTS(
          SELECT 1 FROM public.messages msg JOIN public.conversations c ON c.id=msg.conversation_id JOIN public.events e ON e.id=c.event_id
          WHERE msg.id=message_id AND msg.conversation_id=wanted AND msg.event_id=c.event_id AND msg.redacted_at IS NULL
          AND ((c.kind='private' AND msg.domain='private') OR (c.kind='intake' AND msg.domain IS NULL) OR
            (c.kind='room' AND msg.domain='room' AND (e.owner_id=NULLIF(current_setting('reso.actor_id',true),'') OR EXISTS(
              SELECT 1 FROM public.members m WHERE m.event_id=e.id AND m.user_id=NULLIF(current_setting('reso.actor_id',true),'') AND m.active
              AND (m.history_mode='legacy_full_history' OR (m.history_mode IN ('since_join','approved_history') AND m.history_from_message_id IS NOT NULL AND msg.id>=m.history_from_message_id))))))
          AND msg.message_purpose <> 'private_hint')
      $scope$;
      ALTER FUNCTION m1_read.can_read_message(uuid,bigint) OWNER TO ${owner};
      CREATE OR REPLACE FUNCTION m1_read.can_read_version(wanted uuid) RETURNS boolean
      LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $scope$
        SELECT EXISTS(SELECT 1 FROM public.record_versions r JOIN public.understandings u ON u.id=r.understanding_id AND u.conversation_id=r.conversation_id
          WHERE r.id=wanted AND r.record_origin='legacy_import' AND u.record_state='active' AND m1_read.can_read_conversation(r.conversation_id)
          AND EXISTS(SELECT 1 FROM public.record_sources s WHERE s.target_record_version_id=r.id)
          AND NOT EXISTS(SELECT 1 FROM public.record_sources s WHERE s.target_record_version_id=r.id AND
            (s.source_access_basis<>'same_conversation' OR s.source_conversation_id IS DISTINCT FROM r.conversation_id OR s.source_message_id IS NULL OR NOT m1_read.can_read_message(s.source_conversation_id,s.source_message_id))))
      $scope$;
      ALTER FUNCTION m1_read.can_read_version(uuid) OWNER TO ${owner};
      CREATE OR REPLACE VIEW m1_read.messages WITH (security_barrier=true) AS
        SELECT id,event_id,conversation_id,domain,author_id,author_name,role,content,created_at,in_reply_to,card_type,content_kind,hypothetical,message_purpose
        FROM public.messages WHERE m1_read.can_read_message(conversation_id,id);
      ALTER VIEW m1_read.messages OWNER TO ${owner};
      REVOKE ALL ON ALL FUNCTIONS IN SCHEMA m1_read FROM PUBLIC;
      GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA m1_read TO ${ident};
      GRANT SELECT ON m1_read.messages,public.conversations,public.record_versions,public.record_sources TO ${ident};
      DROP POLICY IF EXISTS m1_preview_conversations ON public.conversations;
      CREATE POLICY m1_preview_conversations ON public.conversations FOR SELECT TO ${ident} USING(m1_read.can_read_conversation(id));
      DROP POLICY IF EXISTS m1_preview_versions ON public.record_versions;
      CREATE POLICY m1_preview_versions ON public.record_versions FOR SELECT TO ${ident} USING(m1_read.can_read_version(id));
      DROP POLICY IF EXISTS m1_preview_sources ON public.record_sources;
      CREATE POLICY m1_preview_sources ON public.record_sources FOR SELECT TO ${ident} USING(
        source_access_basis='same_conversation' AND source_conversation_id=target_conversation_id AND source_message_id IS NOT NULL
        AND m1_read.can_read_version(target_record_version_id) AND m1_read.can_read_message(source_conversation_id,source_message_id));`)
    await client.query('COMMIT')
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { broken = true }
    throw error
  } finally { client.release(broken); client.off('error', lost); await pool.end() }
  const readerPool = new Pool({ connectionString: readUrl })
  try { await assertRuntimeRole(readerPool) } finally { await readerPool.end() }
}

export async function withM1ReadScope<T>(pool: Pool, actorId: string, conversationId: string, read: (client: PoolClient) => Promise<T>) {
  assert(typeof actorId === 'string' && actorId.length > 0 && actorId.length <= 200 && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(conversationId), 'A trusted actor and exact conversation are required')
  const client = await pool.connect(); let broken = false
  const lost = () => { broken = true }
  client.on('error', lost)
  const clear = () => client.query("SELECT set_config('reso.actor_id','',false),set_config('reso.conversation_id','',false)")
  try {
    await clear()
    await client.query('BEGIN READ ONLY')
    await client.query("SELECT set_config('reso.actor_id',$1,true),set_config('reso.conversation_id',$2,true)", [actorId, conversationId])
    const result = await read(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { broken = true }
    throw error
  } finally {
    if (!broken) try { await clear() } catch { broken = true }
    client.release(broken)
    client.off('error', lost)
  }
}
