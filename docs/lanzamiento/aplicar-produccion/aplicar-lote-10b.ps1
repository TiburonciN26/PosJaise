# Fase 10B · aplica EN PRODUCCION las migraciones del candidato que falten (desde 20261009000001), con psql 17.6 en Docker.
# Lo ejecuta el usuario: credenciales SOLO en su terminal. Requiere la aprobacion de Codex de los controles criticos.
# Uso (PowerShell, Docker abierto):   cd C:\WedJaiseReact\docs\lanzamiento\aplicar-produccion ; .\aplicar-lote-10b.ps1
#   -SoloGenerar   no se conecta: escribe en .codex\evidencia-fase10b\lote-produccion\ el SQL exacto de cada transaccion
#                  (asumiendo que faltan las 12) para revisarlo o ensayarlo.
#
# Garantias:
#  1. Los archivos son exactamente los del candidato (SHA-256 abajo); si alguno cambio, no se aplica nada.
#  2. Existe un respaldo verificado de produccion de menos de 24 h (C:\JaiseBackups\Produccion\prod_*.dump.verificacion.txt).
#  3. La base tiene las 23 migraciones del lanzamiento anterior (2026100[2-8]) y las que faltan del candidato son un SUFIJO
#     ordenado (sin huecos); si no, se detiene sin tocar nada.
#  4. CADA migracion se aplica en UNA transaccion junto con el registro de su version en supabase_migrations: o queda aplicada y
#     registrada, o nada. Se quitan solo la linea «begin;» y la linea «commit;» de nivel superior de cada archivo (se comprueba
#     que hay exactamente una de cada) y se envuelve todo en un unico begin/commit.
#  5. DEUDAS (D11-A): si falta 20261010000001 (deuda_pagos), se aplica en LA MISMA transaccion que 20261013000001
#     (compatibilidad con el frontend anterior): nunca existe deuda_pagos sin la compatibilidad. La transaccion termina con el
#     relleno dirigido y la comprobacion del invariante de 20261013000001, que la revierte entera si queda una deuda incoherente.
#  6. Confirmacion escrita APLICAR. Se detiene ante el primer fallo; lo anterior quedo aplicado y registrado.
#  7. Al final: versiones registradas, triggers de compatibilidad presentes y 0 deudas incoherentes.
param([string]$HostDb, [int]$Puerto = 5432, [string]$Usuario = 'postgres.cmkelllerzjqjbsqsylc', [string]$SslMode = 'require', [switch]$SoloGenerar)
$ErrorActionPreference = 'Stop'
$img = 'public.ecr.aws/supabase/postgres:17.6.1.171'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$migraciones = Join-Path $repo 'supabase\migrations'
$respaldoDir = if ($env:JAISE_RESPALDO) { $env:JAISE_RESPALDO } else { 'C:\JaiseBackups\Produccion' }
$evidencia = Join-Path $repo '.codex\evidencia-fase10b'
New-Item -ItemType Directory -Force -Path $evidencia | Out-Null
$registro = Join-Path $evidencia ('lote-produccion_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.log')

$esperadas = @'
20261009000001_web_publica_visitantes.sql|bbdbabca3df8562ea79ffb4090f9e153ce2183af1e61d8d4c07d592a562dfd21
20261009000002_pasarela_tarjeta.sql|b4d0e7fcb08477044b79fa445c021f7ab8a490c352ff88370e78fbbc4b2f3a1d
20261009000003_confirmar_pago_pasarela.sql|06bc69fba0585168a88d898efb2786e8fb0ebb8dedef7e4d620756b6509addd7
20261009000004_libro_reclamaciones.sql|d10858120e59026800565320dc573ef674585c008ebc3a117b53c62623e0dd88
20261009000005_confirmar_pedido_tarjeta.sql|8050a232ef3dbe8d9c7e4159c7260ce45c7a616e66869dcba6c66c97b7e804e1
20261010000001_deuda_pagos.sql|9c7ff9918cb13094421203109cf8586eb1ed0ddd2c2deffda4c6b47c7907b0ab
20261011000001_catalogo_publico_vitrina.sql|ba876f01057710f2982b937281e8ad6307851c6b2621b9deaa7347a50b39653f
20261011000002_vistas_listas_admin.sql|9ba1370dd704c61972d7fcbdd5568a71d38a933f315a893c1957923a08978f1a
20261012000001_rls_helpers_una_vez_por_consulta.sql|88edc092b10ef2539a2462d6bde9b17f18c25b6ed89c780e848ba4b3620d4e1d
20261012000002_indices_listas_medidos.sql|eee9963b4f601247b470e4c784331036f493cc3f452c30158874eba14b7b53f0
20261012000003_migracion_medios_cambio_con_plazo.sql|764c50b24f30435877a5c46219a487b61f9a9b7d451c960a2b049aeeae1c26d8
20261013000001_deudas_compatibilidad_convivencia.sql|493b500726eeb2559c5d6ed2c3afb4e9234430c47ffa589e8a0362912db9c3d8
'@ -split "`r?`n" | Where-Object { $_ }

