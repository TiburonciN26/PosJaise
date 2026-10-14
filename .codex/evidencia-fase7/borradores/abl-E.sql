begin;
create index idx_f7_e1 on public.productos (categoria, nombre, id) where activo; create index idx_f7_e2 on public.servicios (categoria, nombre, id) where activo;
commit;
