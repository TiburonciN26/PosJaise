# Aplica EN PRODUCCION las 23 migraciones del lanzamiento, en orden, una por una, con psql 17.6 (mismo metodo ensayado en la
# instancia desechable). Recompensas queda APAGADO: ninguna migracion lo activa ni ejecuta la apertura.
# SE DETIENE ante cualquier fallo (no sigue con las siguientes). Cada archivo es su propia transaccion: un fallo deshace ESE archivo;
# los anteriores quedan confirmados (no hay transaccion comun). Credenciales: solo en SU terminal.
# Uso (PowerShell, Docker abierto):   cd C:\WedJaiseReact\docs\lanzamiento\aplicar-produccion ; .\aplicar-23-migraciones.ps1
param([string]$HostDb, [int]$Puerto = 5432, [string]$Usuario = 'postgres.cmkelllerzjqjbsqsylc', [string]$SslMode = 'require', [switch]$Prueba)
$ErrorActionPreference = 'Stop'
$img = 'public.ecr.aws/supabase/postgres:17.6.1.171'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$migraciones = Join-Path $repo 'supabase\migrations'
$respaldoDir = if ($env:JAISE_RESPALDO) { $env:JAISE_RESPALDO } else { 'C:\JaiseBackups\Produccion' }
$registro = Join-Path $respaldoDir ('migraciones_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.log')

# SHA-256 de los 23 archivos ensayados: si alguno cambio, no se aplica nada
$esperadas = @'
20261002000001_guardar_cita_pos.sql|0a998aa133e092766063108c3b71efd2a7a92e256d530ba15413673bc838e9f1
20261002000002_fidelizacion_dia_lima.sql|8d2b67c9b9ec8144fca78ad517778e2cc3b1bc3db276f25bb10dd9c3313c225c
20261002000003_pedidos_cupones_ambiguedades_pago.sql|73bf1c9a7ebf994034fdda6443c0fd8fb7475233cbf657e10f103ccb6d86fd58
20261002000004_anular_venta_concilia_pedido_web.sql|29eec1e8665b1ff2eb4fb9992ba76b5fd9e93571ec8b58d9b1b6c7e3ab4884b2
20261002000005_resumen_dashboard_envio_separado.sql|f11b2b6d704c87b8c45538228dbefe48529d38798fe6c763a7f16a7d75f688a6
20261002000006_es_admin_siempre_boolean.sql|43705342e85a02db48bbe208ff4821667066ad2701522a91eca6c42884f5eec9
20261002000007_ventas_solo_admin_cajera.sql|fdf09668e8caa0316ddd9f082e84f5c9086f5f630f256bef3a3017372157ee54
20261002000008_agregar_stock_solo_admin_cajera.sql|727ceb6aa8a5b221145d65b1aa0e95da372b59ba347356b0d43233bf431de532
20261003000001_recompensas_fase2_nucleo.sql|f1ef0be6348d0783567e0711459ef23418b553f597bc9c33f4eb4f38d3b69c26
20261003000002_recompensas_fase2_correcciones.sql|2e0dad5e027445f53ac4714f4639706af799c9520b9a295a0d901485ee90f411
20261003000003_recompensas_simulacion_transicion.sql|8bb87c0d3db36253052958c37e18daf6109422a5be0462b3ab02fc546fcbf9b4
20261003000004_recompensas_lectores_portal.sql|e276d0680070234b5b421183a3b0f4488cbf7caf0162f6358d777854f6a3946c
20261004000001_ventas_codigo_mas_de_999.sql|daffcfd0f5d99f1a9604f1bfbd08f61c6b177085fb865aecd603a9c13607ccfa
20261005000001_cupones_proteccion_global.sql|d26198952af35faf7cb27a53712359cd6ce22a7833e1e1b397629b2bb57ae4b3
20261005000002_cupones_validacion_pedido.sql|b50eb57223c706fd9757a38737ef5c87ec62b29e8d352352c0d036bcbdb6c597
20261005000003_pedido_cantidades_total_anunciado.sql|825a81019a830246cabf8cae3e558395d7585a085aa133c791812fb244168554
20261005000004_recompensas_reglas_publicas.sql|154883610d95eb8703069cf6fe186d784ec59a9ed3b4ca705d77e215beaecf74
20261006000001_resenas_inicio.sql|95d41e3d9e48e4e29bb3c366891220660ab4fe148b945efd472197c8e1f6e6da
20261006000002_equipo_duena.sql|9a78feb79f1c0b3c2afa3b61520290b4e988893498cd52ec4c2b8aed250054d9
20261007000001_cupones_promocion_vencimiento.sql|3c4f068c78df7e5bed0818f0db154c9f2061571f394075df9782ee151e056c62
20261007000002_reclamar_cupon_promocion_idempotente.sql|b1c4db4fb76332572d345ed263e75ae00f564096e78212aeadff006349b17c99
20261008000001_confirmar_pedido_productos_sin_anon.sql|f33c3eba6cd120166f9ad05820fe3135d9acbcaed859ced40e9b7562d877af3b
20261008000002_recompensas_activacion_bloqueada_hasta_apertura.sql|926b7607496b0a6cd16462c8b9a0d9998159fcf792ebb52820b608457b73156f
'@ -split "`r?`n" | Where-Object { $_ }