function Log([string]$t) { Write-Host $t; Add-Content -Path $registro -Value $t -Encoding UTF8 }
function Detener([string]$m) {
    Log ''; Log "DETENIDO: $m"
    Log 'Lo marcado OK arriba SI quedo aplicado y registrado (cada transaccion es completa o nada). No repita el script sin avisar.'
    throw "DETENIDO: $m"
}
# Cuerpo de una migracion sin su begin;/commit; de nivel superior (exactamente uno de cada, o se detiene).
function Cuerpo([string]$nombre) {
    $t = [IO.File]::ReadAllText((Join-Path $migraciones $nombre)) -replace "`r`n", "`n"
    $b = [regex]::Matches($t, '(?im)^begin;[ \t]*$').Count; $c = [regex]::Matches($t, '(?im)^commit;[ \t]*$').Count
    if ($b -ne 1 -or $c -ne 1) { Detener "$nombre no tiene exactamente un begin; y un commit; de nivel superior ($b/$c)." }
    return ([regex]::Replace(([regex]::Replace($t, '(?im)^begin;[ \t]*$', '-- (begin del archivo: lo da el lote)')), '(?im)^commit;[ \t]*$', '-- (commit del archivo: lo da el lote)'))
}
function Registro([string]$nombre) {
    $v = $nombre.Split('_')[0]; $n = ($nombre -replace '^\d+_', '') -replace '\.sql$', ''
    return "insert into supabase_migrations.schema_migrations(version, name) values ('$v', '$n') on conflict (version) do nothing;"
}
function Transaccion([string[]]$nombres) {
    $partes = @("\set ON_ERROR_STOP on", 'begin;')
    foreach ($n in $nombres) { $partes += "-- ===== $n ====="; $partes += (Cuerpo $n); $partes += (Registro $n) }
    $partes += 'commit;'
    return ($partes -join "`n")
}
function Psql([string]$sql, [string[]]$extra = @()) {
    $a = @('run', '--rm', '-i', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$SslMode", '--entrypoint', 'psql', $img, '-h', $HostDb, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres', '-X') + $extra
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $salida = $sql | & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n").Trim() }
}
# Plan de transacciones para un conjunto de pendientes (en orden): el par de deudas va junto, en el lugar de 20261010000001.
function Plan([string[]]$pendientes) {
    $plan = @()
    $par = ($pendientes -contains '20261010000001_deuda_pagos.sql')
    foreach ($n in $pendientes) {
        if ($n -eq '20261013000001_deudas_compatibilidad_convivencia.sql' -and $par) { continue }
        if ($n -eq '20261010000001_deuda_pagos.sql') {
            if (-not ($pendientes -contains '20261013000001_deudas_compatibilidad_convivencia.sql')) { Detener 'Falta 20261010000001 pero 20261013000001 ya consta: estado inesperado.' }
            $plan += , @('20261010000001_deuda_pagos.sql', '20261013000001_deudas_compatibilidad_convivencia.sql')
        } else { $plan += , @($n) }
    }
    return , $plan
}

Log "== Lote 10B en produccion. UTC $((Get-Date).ToUniversalTime().ToString('o')) =="
# 1. Archivos exactos
$nombres = @()
foreach ($e in $esperadas) {
    $n, $h = $e.Split('|'); $f = Join-Path $migraciones $n
    if (-not (Test-Path $f)) { Detener "Falta $n" }
    if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $h) { Detener "$n no es el del candidato (SHA-256 distinto)." }
    $nombres += $n
}
Log "OK  Los $($nombres.Count) archivos son los del candidato (SHA-256 verificado)"

if ($SoloGenerar) {
    $dir = Join-Path $evidencia 'lote-produccion'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $i = 0
    foreach ($t in (Plan $nombres)) { $i++; $sal = Join-Path $dir ('{0:00}_{1}' -f $i, ($t -join '+')); [IO.File]::WriteAllText($sal, (Transaccion $t), (New-Object Text.UTF8Encoding($false))); Log "GEN $sal" }
    Log 'SoloGenerar: no se conecto a ninguna base.'
    return
}

# 2. Respaldo reciente
$ver = @(Get-ChildItem $respaldoDir -Filter 'prod_*.dump.verificacion.txt' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime)
if ($ver.Count -lt 1) { Detener "No hay respaldo verificado en $respaldoDir." }
if ($ver[-1].LastWriteTime -lt (Get-Date).AddHours(-24)) { Detener "El ultimo respaldo verificado tiene mas de 24 h ($($ver[-1].Name)). Haga uno nuevo (PROCEDIMIENTO-RESPALDO-PRODUCCION.md)." }
Log "OK  Respaldo verificado reciente: $($ver[-1].Name)"

