const j = require('./.codex/evidencia-fase5/' + process.argv[2] + '.json')
for (const id of process.argv.slice(3)) {
  const r = j.resultados[id]
  console.log('==', id, JSON.stringify(r.mediana))
  for (const d of r.detalle) console.log(' ', d.m, d.ruta, (d.sel ?? '').slice(0, 60), d.q.slice(0, 110), d.estado, d.bytes)
  console.log('  ws', JSON.stringify(r.canalesPorTema))
}
