import { randomUUID } from 'node:crypto'
import { createDatabase, sql } from '../server/db'

const email=process.argv[2]
if(!email||!process.env.MIGRATION_DATABASE_URL)throw new Error('Usage: npm run counselor -- registered-test-account@example.com (requires MIGRATION_DATABASE_URL)')
const database=createDatabase(process.env.MIGRATION_DATABASE_URL)
try{
  const [user]=await database.query<{id:string;name:string}>(sql`SELECT id,name FROM "user" WHERE email=${email}`)
  if(!user)throw new Error('Register the local test account in the UI first.')
  await database.db.transaction(async tx=>{
    await database.query(sql`INSERT INTO profiles(user_id,role) VALUES(${user.id},'counselor') ON CONFLICT(user_id) DO UPDATE SET role='counselor'`,tx)
    await database.query(sql`INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only) VALUES(${randomUUID()},${user.id},${user.name},'本地服务流程测试','测试账号，未核验专业资质','本地测试，不代表真实收费',true) ON CONFLICT(user_id) DO UPDATE SET active=true`,tx)
  })
  console.log('Local test counselor enabled. Sign in again to open the professional workspace.')
}finally{await database.pool.end()}
