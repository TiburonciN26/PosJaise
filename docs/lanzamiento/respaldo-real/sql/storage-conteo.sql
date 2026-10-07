-- Conteo y tamano por bucket segun la base (SOLO LECTURA). Cada fila: bucket|objetos|bytes
select b.id || '|' || count(o.id)::text || '|' || coalesce(sum((o.metadata->>'size')::bigint), 0)::text
from storage.buckets b left join storage.objects o on o.bucket_id = b.id
group by b.id order by b.id;
