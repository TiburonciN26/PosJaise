begin;
create index idx_f7_f on public.pedidos_web (cliente_id, creado_en desc, id desc);
commit;
