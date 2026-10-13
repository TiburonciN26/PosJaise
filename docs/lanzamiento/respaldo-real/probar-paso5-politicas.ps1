# PRUEBA LOCAL del paso 5 (no es un paso del respaldo; NO se conecta a produccion). Ejecuta 05-definiciones-y-huella.ps1
# TAL CUAL contra el Supabase LOCAL: una funcion "docker" temporal sustituye el "docker run ... psql" del paso por
# "docker exec" en el contenedor local, con la sesion en solo lectura. Estados probados:
#   B) base Local real "postgres" (lote de 23 aplicado): movimientos_insert eliminada por 20261002000008.
#   A) copia DESECHABLE "qa_paso5_anterior" (pg_dump de public/auth/supabase_migrations) a la que se le devuelve el estado
#      anterior a 20261002000008: se crea la politica movimientos_insert original y se quita esa version del registro. Solo la
#      politica; no se restauran GRANTs. La copia se borra al terminar.
# Mas cuatro estados invalidos sobre la misma copia, que deben DETENER el paso.
# Uso:  powershell -File docs\lanzamiento\respaldo-real\probar-paso5-politicas.ps1 [-Salida <archivo.json>]
param([string]$Salida)
$ErrorActionPreference = 'Stop'
$contenedor = 'supabase_db_WedJaiseReact'
$paso5 = Join-Path $PSScriptRoot '05-definiciones-y-huella.ps1'
$copia = 'qa_paso5_anterior'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('qa-paso5-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$casos = New-Object System.Collections.ArrayList
function Caso([string]$nombre, [bool]$ok, $detalle) {
    [void]$casos.Add([pscustomobject]@{ nombre = $nombre; ok = $ok; detalle = $detalle })
    Write-Host ("{0} {1}" -f $(if ($ok) { 'OK   ' } else { 'FALLA' }), $nombre) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    if (-not $ok) { Write-Host "      $($detalle | ConvertTo-Json -Compress -Depth 5)" }
}
function SqlLocal([string]$base, [string]$sql) {
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $o = $sql | docker.exe exec -i $contenedor psql -U supabase_admin -d $base -X -q -At -v ON_ERROR_STOP=1 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    if ($LASTEXITCODE -ne 0) { throw "SQL local fallido en ${base}: $($o -join ' ')" }
    return ($o -join "`n")
}

# Sustituto de "docker run ... --entrypoint psql IMG -h H -p P -U U -d BASE <flags> -f /sql/X.sql": misma base y flags, en
# el contenedor local y en solo lectura. Cualquier otra invocacion falla (el paso 5 solo usa psql con -f).
function global:docker {
    $a = @($args)
    $i = [array]::IndexOf($a, '--entrypoint')
    if ($a[0] -ne 'run' -or $i -lt 0 -or $a[$i + 1] -ne 'psql') { throw "docker de prueba: invocacion no esperada: $($a[0..3] -join ' ')" }
    $resto = @($a[($i + 3)..($a.Count - 1)])
    $base = $null; $archivo = $null; $flags = @(); $k = 0
    while ($k -lt $resto.Count) {
        switch -CaseSensitive ($resto[$k]) {
            '-d' { $base = $resto[$k + 1]; $k += 2; continue }
            '-f' { $archivo = $resto[$k + 1]; $k += 2; continue }
            { $_ -in '-h', '-p', '-U' } { $k += 2; continue }
            default { $flags += $resto[$k]; $k += 1 }
        }
    }
    if ($archivo -notlike '/sql/*') { throw "docker de prueba: archivo no esperado $archivo" }
    $local = Join-Path (Join-Path $PSScriptRoot 'sql') ($archivo.Substring(5))
    Get-Content -Raw $local | docker.exe exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' $contenedor psql -U postgres -d $base -X @flags -f -
}

function Paso5([string]$base) {
    $corrida = Join-Path $tmp ('corrida-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    New-Item -ItemType Directory -Force -Path $corrida | Out-Null
    $corrida | Set-Content -Path (Join-Path $tmp 'ultima_corrida.txt') -Encoding ASCII
    '{ "paso4": { "ok": true } }' | Set-Content -Path (Join-Path $corrida 'estado.json') -Encoding ASCII
    $env:JAISE_RAIZ = $tmp; $env:PGPASSWORD = 'no-se-usa-en-local'
    $global:JaiseConn = @{ Host = 'qa.invalid'; Puerto = 5432; Usuario = 'postgres'; Base = $base; SslMode = 'disable' }
    $msg = $null; $ok = $false
    try { & $paso5 *> $null; $ok = $true } catch { $msg = "$($_.Exception.Message)" } finally { $env:PGPASSWORD = $null }
    $e = Get-Content (Join-Path $corrida 'estado.json') -Raw | ConvertFrom-Json
    $def = if ($e.paso5) { Get-Content (Join-Path $corrida $e.paso5.definiciones) -Raw } else { '' }
    return @{ ok = $ok; error = $msg; paso5 = $e.paso5; def = $def }
}
$MOV = '-- POLITICA public.movimientos_stock.movimientos_insert cmd=INSERT'
$MOV_AUS = '-- POLITICA AUSENTE public.movimientos_stock.movimientos_insert'
$VEN = '-- POLITICA public.ventas.ventas_insert cmd=INSERT'

try {
    # ---- B: base Local real, lote de 23 aplicado (movimientos_insert eliminada) ----
    $r = Paso5 'postgres'
    Caso 'B: movimientos_insert eliminada y 20261002000008 registrada -> paso 5 OK; ventas_insert capturada y movimientos_insert registrada como AUSENTE' ($r.ok -and $r.paso5.politicas -eq 1 -and @($r.paso5.politicas_ausentes) -join ',' -eq 'public.movimientos_stock.movimientos_insert' -and $r.paso5.migracion_20261002000008 -eq $true -and $r.def.Contains($VEN) -and $r.def.Contains($MOV_AUS) -and -not $r.def.Contains($MOV)) @{ error = $r.error; paso5 = $r.paso5 }

    # ---- A: copia desechable devuelta al estado anterior a 20261002000008 ----
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    docker.exe exec $contenedor psql -U supabase_admin -d postgres -X -q -c "drop database if exists $copia" *> $null
    docker.exe exec $contenedor psql -U supabase_admin -d postgres -X -q -c "create database $copia" *> $null
    docker.exe exec $contenedor sh -c "pg_dump -U supabase_admin -d postgres -n public -n auth -n supabase_migrations | psql -U supabase_admin -d $copia -X -q" *> $null
    $ErrorActionPreference = $previo
    $base = SqlLocal $copia "select (select count(*) from pg_policies where schemaname='public' and tablename='ventas' and policyname='ventas_insert') || '|' || (select count(*) from supabase_migrations.schema_migrations)"
    if ($base -notmatch '^1\|\d+$') { throw "La copia $copia no quedo utilizable: $base" }
    $null = SqlLocal $copia "begin; create policy movimientos_insert on public.movimientos_stock for insert to authenticated with check (usuario_id = auth.uid()); delete from supabase_migrations.schema_migrations where version = '20261002000008'; commit;"
    $r = Paso5 $copia
    Caso 'A: estado anterior con ambas politicas (20261002000008 sin registrar) -> paso 5 OK; las 2 politicas capturadas, ninguna ausente' ($r.ok -and $r.paso5.politicas -eq 2 -and @($r.paso5.politicas_ausentes).Count -eq 0 -and $r.paso5.migracion_20261002000008 -eq $false -and $r.def.Contains($VEN) -and $r.def.Contains("$MOV roles={authenticated} using= check=(usuario_id = auth.uid())") -and -not $r.def.Contains($MOV_AUS)) @{ error = $r.error; paso5 = $r.paso5 }

    # ---- estados invalidos sobre la copia: el paso 5 debe detenerse ----
    $null = SqlLocal $copia "insert into supabase_migrations.schema_migrations(version, name) values ('20261002000008', 'agregar_stock_solo_admin_cajera')"
    $r = Paso5 $copia
    Caso 'Invalido: 20261002000008 registrada pero movimientos_insert sigue -> DETENIDO (incoherente)' ((-not $r.ok) -and $r.error -match 'incoherente' -and -not $r.paso5) @{ error = $r.error }
    $null = SqlLocal $copia "begin; drop policy movimientos_insert on public.movimientos_stock; delete from supabase_migrations.schema_migrations where version = '20261002000008'; commit;"
    $r = Paso5 $copia
    Caso 'Invalido: movimientos_insert ausente sin 20261002000008 registrada -> DETENIDO (estado desconocido)' ((-not $r.ok) -and $r.error -match 'no esta registrada' -and -not $r.paso5) @{ error = $r.error }
    $null = SqlLocal $copia "begin; insert into supabase_migrations.schema_migrations(version, name) values ('20261002000008', 'agregar_stock_solo_admin_cajera'); create policy movimientos_insert on public.ventas for select to authenticated using (false); commit;"
    $r = Paso5 $copia
    Caso 'Invalido: una politica movimientos_insert en otra tabla (public.ventas) -> DETENIDO (fuera de lugar)' ((-not $r.ok) -and $r.error -match 'otra tabla' -and -not $r.paso5) @{ error = $r.error }
    $null = SqlLocal $copia "begin; drop policy movimientos_insert on public.ventas; drop policy ventas_insert on public.ventas; commit;"
    $r = Paso5 $copia
    Caso 'Invalido: ventas_insert ausente -> DETENIDO' ((-not $r.ok) -and $r.error -match 'ventas_insert' -and -not $r.paso5) @{ error = $r.error }
} finally {
    Remove-Item Function:\docker -ErrorAction SilentlyContinue
    $ErrorActionPreference = 'Continue'
    docker.exe exec $contenedor psql -U supabase_admin -d postgres -X -q -c "drop database if exists $copia" *> $null
    $ErrorActionPreference = 'Stop'
    $env:JAISE_RAIZ = $null; $global:JaiseConn = $null
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
$fallos = @($casos | Where-Object { -not $_.ok }).Count
if ($Salida) { [pscustomobject]@{ fecha = (Get-Date).ToUniversalTime().ToString('o'); total = $casos.Count; fallos = $fallos; casos = $casos } | ConvertTo-Json -Depth 6 | Set-Content -Path $Salida -Encoding UTF8 }
Write-Host ''
Write-Host "$($casos.Count - $fallos)/$($casos.Count) correctos"
if ($fallos) { exit 1 }