function Log([string]$t) { Write-Host $t; Add-Content -Path $registro -Value $t -Encoding UTF8 }
function Detener([string]$m) {
    Log ''; Log "DETENIDO: $m"
    Log 'No se aplico nada mas. Estado: ver el registro; las migraciones marcadas OK arriba SI quedaron aplicadas. No repita el script sin avisar.'
    throw "DETENIDO: $m"
}
function Psql([string[]]$argumentos, [switch]$ConArchivo) {
    $a = @('run', '--rm', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$SslMode", '-v', "${migraciones}:/mig:ro", '--entrypoint', 'psql', $img, '-h', $HostDb, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres') + $argumentos
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $salida = & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n").Trim() }
}

New-Item -ItemType Directory -Force -Path $respaldoDir | Out-Null
Log "== Aplicacion de las 23 migraciones en produccion. UTC $((Get-Date).ToUniversalTime().ToString('o')) =="

# 1. Los archivos son exactamente los ensayados
$archivos = @(Get-ChildItem $migraciones -Filter '*.sql' | Where-Object { $_.Name -match '^2026100[2-8]\d+_' } | Sort-Object Name)
if ($archivos.Count -ne 23 -or $esperadas.Count -ne 23) { Detener "Se esperaban 23 migraciones y hay $($archivos.Count)." }
for ($i = 0; $i -lt 23; $i++) {
    $n, $h = $esperadas[$i].Split('|')
    if ($archivos[$i].Name -ne $n) { Detener "Orden/nombre inesperado en la posicion $($i + 1): $($archivos[$i].Name)" }
    if ((Get-FileHash $archivos[$i].FullName -Algorithm SHA256).Hash.ToLower() -ne $h) { Detener "El archivo $n no es el que se ensayo (SHA-256 distinto)." }
}
Log 'OK  Los 23 archivos son los ensayados (SHA-256 verificado)'

# 2. Existe el respaldo
if (-not $Prueba) {
    $ver = @(Get-ChildItem $respaldoDir -Filter 'prod_*.dump.verificacion.txt' -ErrorAction SilentlyContinue)
    if ($ver.Count -lt 1) { Detener "No hay respaldo verificado en $respaldoDir (prod_*.dump.verificacion.txt)." }
    Log "OK  Respaldo verificado presente: $($ver[-1].Name.Replace('.verificacion.txt', ''))"
}

# 3. Conexion
if (-not $HostDb) { $HostDb = Read-Host 'Host del Session pooler (panel > Connect > Session pooler)' }
if (-not $env:PGPASSWORD) {
    $s = Read-Host 'Contrasena de la base (no se muestra)' -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
try {
    $r = Psql @('-At', '-c', 'select 1')
    if ($r.Codigo -ne 0 -or $r.Salida -ne '1') { Detener "No se pudo conectar (codigo $($r.Codigo)): $($r.Salida)" }
    Log 'OK  Conexion correcta'

    # 4. Precondiciones: la base esta en el estado previo esperado
    $q = "select (to_regclass('public.recompensas_config') is null)::text || '|' || (not exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='guardar_cita_pos'))::text || '|' || (select pronargs::text from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirmar_pedido_productos') || '|' || (select count(*)::text from supabase_migrations.schema_migrations where version >= '20261002000000')"
    $r = Psql @('-At', '-c', $q)
    if ($r.Codigo -ne 0) { Detener "No se pudo comprobar el estado previo: $($r.Salida)" }
    $e = $r.Salida.Split('|')
    if ($e[0] -ne 'true' -or $e[1] -ne 'true' -or $e[2] -ne '13' -or $e[3] -ne '0') { Detener "La base NO esta en el estado previo esperado ($($r.Salida)). Puede que ya se haya aplicado algo. No se toca nada." }
    Log 'OK  Estado previo correcto (sin recompensas_config, sin guardar_cita_pos, confirmar_pedido_productos de 13 parametros, 0 migraciones nuevas registradas)'

    # 5. Confirmacion final escrita
    if (-not $Prueba) {
        Write-Host ''
        Write-Host 'Se van a aplicar 23 migraciones en PRODUCCION. Recompensas queda APAGADO (sin apertura, sin activacion).' -ForegroundColor Yellow
        $c = Read-Host 'Escriba APLICAR para continuar'
        if ($c -ne 'APLICAR') { Detener 'No se confirmo. No se aplico nada.' }
    }

    # 6. Aplicar, una por una
    $n = 0
    foreach ($f in $archivos) {
        $n++
        $r = Psql @('-v', 'ON_ERROR_STOP=1', '-q', '-f', "/mig/$($f.Name)")
        if ($r.Codigo -ne 0) { Log "ERR $($f.Name) (codigo $($r.Codigo))"; Log $r.Salida; Detener "La migracion $n de 23 fallo: $($f.Name). Las anteriores quedaron aplicadas; esta se deshizo entera." }
        $version = $f.Name.Split('_')[0]; $nombre = ($f.Name -replace '^\d+_', '') -replace '\.sql$', ''
        $r2 = Psql @('-At', '-v', 'ON_ERROR_STOP=1', '-c', "insert into supabase_migrations.schema_migrations(version, name) values ('$version', '$nombre') on conflict (version) do nothing")
        if ($r2.Codigo -ne 0) { Detener "La migracion $n se aplico pero no se pudo registrar su version ($version): $($r2.Salida)" }
        $r3 = Psql @('-At', '-c', "select count(*) from supabase_migrations.schema_migrations where version = '$version'")
        if ($r3.Codigo -ne 0 -or $r3.Salida -ne '1') { Detener "La version $version no quedo registrada tras aplicarla." }
        Log ("OK  {0,2}/23  {1}" -f $n, $f.Name)
    }

    # 7. Comprobacion minima de recompensas apagado
    $r = Psql @('-At', '-c', "select activo::text || '|' || coalesce(corte::text, 'NULL') || '|' || coalesce(apertura_ejecutada_en::text, 'NULL') from public.recompensas_config where id = 1")
    if ($r.Codigo -ne 0 -or $r.Salida -ne 'false|NULL|NULL') { Detener "Recompensas no esta apagado o sin corte/apertura: '$($r.Salida)'" }
    Log 'OK  Recompensas: activo=false, corte=NULL, apertura_ejecutada_en=NULL'
    Log ''
    Log 'COMPLETO: 23/23 migraciones aplicadas y registradas. Avise para verificar el backend (no se ha hecho merge ni publicacion).'
} finally {
    $env:PGPASSWORD = $null
}
