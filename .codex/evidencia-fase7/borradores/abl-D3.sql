begin;
create index idx_f7_d3 on public.cupones (origen, creado_en desc, id desc);
commit;
