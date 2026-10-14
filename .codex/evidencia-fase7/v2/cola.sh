#!/bin/bash
cd /c/WedJaiseReact
node scripts/medir-fase7.cjs --escala=actual --reps=5 --solo=Q01,Q02,Q03,Q04 --migracion=supabase/migrations/20261012000001_rls_helpers_una_vez_por_consulta.sql,supabase/migrations/20261012000002_indices_listas_medidos.sql --salida=.codex/evidencia-fase7/v2/q03-final-actual.json > .codex/evidencia-fase7/v2/q03-final-actual.txt 2>&1
node scripts/medir-fase7.cjs --escala=ampliada --reps=3 --solo=Q01,Q02,Q03,Q04 --migracion=supabase/migrations/20261012000001_rls_helpers_una_vez_por_consulta.sql,supabase/migrations/20261012000002_indices_listas_medidos.sql --salida=.codex/evidencia-fase7/v2/q03-final-ampliada.json > .codex/evidencia-fase7/v2/q03-final-ampliada.txt 2>&1
for n in A B AB; do
  node scripts/medir-fase7.cjs --escala=ampliada --reps=3 --solo=Q01,Q02,Q03,Q04 --migracion=supabase/migrations/20261012000001_rls_helpers_una_vez_por_consulta.sql,.codex/evidencia-fase7/borradores/abl-$n.sql --salida=.codex/evidencia-fase7/v2/q03-abl-$n.json > .codex/evidencia-fase7/v2/q03-abl-$n.txt 2>&1
done
echo FIN > .codex/evidencia-fase7/v2/cola.fin
