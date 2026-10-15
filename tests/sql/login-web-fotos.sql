-- Solo para el contenedor desechable de scripts/probar-login-web-sql.cjs.
-- No ejecutar este fixture en una base del negocio.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select * from public.guardar_login_web_fotos('[
 {"id":"10000000-0000-0000-0000-000000000001","titulo":"Activa","foto_url":"r2:fotos-galeria/20000000-0000-0000-0000-000000000001","orden":0,"activo":true},
 {"id":"10000000-0000-0000-0000-000000000002","titulo":"Oculta","foto_url":"r2:fotos-galeria/20000000-0000-0000-0000-000000000002","orden":1,"activo":false}
]', '[]');
reset role;
set role anon;
do $$ begin
 if (select count(*) from public.login_web_fotos) <> 1 then raise exception 'Anon ve fotos ocultas'; end if;
 begin perform public.guardar_login_web_fotos('[]','[]'); raise exception 'Anon pudo publicar'; exception when insufficient_privilege then null; end;
 begin delete from public.login_web_fotos; raise exception 'Anon pudo borrar'; exception when insufficient_privilege then null; end;
 begin update public.login_web_fotos set titulo='ajeno'; raise exception 'Anon pudo actualizar'; exception when insufficient_privilege then null; end;
 begin insert into public.login_web_fotos values(gen_random_uuid(),'ajena','r2:fotos-galeria/20000000-0000-0000-0000-000000000003',2,true); raise exception 'Anon pudo insertar'; exception when insufficient_privilege then null; end;
end $$;
reset role;
set role authenticated;
do $$ declare uid text; n integer; begin
 foreach uid in array array[
   '00000000-0000-0000-0000-000000000002', -- Cajera
   '00000000-0000-0000-0000-000000000003', -- Asistente
   '00000000-0000-0000-0000-000000000004', -- Admin desactivado
   '00000000-0000-0000-0000-000000000099'  -- Cliente sin fila de personal
 ] loop
   perform set_config('request.jwt.claim.sub',uid,false);
   if (select count(*) from public.login_web_fotos) <> 1 then raise exception 'Otro rol ve fotos ocultas'; end if;
   begin perform public.guardar_login_web_fotos('[]','[]'); raise exception 'Otro rol pudo publicar'; exception when insufficient_privilege then null; end;
   begin insert into public.login_web_fotos values(gen_random_uuid(),'ajena','r2:fotos-galeria/20000000-0000-0000-0000-000000000003',2,true); raise exception 'Otro rol pudo insertar'; exception when insufficient_privilege then null; end;
   update public.login_web_fotos set titulo='ajeno'; get diagnostics n = row_count;
   if n <> 0 then raise exception 'Otro rol pudo actualizar'; end if;
   delete from public.login_web_fotos; get diagnostics n = row_count;
   if n <> 0 then raise exception 'Otro rol pudo borrar'; end if;
 end loop;
end $$;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
do $$ declare base jsonb; nuevas jsonb; begin
 if (select count(*) from public.login_web_fotos) <> 2 then raise exception 'Admin no ve ocultas'; end if;
 select jsonb_agg(to_jsonb(f) order by orden,id) into base from public.login_web_fotos f;
 -- Una versión antigua debe rechazarse sin afectar la publicación vigente.
 begin perform public.guardar_login_web_fotos('[]','[]'); raise exception 'Aceptó versión antigua' using errcode='XX000'; exception when raise_exception then null; end;
 if (select count(*) from public.login_web_fotos) <> 2 then raise exception 'Conflicto borró datos'; end if;
 -- Si falla una restricción después del DELETE, la transacción revierte todo.
 nuevas := jsonb_set(base,'{0,foto_url}','"https://externo.test/imagen"');
 begin perform public.guardar_login_web_fotos(nuevas,base); raise exception 'Aceptó URL externa' using errcode='XX000'; exception when check_violation then null; end;
 nuevas := jsonb_set(base,'{1,orden}','0');
 begin perform public.guardar_login_web_fotos(nuevas,base); raise exception 'Aceptó orden duplicado' using errcode='XX000'; exception when unique_violation then null; end;
 nuevas := jsonb_set(base,'{1,id}',base->0->'id');
 begin perform public.guardar_login_web_fotos(nuevas,base); raise exception 'Aceptó ID duplicado' using errcode='XX000'; exception when unique_violation then null; end;
 if (select jsonb_agg(to_jsonb(f) order by orden,id) from public.login_web_fotos f) <> base then raise exception 'Fallo de atomicidad'; end if;
 nuevas := jsonb_build_array(base->0,base->0,base->0,base->0,base->0,base->0,base->0,base->0,base->0);
 begin perform public.guardar_login_web_fotos(nuevas,base); raise exception 'Aceptó más de ocho' using errcode='XX000'; exception when raise_exception then null; end;
 nuevas := jsonb_set(base,'{0,titulo}','"Campaña nueva"');
 perform public.guardar_login_web_fotos(nuevas,base);
 if (select titulo from public.login_web_fotos where orden=0) <> 'Campaña nueva' then raise exception 'No guardó campaña'; end if;
 perform public.guardar_login_web_fotos('[]',nuevas);
 if (select count(*) from public.login_web_fotos) <> 0 then raise exception 'No permite restablecer respaldo'; end if;
end $$;
reset role;
