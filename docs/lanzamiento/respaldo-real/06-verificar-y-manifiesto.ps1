# PASO 6 - Verificacion final y manifiesto local. No se conecta a produccion.
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida
Write-Host ''
Write-Host 'PASO 6 - Verificacion y manifiesto' -ForegroundColor Cyan
foreach ($p in 'paso1', 'paso2', 'paso3', 'paso4', 'paso5') { Exigir-Paso $p }
$e = $global:Estado

# Releer y recalcular los SHA-256 de lo respaldado y compararlos con los registrados
$dump = Join-Path $global:Dir $e.paso2.archivo
$roles = Join-Path $global:Dir $e.paso3.archivo
foreach ($par in @(@($dump, $e.paso2.sha256, 'dump'), @($roles, $e.paso3.sha256, 'roles'),
        @((Join-Path $global:Dir $e.paso5.definiciones), $e.paso5.definiciones_sha256, 'definiciones'),
        @((Join-Path $global:Dir $e.paso5.huella), $e.paso5.huella_sha256, 'huella'))) {
    if (-not (Test-Path $par[0])) { Detener "Falta el archivo de $($par[2])." }
    if ((Hash-Archivo $par[0]) -ne $par[1]) { Detener "El SHA-256 de $($par[2]) cambio desde que se creo." }
}
Ok 'SHA-256 del dump, roles, definiciones y huella: iguales a los registrados'

# Storage: archivos en disco = indice = lo registrado
$indice = Import-Csv (Join-Path $global:Dir $e.paso4.indice)
if ($indice.Count -ne $e.paso4.objetos) { Detener 'El indice de Storage no tiene el numero de objetos registrado.' }
foreach ($fila in $indice) {
    $f = Join-Path $global:Dir $fila.archivo_local
    if (-not (Test-Path $f)) { Detener "Falta un archivo de Storage del indice (bucket $($fila.bucket))." }
    if ((Hash-Archivo $f) -ne $fila.sha256) { Detener "Un archivo de Storage cambio (bucket $($fila.bucket))." }
}
Ok "Storage: $($indice.Count) archivos releidos; SHA-256 iguales al indice"

# Manifiesto local (con nombres de archivo: queda en la carpeta privada)
$archivos = Get-ChildItem -Path $global:Dir -Recurse -File | Where-Object { $_.Name -notin @('manifiesto.json', 'manifiesto.md', 'metadatos-para-compartir.txt') }
$lista = @($archivos | ForEach-Object { [pscustomobject]@{ archivo = $_.FullName.Substring($global:Dir.Length + 1); bytes = $_.Length; sha256 = (Hash-Archivo $_.FullName) } })
$fin = (Get-Date).ToUniversalTime().ToString('o')
$manifiesto = [pscustomobject]@{ corrida = (Split-Path $global:Dir -Leaf); inicio_utc = $e.inicio_utc; fin_utc = $fin; estado = $e; archivos = $lista }
$manifiesto | ConvertTo-Json -Depth 10 | Set-Content -Path (Join-Path $global:Dir 'manifiesto.json') -Encoding UTF8
$md = @("# Manifiesto del respaldo real", "", "Corrida: $(Split-Path $global:Dir -Leaf)", "Inicio UTC: $($e.inicio_utc)  -  Fin UTC: $fin", "", "| Archivo | Bytes | SHA-256 |", "|---|---|---|")
foreach ($a in $lista) { if ($a.archivo -notlike 'storage_*\*') { $md += "| $($a.archivo) | $($a.bytes) | $($a.sha256) |" } }
$md += @("", "Archivos de Storage: $($indice.Count) (ver $($e.paso4.indice))", "", "Respaldo privado: no borrar sin autorizacion del propietario.")
Set-Content -Path (Join-Path $global:Dir 'manifiesto.md') -Value $md -Encoding UTF8

