import type { Consultant } from '../shared/types'
import { sql, type Database } from './db'

export function findConsultants({query}: Database, need: string) {
  return query<Omit<Consultant,'recommendation_reason'>&{matches:string[]}>(sql`
    WITH eligible AS (
      SELECT id,name,approach,qualifications,price,test_only,specialties,service_modes,availability,
        ARRAY(SELECT DISTINCT topic FROM unnest(specialties) AS t(topic)
          WHERE btrim(topic)<>'' AND ${need}<>'' AND (
            strpos(lower(${need}),lower(btrim(topic)))>0 OR
            (length(${need})>=2 AND strpos(lower(topic),lower(${need}))>0)
          ) ORDER BY topic) AS matches
      FROM consultants
      WHERE active AND verified_at IS NOT NULL AND NOT test_only
    )
    SELECT * FROM eligible WHERE ${need}='' OR cardinality(matches)>0
    ORDER BY cardinality(matches) DESC,name,id LIMIT 3
  `)
}
