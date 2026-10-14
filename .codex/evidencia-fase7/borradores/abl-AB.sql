begin;
create index idx_f7_a on public.pedidos_web (creado_en desc, id desc);
create index idx_f7_b on public.pedidos_web (estado, creado_en desc, id desc);
commit;
