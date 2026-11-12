-- ลายนิ้วมือของ schema ที่ไม่ขึ้นกับลำดับคอลัมน์ — ใช้เทียบฐานที่ Prisma สร้างกับฐานที่ EF สร้าง
\pset format unaligned
\pset tuples_only on
select 'enum|' || t.typname || '|' || string_agg(e.enumlabel, ',' order by e.enumsortorder)
from pg_type t join pg_enum e on e.enumtypid = t.oid
group by t.typname
order by 1;

select 'column|' || c.relname || '.' || a.attname || '|' || format_type(a.atttypid, a.atttypmod)
  || '|' || case when a.attnotnull then 'not null' else 'null' end
  || '|' || coalesce(pg_get_expr(d.adbin, d.adrelid), '')
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
where n.nspname = 'public' and c.relkind = 'r' and a.attnum > 0 and not a.attisdropped
  and c.relname not in ('_prisma_migrations', '__EFMigrationsHistory')
order by 1;

select 'constraint|' || c.relname || '|' || con.conname || '|' || pg_get_constraintdef(con.oid)
from pg_constraint con
join pg_class c on c.oid = con.conrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relname not in ('_prisma_migrations', '__EFMigrationsHistory')
order by 1;

select 'index|' || tablename || '|' || indexname || '|' || indexdef
from pg_indexes
where schemaname = 'public' and tablename not in ('_prisma_migrations', '__EFMigrationsHistory')
order by 1;
