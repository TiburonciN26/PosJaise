begin;
create index idx_f7_d on public.cupones (origen, estado, creado_en desc, id desc);
commit;