if ($Usuario -notmatch '\.cmkelllerzjqjbsqsylc$') { Detener 'El usuario no corresponde al proyecto de produccion.' }
if (-not $HostDb) { $HostDb = Read-Host 'Host del Session pooler (panel > Connect > Session pooler)' }
if (-not $env:PGPASSWORD) {
    $s = Read-Host 'Contrasena de la base (no se muestra)' -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
try {
    # 3. Estado previo
    $r = Psql "select count(*) from supabase_migrations.schema_migrations where version between '20261002000000' and '20261008999999';" @('-At')
    if ($r.Codigo -ne 0) { Detener "No se pudo conectar o leer: $($r.Salida)" }
    if ([int]$r.Salida -lt 23) { Detener "La base no tiene las 23 migraciones del lanzamiento anterior ($($r.Salida)). No se toca nada." }
    $r = Psql "select version from supabase_migrations.schema_migrations where version >= '20261009000000' order by version;" @('-At')
    $hechas = @($r.Salida -split "`n" | Where-Object { $_ })
    $pendientes = @($nombres | Where-Object { $hechas -notcontains $_.Split('_')[0] })
    $ultimaHecha = ($nombres | Where-Object { $hechas -contains $_.Split('_')[0] } | Select-Object -Last 1)
    if ($ultimaHecha -and $pendientes.Count -and ([array]::IndexOf($nombres, $pendientes[0]) -lt [array]::IndexOf($nombres, $ultimaHecha)) -and -not ($pendientes.Count -eq 1 -and $pendientes[0] -like '20261013000001*')) {
        Detener "Las pendientes no son un sufijo ordenado (hay huecos): pendientes=$($pendientes -join ', ')"
    }
    if (-not $pendientes.Count) { Log 'Nada pendiente: produccion ya tiene todas las migraciones del candidato.'; return }
    $plan = Plan $pendientes
    Log "Pendientes ($($pendientes.Count)) en $($plan.Count) transacciones:"
    foreach ($t in $plan) { Log ('   - ' + ($t -join '  +  ')) }
    $r = Psql "select count(*) from public.deudas;" @('-At'); Log "Deudas existentes: $($r.Salida)"

    # 4. Confirmacion
    Write-Host ''
    Write-Host 'Se van a aplicar estas transacciones en PRODUCCION.' -ForegroundColor Yellow
    if ((Read-Host 'Escriba APLICAR para continuar') -ne 'APLICAR') { Detener 'No se confirmo. No se aplico nada.' }

    # 5. Aplicar
    $i = 0
    foreach ($t in $plan) {
        $i++
        $r = Psql (Transaccion $t) @('-q')
        if ($r.Codigo -ne 0) { Log "ERR $($t -join ' + ')"; Log $r.Salida; Detener "La transaccion $i de $($plan.Count) fallo y se deshizo entera: $($t -join ' + ')." }
        foreach ($n in $t) {
            $v = $n.Split('_')[0]
            $r3 = Psql "select count(*) from supabase_migrations.schema_migrations where version = '$v';" @('-At')
            if ($r3.Salida -ne '1') { Detener "La version $v no quedo registrada." }
        }
        Log ("OK  {0}/{1}  {2}" -f $i, $plan.Count, ($t -join '  +  '))
    }

    # 6. Comprobaciones finales
    $q = "select (select count(*) from pg_trigger where tgrelid = 'public.deudas'::regclass and tgname in ('deudas_compat_antes','deudas_compat_despues'))::text || '|' || (select count(*) from public.deudas d left join (select deuda_id, sum(monto) p from public.deuda_pagos group by deuda_id) q on q.deuda_id = d.id where (d.estado = 'COBRADA' and coalesce(q.p,0) < d.monto) or (d.estado = 'PENDIENTE' and coalesce(q.p,0) > 0 and coalesce(q.p,0) >= d.monto))::text || '|' || (select count(*) from supabase_migrations.schema_migrations where version >= '20261009000000')::text;"
    $r = Psql $q @('-At')
    $e = $r.Salida.Split('|')
    if ($e[0] -ne '2' -or $e[1] -ne '0' -or [int]$e[2] -lt 12) { Detener "Comprobacion final inesperada (triggers|incoherentes|versiones): $($r.Salida)" }
    Log "OK  Triggers de compatibilidad: 2 · deudas incoherentes: 0 · versiones 2026-10-09+: $($e[2])"
    Log ''
    Log 'COMPLETO. Avise a Claude para verificar el backend en solo lectura antes de publicar el frontend.'
} finally {
    $env:PGPASSWORD = $null
}
