#!/bin/bash
# Ablaciones: política nueva + UN índice candidato; se mide solo con las consultas a las que apunta. Secuencial (nunca en paralelo).
cd /c/WedJaiseReact
D=.codex/evidencia-fase7/borradores
P=supabase/migrations/20261012000001_rls_helpers_una_vez_por_consulta.sql
for v in A:Q01,Q02,Q03,Q04 B:Q01,Q02,Q03,Q04 C:Q05,Q27 D:Q12,Q13,Q14,Q15 D2:Q12,Q13,Q14,Q15 D3:Q12,Q13,Q14,Q15 F:Q01,Q26,Q27,Q29 E:Q17,Q18,Q22,Q23,Q24,Q25; do
  n=${v%%:*}; q=${v#*:}
  echo "=== variante $n"
  node scripts/medir-fase7.cjs --escala=ampliada --reps=3 --solo=$q --migracion=$P,$D/abl-$n.sql --salida=$D/abl-$n.json 2>&1 | grep -v "^WARNING\|^escala" | sed -E 's/ +/ /g; s/seq\[/s[/g' | cut -c1-200
done
echo FIN
