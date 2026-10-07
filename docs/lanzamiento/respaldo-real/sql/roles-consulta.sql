-- ALTERNATIVA de solo lectura a pg_dumpall --roles-only (sin contrasenas): atributos, pertenencias y ajustes por rol.
select 'ROL|' || r.rolname || '|super=' || r.rolsuper::text || '|inherit=' || r.rolinherit::text || '|createrole=' || r.rolcreaterole::text
  || '|createdb=' || r.rolcreatedb::text || '|login=' || r.rolcanlogin::text || '|replication=' || r.rolreplication::text
  || '|bypassrls=' || r.rolbypassrls::text || '|connlimit=' || r.rolconnlimit::text || '|config=' || coalesce(r.rolconfig::text, '')
from pg_roles r where r.rolname !~ '^pg_' order by r.rolname;
select 'PERTENENCIA|' || g.rolname || '|' || r.rolname || '|admin=' || m.admin_option::text || '|inherit=' || m.inherit_option::text || '|set=' || m.set_option::text
from pg_auth_members m join pg_roles r on r.oid = m.member join pg_roles g on g.oid = m.roleid where r.rolname !~ '^pg_' order by 1;
