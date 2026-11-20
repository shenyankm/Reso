import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { z } from 'zod'
import { createDatabase, sql } from '../server/db'

const [email, mode, filename, ...extra]=process.argv.slice(2)
if(!email||!process.env.MIGRATION_DATABASE_URL||extra.length||(mode!==undefined&&(mode!=='--verified-profile'||!filename))) {
  throw new Error('Usage: npm run counselor -- registered-email [--verified-profile profile.json] (requires MIGRATION_DATABASE_URL)')
}
const profile=filename?z.object({
  name:z.string().trim().min(1).max(80),
  approach:z.string().trim().min(1).max(300),
  qualifications:z.string().trim().min(1).max(500),
  specialties:z.array(z.string().trim().min(1).max(80)).min(1).max(12),
  serviceModes:z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  availability:z.string().trim().max(200),
  price:z.string().trim().min(1).max(120),
}).strict().parse(JSON.parse(await readFile(filename,'utf8'))):null
const database=createDatabase(process.env.MIGRATION_DATABASE_URL)
try{
  const [user]=await database.query<{id:string;name:string}>(sql`SELECT id,name FROM "user" WHERE email=${email}`)
  if(!user)throw new Error('Register the account in the UI first.')
  await database.db.transaction(async tx=>{
    await database.query(sql`INSERT INTO profiles(user_id,role) VALUES(${user.id},'counselor') ON CONFLICT(user_id) DO UPDATE SET role='counselor'`,tx)
    if(profile){
      const specialties=sql.join(profile.specialties.map(value=>sql`${value}`),sql`,`)
      const modes=sql.join(profile.serviceModes.map(value=>sql`${value}`),sql`,`)
      await database.query(sql`
        INSERT INTO consultants(id,user_id,name,approach,qualifications,price,specialties,service_modes,availability,test_only,verified_at)
        VALUES(${randomUUID()},${user.id},${profile.name},${profile.approach},${profile.qualifications},${profile.price},
          ARRAY[${specialties}]::text[],ARRAY[${modes}]::text[],${profile.availability},false,now())
        ON CONFLICT(user_id) DO UPDATE SET name=excluded.name,approach=excluded.approach,qualifications=excluded.qualifications,
          price=excluded.price,specialties=excluded.specialties,service_modes=excluded.service_modes,availability=excluded.availability,
          active=true,test_only=false,verified_at=excluded.verified_at
      `,tx)
    }else{
      const rows=await database.query(sql`
        INSERT INTO consultants(id,user_id,name,approach,qualifications,price,test_only)
        VALUES(${randomUUID()},${user.id},${user.name},'本地服务流程测试','测试账号，未核验专业资质','本地测试，不代表真实收费',true)
        ON CONFLICT(user_id) DO UPDATE SET active=true WHERE consultants.test_only RETURNING id
      `,tx)
      if(!rows.length)throw new Error('Use --verified-profile to update an existing verified consultant.')
    }
  })
  console.log(profile?'Verified consultant profile published to the selected database.':'Local test counselor enabled. Sign in again to open the professional workspace.')
}finally{await database.pool.end()}
