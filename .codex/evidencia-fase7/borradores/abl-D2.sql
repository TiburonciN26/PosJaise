begin;
create index idx_f7_d2 on public.cupones (estado, creado_en desc, id desc);
commit;