# Metadatos aptos para compartir: SIN host, usuario, rutas de objetos, nombres de personas ni valores de filas
$p1 = $e.paso1.preflight
$m = @()
$m += "METADATOS DEL RESPALDO REAL (aptos para compartir)"
$m += "Inicio UTC: $($e.inicio_utc)   Fin UTC: $fin"
$m += "Servidor: PostgreSQL $($e.paso1.version_servidor)   Herramientas: 17.6"
$m += "Pre-vuelo: conexion OK; tablas no legibles=$($p1.tablas_no_legibles); secuencias no legibles=$($p1.secuencias_no_legibles); esquemas sin uso=$($p1.esquemas_sin_uso); pg_dump --schema-only codigo 0 ($($e.paso1.tablas_en_preflight) tablas)"
$m += "Estado de produccion: migraciones=$($p1.migraciones_registradas); ventas=$($p1.ventas_total) (ultimo codigo $($p1.ventas_ultimo_codigo)); usuarios Auth=$($p1.usuarios_auth_total); locale=$($p1.locale)"
$m += "BASE: codigo pg_dump=$($e.paso2.codigo_pg_dump); bytes=$($e.paso2.bytes); SHA-256=$($e.paso2.sha256)"
$m += "      pg_restore --list codigo 0: entradas=$($e.paso2.entradas_toc); ACL=$($e.paso2.entradas_acl); tablas con datos=$($e.paso2.tablas_con_datos); OWNER TO=$($e.paso2.owner_to); GRANT/REVOKE=$($e.paso2.grant_revoke)"
$m += "      $($e.paso2.cabecera)"
$m += "ROLES: metodo=$($e.paso3.metodo); codigo=$($e.paso3.codigo); bytes=$($e.paso3.bytes); SHA-256=$($e.paso3.sha256); roles=$($e.paso3.create_role); pertenencias=$($e.paso3.pertenencias); contrasenas=no"
$m += "STORAGE: objetos=$($e.paso4.objetos); bytes=$($e.paso4.bytes); coincide con la base=si; SHA-256 de cada archivo verificado=si"
foreach ($b in $e.paso4.buckets) { $m += "      bucket $($b.bucket): $($b.objetos) objetos, $($b.bytes) bytes" }
$m += "DEFINICIONES PREVIAS: funciones=$($e.paso5.funciones); politicas=$($e.paso5.politicas); check=$($e.paso5.check); SHA-256=$($e.paso5.definiciones_sha256)"
$m += "HUELLA PREVIA (tabla = filas:md5): SHA-256 del archivo=$($e.paso5.huella_sha256)"
foreach ($k in ($e.paso5.huella_valores.PSObject.Properties | Sort-Object Name)) { $m += "      $($k.Name) = $($k.Value)" }
$m += "ARCHIVOS TOTALES en la corrida: $($lista.Count); releidos y verificados: si"
$m += "RESULTADO: todas las verificaciones OK. No se escribio nada en produccion."
Set-Content -Path (Join-Path $global:Dir 'metadatos-para-compartir.txt') -Value $m -Encoding UTF8

# Proteccion contra borrado accidental (solo lectura); no cifra ni borra nada
Get-ChildItem -Path $global:Dir -Recurse -File | ForEach-Object { $_.IsReadOnly = $true }
Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
$global:JaiseConn = $null
Ok 'Manifiesto escrito (manifiesto.json, manifiesto.md) y archivos marcados como solo lectura'
Write-Host ''
Write-Host 'PASO 6 COMPLETO. Respaldo en:' -ForegroundColor Green
Write-Host "  $global:Dir"
Write-Host ''
Write-Host 'Comparta SOLO el contenido de este archivo (sin datos personales):' -ForegroundColor Yellow
Write-Host "  $(Join-Path $global:Dir 'metadatos-para-compartir.txt')"
Write-Host 'No borre nada de esta carpeta sin su autorizacion. La contrasena de la sesion ya se elimino de esta ventana.'
