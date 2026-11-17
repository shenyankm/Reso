import { Pool, escapeIdentifier, escapeLiteral } from 'pg'

export async function assertRuntimeRole(pool: Pool) {
  const {rows}=await pool.query(`SELECT rolsuper OR rolcreatedb OR rolcreaterole OR rolbypassrls AS elevated,
    has_database_privilege(current_user,current_database(),'CREATE') OR has_database_privilege(current_user,current_database(),'TEMPORARY') OR has_schema_privilege(current_user,'public','CREATE') OR has_schema_privilege(current_user,'pgboss','CREATE') AS can_create,
    EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS has_memberships,
    EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','pgboss') AND c.relowner=(SELECT oid FROM pg_roles WHERE rolname=current_user)) AS owns_objects
    FROM pg_roles WHERE rolname=current_user`)
  if (!rows.length||rows[0].elevated||rows[0].can_create||rows[0].owns_objects||rows[0].has_memberships) throw new Error('API/Worker require a restricted runtime database role; run npm run db:migrate')
}

export async function configureRuntimeAccess(migrationUrl: string, runtimeUrl: string) {
  const migration=new URL(migrationUrl),runtime=new URL(runtimeUrl)
  if (migration.host!==runtime.host||migration.pathname!==runtime.pathname||migration.username===runtime.username) throw new Error('Migration and runtime must use separate users in the same database')
  const role=decodeURIComponent(runtime.username),password=decodeURIComponent(runtime.password)
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(role)||password.length<24) throw new Error('Use a dedicated runtime role and a random password of at least 24 characters')
  const pool=new Pool({connectionString:migrationUrl})
  const client=await pool.connect()
  const identifier=escapeIdentifier(role)
  try {
    await client.query('BEGIN')
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('reso.runtime_role',0))")
    const memberships=await client.query('SELECT 1 FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.member WHERE r.rolname=$1',[role])
    if (memberships.rowCount) throw new Error('Runtime role must not inherit or switch to other roles')
    const exists=await client.query('SELECT 1 FROM pg_roles WHERE rolname=$1',[role])
    if (!exists.rowCount) await client.query(`CREATE ROLE ${identifier}`)
    await client.query(`ALTER ROLE ${identifier} LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS PASSWORD ${escapeLiteral(password)}`)
    const database=(await client.query('SELECT current_database() AS name')).rows[0].name
    await client.query(`REVOKE ALL ON DATABASE ${escapeIdentifier(database)} FROM ${identifier}; REVOKE CREATE,TEMPORARY ON DATABASE ${escapeIdentifier(database)} FROM PUBLIC; GRANT CONNECT ON DATABASE ${escapeIdentifier(database)} TO ${identifier}`)
    await client.query(`REVOKE CREATE ON SCHEMA public FROM PUBLIC; REVOKE ALL ON SCHEMA public,pgboss FROM ${identifier}; GRANT USAGE ON SCHEMA public,pgboss TO ${identifier}`)
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA public,pgboss FROM ${identifier}; REVOKE ALL ON ALL SEQUENCES IN SCHEMA public,pgboss FROM ${identifier}`)
    await client.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON public."user",public.session,public.account,public.verification,public.events TO ${identifier}`)
    await client.query(`GRANT SELECT,INSERT,UPDATE ON public.messages,public.questionnaires,public.exercises,public.members,public.invites,public.share_grants,public.perspectives,public.applications,public.agent_runs,public.agent_actions,public.consultation_notes,public.note_shares,public.understandings,public.understanding_confirmations,public.followups TO ${identifier}`)
    await client.query(`GRANT SELECT,INSERT ON public.profiles,public.consent_records,public.share_snapshots,public.revisions TO ${identifier}; GRANT SELECT ON public.consultants,public.schema_migrations TO ${identifier}`)
    // PostgreSQL requires UPDATE privilege on one column for SELECT ... FOR SHARE.
    await client.query(`GRANT UPDATE(name) ON public.consultants TO ${identifier}`)
    await client.query(`GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public,pgboss TO ${identifier}; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA pgboss TO ${identifier}`)
    await client.query(`REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA pgboss FROM PUBLIC,${identifier}`)
    // Queue clock helpers are safe; DDL helpers such as create_queue remain migration-only.
    await client.query(`GRANT EXECUTE ON FUNCTION pgboss.job_now() TO ${identifier}`)
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally {
    client.release()
    await pool.end()
  }
  const runtimePool=new Pool({connectionString:runtimeUrl})
  try { await assertRuntimeRole(runtimePool) } finally { await runtimePool.end() }
}
