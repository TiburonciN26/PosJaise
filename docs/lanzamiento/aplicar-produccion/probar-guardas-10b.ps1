# Fase 10B - regresiones SIN RED de aplicar-lote-10b.ps1 e inventario-produccion-10b.ps1 (revision F10B-01..04 de Codex).
# Uso:  powershell -File docs\lanzamiento\aplicar-produccion\probar-guardas-10b.ps1 [-Salida <archivo.json>] [-ConLocal]
# El aplicador y el inventario se ejecutan TAL CUAL, con un ejecutor de psql FICTICIO (estado en memoria) y una confirmacion
# simulada: nunca se lanza Docker contra una base remota, nunca se abre una conexion y el host es qa.invalid. Los respaldos son
# corridas ficticias creadas en una carpeta temporal con la MISMA estructura que produce docs\lanzamiento\respaldo-real.
# -ConLocal anade dos casos del inventario contra el Supabase LOCAL (solo lectura): esquema actual y una base temporal con un
# esquema antiguo minimo (se crea y se borra en el contenedor local).
param([string]$Salida, [switch]$ConLocal)
$ErrorActionPreference = 'Stop'
$dir = $PSScriptRoot
$aplicador = Join-Path $dir 'aplicar-lote-10b.ps1'
$inventario = Join-Path $dir 'inventario-produccion-10b.ps1'
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('qa-10b-guardas-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$casos = New-Object System.Collections.ArrayList
function Caso([string]$nombre, [bool]$ok, $detalle) {
    [void]$casos.Add([pscustomobject]@{ nombre = $nombre; ok = $ok; detalle = $detalle })
    Write-Host ("{0} {1}" -f $(if ($ok) { 'OK   ' } else { 'FALLA' }), $nombre) -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' })
    if (-not $ok) { Write-Host "      $($detalle | ConvertTo-Json -Compress -Depth 4)" }
}
$REQ = @('20261002000001', '20261002000002', '20261002000003', '20261002000004', '20261002000005', '20261002000006', '20261002000007', '20261002000008',
    '20261003000001', '20261003000002', '20261003000003', '20261003000004', '20261004000001', '20261005000001', '20261005000002', '20261005000003',
    '20261005000004', '20261006000001', '20261006000002', '20261007000001', '20261007000002', '20261008000001', '20261008000002')
$NUEVAS = @('20261009000001', '20261009000002', '20261009000003', '20261009000004', '20261009000005', '20261010000001', '20261011000001', '20261011000002',
    '20261012000001', '20261012000002', '20261012000003', '20261013000001')
$ANTIGUAS = @('20250101000001', '20250101000002')   # versiones anteriores ficticias (la base real tiene historial previo)

# ---------- corrida de respaldo ficticia con la estructura real ----------
function Nueva-Corrida([hashtable]$o = @{}) {
    $raiz = Join-Path $tmp ('respaldo-' + [guid]::NewGuid().ToString('N').Substring(0, 6)); $c = Join-Path $raiz 'corrida_20261013T120000Z'
    New-Item -ItemType Directory -Force -Path $c | Out-Null
    $arch = @{ dump = 'prod_20261013T120000Z.dump'; roles = 'roles_20261013T120000Z.sql'; def = 'definiciones_previas.sql'; huella = 'huella_previa.txt' }
    foreach ($k in $arch.Keys) { Set-Content -Path (Join-Path $c $arch[$k]) -Value "contenido ficticio $k $([guid]::NewGuid())" -Encoding ASCII }
    $h = @{}; foreach ($k in $arch.Keys) { $h[$k] = (Get-FileHash -Algorithm SHA256 (Join-Path $c $arch[$k])).Hash.ToLower() }
    $nMig = if ($o.ContainsKey('migraciones')) { $o.migraciones } else { $ANTIGUAS.Count + $REQ.Count }
    $estado = [ordered]@{
        inicio_utc = (Get-Date).ToUniversalTime().AddHours(-1).ToString('o')
        paso1 = @{ ok = $true; proyecto = $(if ($o.ContainsKey('proyecto')) { $o.proyecto } else { 'cmkelllerzjqjbsqsylc' }); version_servidor = '17.6'; preflight = @{ migraciones_registradas = "$nMig"; ventas_ultimo_codigo = 'VEN-000123' } }
        paso2 = @{ ok = $(if ($o.ContainsKey('paso2ok')) { $o.paso2ok } else { $true }); archivo = $arch.dump; codigo_pg_dump = 0; bytes = 1234; sha256 = $h.dump }
        paso3 = @{ ok = $true; archivo = $arch.roles; sha256 = $h.roles }
        paso4 = @{ ok = $true; objetos = 0 }
        paso5 = @{ ok = $true; definiciones = $arch.def; definiciones_sha256 = $h.def; huella = $arch.huella; huella_sha256 = $h.huella }
    }
    $estado | ConvertTo-Json -Depth 6 | Set-Content (Join-Path $c 'estado.json') -Encoding UTF8
    $fin = if ($o.ContainsKey('finUtc')) { $o.finUtc } else { (Get-Date).ToUniversalTime().AddMinutes(-30).ToString('o') }
    $man = [ordered]@{ corrida = 'corrida_20261013T120000Z'; inicio_utc = $estado.inicio_utc; fin_utc = $fin; estado = $estado
        archivos = @($arch.Keys | ForEach-Object { @{ archivo = $arch[$_]; bytes = 30; sha256 = $h[$_] } }) }
    $man | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $c 'manifiesto.json') -Encoding UTF8
    Set-Content (Join-Path $c 'metadatos-para-compartir.txt') -Value @('METADATOS', 'RESULTADO: todas las verificaciones OK. No se escribio nada en produccion.') -Encoding UTF8
    Set-Content (Join-Path $raiz 'ultima_corrida.txt') -Value $c -Encoding ASCII
    return @{ Raiz = $raiz; Corrida = $c; Archivos = $arch }
}

# ---------- psql ficticio con estado ----------
function Nuevo-Estado([string[]]$versiones) { return @{ versiones = [System.Collections.ArrayList]@($versiones); llamadas = 0; transacciones = 0; triggers = 2; incoherentes = 0; falla = @{} } }
function Nuevo-Ejecutor($e) {
    return {
        param($sql, $extra)
        $e.llamadas++
        foreach ($k in @($e.falla.Keys)) { if ($sql -like "*$k*") { $f = $e.falla[$k]; return @{ Codigo = $f.Codigo; Salida = $f.Salida } } }
        if ($sql -like '*\set ON_ERROR_STOP on*') {
            $e.transacciones++
            if ($e.ContainsKey('fallaTransaccion') -and $e.transacciones -eq $e.fallaTransaccion) { return @{ Codigo = 3; Salida = 'ERROR: fallo ficticio en la transaccion' } }
            foreach ($m in [regex]::Matches($sql, "schema_migrations\(version, name\) values \('(\d{14})'")) { if (-not $e.versiones.Contains($m.Groups[1].Value)) { [void]$e.versiones.Add($m.Groups[1].Value) } }
            return @{ Codigo = 0; Salida = '' }
        }
        if ($sql -like "*select 'V|' || version*") { $v = @($e.versiones | Sort-Object); return @{ Codigo = 0; Salida = ((@($v | ForEach-Object { "V|$_" }) + "FIN|$($v.Count)") -join "`n") } }
        if ($sql -match "schema_migrations where version = '(\d{14})'") { return @{ Codigo = 0; Salida = $(if ($e.versiones.Contains($Matches[1])) { '1' } else { '0' }) } }
        if ($sql -like '*from public.ventas where codigo*') { return @{ Codigo = 0; Salida = '1' } }
        if ($sql -like '*tgname in*') { return @{ Codigo = 0; Salida = "$($e.triggers)" } }
        if ($sql -like '*coalesce(q.p,0)*') { return @{ Codigo = 0; Salida = "$($e.incoherentes)" } }
        if ($sql -like '*count(*) from public.deudas;*') { return @{ Codigo = 0; Salida = '7' } }
        return @{ Codigo = 9; Salida = "ERROR: consulta no prevista por el doble: $($sql.Substring(0, [Math]::Min(80, $sql.Length)))" }
    }.GetNewClosure()
}
function Aplicar($resp, $e, [string]$confirmacion = 'APLICAR') {
    $ev = Join-Path $tmp ('ev-' + [guid]::NewGuid().ToString('N').Substring(0, 6))
    $leer = { param($que) if ($que -eq 'host') { 'qa.invalid' } else { $confirmacion } }.GetNewClosure()
    $msg = $null; $completo = $false
    try { & $aplicador -HostDb 'qa.invalid' -RaizRespaldo $resp.Raiz -DirEvidencia $ev -EjecutorPsql (Nuevo-Ejecutor $e) -LeerTexto $leer *> $null; $completo = $true }
    catch { $msg = "$($_.Exception.Message)" }
    $log = (Get-ChildItem $ev -Filter 'lote-produccion_*.log' | Select-Object -First 1 | Get-Content -Raw)
    return @{ completo = $completo; detenido = $msg; llamadas = $e.llamadas; transacciones = $e.transacciones; logCompleto = ($log -match 'COMPLETO\.'); log = $log }
}
$sano = $ANTIGUAS + $REQ

# ===================== F10B-01: respaldo =====================
$r = Aplicar (Nueva-Corrida) (Nuevo-Estado $sano)
Caso 'F10B-01 control: corrida real sana (estado, manifiesto, metadatos, hashes) -> se aplican 11 transacciones y COMPLETO' ($r.completo -and $r.transacciones -eq 11 -and $r.logCompleto) @{ transacciones = $r.transacciones; detenido = $r.detenido }

$raizMarcador = Join-Path $tmp 'solo-marcador'; New-Item -ItemType Directory -Force -Path $raizMarcador | Out-Null
New-Item -ItemType File -Path (Join-Path $raizMarcador 'prod_20261013T120000Z.dump.verificacion.txt') | Out-Null
$r = Aplicar @{ Raiz = $raizMarcador } (Nuevo-Estado $sano)
Caso 'F10B-01: marcador vacio sin corrida ni dump -> DETENIDO antes de conectar (0 llamadas)' (-not $r.completo -and $r.llamadas -eq 0 -and $r.detenido -match 'No hay respaldo') @{ detenido = $r.detenido; llamadas = $r.llamadas }

foreach ($c in @(
    @{ n = 'dump ausente'; prep = { param($x) Remove-Item (Join-Path $x.Corrida $x.Archivos.dump) }; p = 'Falta el archivo de dump' },
    @{ n = 'dump alterado'; prep = { param($x) Add-Content (Join-Path $x.Corrida $x.Archivos.dump) 'alterado' }; p = 'SHA-256 del dump' },
    @{ n = 'huella ausente del manifiesto'; prep = { param($x) $m = Get-Content (Join-Path $x.Corrida 'manifiesto.json') -Raw | ConvertFrom-Json; $m.archivos = @($m.archivos | Where-Object { $_.archivo -ne $x.Archivos.huella }); $m | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $x.Corrida 'manifiesto.json') }; p = 'no figura en manifiesto' },
    @{ n = 'corrida sin terminar (sin manifiesto.json)'; prep = { param($x) Remove-Item (Join-Path $x.Corrida 'manifiesto.json') }; p = 'no termino' },
    @{ n = 'metadatos sin RESULTADO OK'; prep = { param($x) Set-Content (Join-Path $x.Corrida 'metadatos-para-compartir.txt') 'METADATOS' }; p = 'no declaran' }
)) {
    $x = Nueva-Corrida; & $c.prep $x
    $r = Aplicar $x (Nuevo-Estado $sano)
    Caso "F10B-01: $($c.n) -> DETENIDO antes de conectar (0 llamadas)" (-not $r.completo -and $r.llamadas -eq 0 -and $r.detenido -match $c.p) @{ detenido = $r.detenido; llamadas = $r.llamadas }
}
foreach ($c in @(
    @{ n = 'respaldo fallido (paso2 no OK)'; o = @{ paso2ok = $false }; p = 'no completo el paso2' },
    @{ n = 'proyecto distinto'; o = @{ proyecto = 'tqkdtojnhgykmcbvwdmz' }; p = 'no acredita el proyecto' },
    @{ n = 'proyecto no registrado (respaldo anterior al cambio)'; o = @{ proyecto = $null }; p = 'no acredita el proyecto' },
    @{ n = 'respaldo vencido (30 h)'; o = @{ finUtc = (Get-Date).ToUniversalTime().AddHours(-30).ToString('o') }; p = 'mas de 24 h' },
    @{ n = 'fecha de fin invalida'; o = @{ finUtc = 'ayer' }; p = 'fecha de fin valida' }
)) {
    $r = Aplicar (Nueva-Corrida $c.o) (Nuevo-Estado $sano)
    Caso "F10B-01: $($c.n) -> DETENIDO antes de conectar (0 llamadas)" (-not $r.completo -and $r.llamadas -eq 0 -and $r.detenido -match $c.p) @{ detenido = $r.detenido; llamadas = $r.llamadas }
}
$r = Aplicar (Nueva-Corrida @{ migraciones = 20 }) (Nuevo-Estado $sano)
Caso 'F10B-01: el respaldo registra otro numero de migraciones que la base -> DETENIDO, 0 transacciones' (-not $r.completo -and $r.transacciones -eq 0 -and $r.detenido -match 'no refleja el esquema') @{ detenido = $r.detenido }

# ===================== F10B-02: lecturas inciertas =====================
foreach ($c in @(
    @{ n = 'lectura de versiones con codigo 2'; f = @{ "select 'V|'" = @{ Codigo = 2; Salida = 'ERROR: relation "supabase_migrations.schema_migrations" does not exist' } }; p = 'codigo 2' },
    @{ n = 'salida de versiones malformada'; f = @{ "select 'V|'" = @{ Codigo = 0; Salida = "V|20261002000001`nbasura`nFIN|1" } }; p = 'formato inesperado' },
    @{ n = 'cardinalidad de versiones incoherente'; f = @{ "select 'V|'" = @{ Codigo = 0; Salida = "V|20261002000001`nFIN|25" } }; p = 'cardinalidad' },
    @{ n = 'versiones sin cierre FIN (corte)'; f = @{ "select 'V|'" = @{ Codigo = 0; Salida = ($REQ | ForEach-Object { "V|$_" }) -join "`n" } }; p = 'cardinalidad' },
    @{ n = 'conteo de deudas fallido'; f = @{ 'count(*) from public.deudas;' = @{ Codigo = 1; Salida = 'ERROR: fallo ficticio' } }; p = 'deudas existentes' }
)) {
    $e = Nuevo-Estado $sano; $e.falla = $c.f
    $r = Aplicar (Nueva-Corrida) $e
    Caso "F10B-02: $($c.n) -> DETENIDO, 0 transacciones" (-not $r.completo -and $r.transacciones -eq 0 -and $r.detenido -match $c.p) @{ detenido = $r.detenido; transacciones = $r.transacciones }
}
$e = Nuevo-Estado $sano; $e.falla = @{ "version = '20261009000001'" = @{ Codigo = 2; Salida = 'ERROR: fallo ficticio' } }
$r = Aplicar (Nueva-Corrida) $e
Caso 'F10B-02: relectura del registro fallida tras la 1.a transaccion -> DETENIDO (1 transaccion, sin COMPLETO)' (-not $r.completo -and $r.transacciones -eq 1 -and -not $r.logCompleto) @{ detenido = $r.detenido }
$r = Aplicar (Nueva-Corrida) (Nuevo-Estado $sano) 'aplicar'
Caso 'F10B-02: confirmacion distinta de APLICAR -> 0 transacciones' (-not $r.completo -and $r.transacciones -eq 0) @{ detenido = $r.detenido }

# ===================== F10B-03: historico exacto =====================
$malas = 0
foreach ($requerida in $REQ) {
    $v = @($ANTIGUAS + ($REQ | Where-Object { $_ -ne $requerida }) + '20261007009999')
    $r = Aplicar (Nueva-Corrida) (Nuevo-Estado $v)
    if ($r.completo -or $r.transacciones -ne 0 -or $r.detenido -notmatch [regex]::Escape($requerida)) { $malas++ }
}
Caso 'F10B-03: sustituir CADA una de las 23 requeridas por una ajena (mismo total) -> las 23 variantes DETENIDAS, 0 transacciones' ($malas -eq 0) @{ variantesMal = $malas }
$r = Aplicar (Nueva-Corrida @{ migraciones = 27 }) (Nuevo-Estado ($ANTIGUAS + $REQ + '20261007009999' + '20261008100000'))
Caso 'F10B-03: las 23 exactas mas versiones adicionales -> aceptado (11 transacciones, COMPLETO)' ($r.completo -and $r.transacciones -eq 11) @{ detenido = $r.detenido }

# ===================== observaciones 1 y 2 =====================
$r = Aplicar (Nueva-Corrida @{ migraciones = 37 }) ((Nuevo-Estado ($sano + $NUEVAS)))
Caso 'Obs. 1: nada pendiente -> comprobacion final ejecutada y COMPLETO sin transacciones' ($r.completo -and $r.transacciones -eq 0 -and $r.log -match 'Comprobacion final') @{ detenido = $r.detenido }
$e = Nuevo-Estado ($sano + $NUEVAS); $e.triggers = 0
$r = Aplicar (Nueva-Corrida @{ migraciones = 37 }) $e
Caso 'Obs. 1: nada pendiente pero sin triggers de compatibilidad -> DETENIDO por la comprobacion final' (-not $r.completo -and $r.detenido -match 'triggers de compatibilidad=0') @{ detenido = $r.detenido }
$e = Nuevo-Estado $sano; $e.fallaTransaccion = 7
$r1 = Aplicar (Nueva-Corrida) $e
$hechas = @($e.versiones)
$e2 = Nuevo-Estado $hechas
$r2 = Aplicar (Nueva-Corrida @{ migraciones = $hechas.Count }) $e2
Caso 'Obs. 2: fallo en la 7.a transaccion (tras el par de deudas) y REPETICION -> continua donde quedo (5 transacciones) y COMPLETO' ((-not $r1.completo) -and $r1.transacciones -eq 7 -and $r2.completo -and $r2.transacciones -eq 5) @{ primera = $r1.detenido; segunda = $r2.detenido; versionesTrasFallo = $hechas.Count }
$r = Aplicar (Nueva-Corrida @{ migraciones = 26 }) (Nuevo-Estado ($sano + '20261013000001'))
Caso 'Obs. 2: 20261013000001 registrada sin 20261010000001 (hueco real) -> DETENIDO, 0 transacciones' (-not $r.completo -and $r.transacciones -eq 0 -and $r.detenido -match 'huecos') @{ detenido = $r.detenido }
$e = Nuevo-Estado $sano; $e.incoherentes = 1
$r = Aplicar (Nueva-Corrida) $e
Caso 'Comprobacion final con una deuda incoherente -> DETENIDO, sin COMPLETO' (-not $r.completo -and -not $r.logCompleto -and $r.detenido -match 'incoherentes=1') @{ detenido = $r.detenido }

# ===================== F10B-04: inventario =====================
# $ej nulo = adaptador ORIGINAL (docker/psql del script). $sal permite sembrar antes un informe anterior en esa ruta.
function Inventario([scriptblock]$ej, [string]$sal) {
    if (-not $sal) { $sal = Join-Path (Join-Path $tmp ('inv-' + [guid]::NewGuid().ToString('N').Substring(0, 6))) 'inventario.txt' }
    $msg = $null; $ok = $false
    try {
        if ($ej) { & $inventario -HostDb 'qa.invalid' -Salida $sal -EjecutorPsql $ej *> $null } else { & $inventario -HostDb 'qa.invalid' -Salida $sal *> $null }
        $ok = $true
    } catch { $msg = "$($_.Exception.Message)" }
    $lin = @(if (Test-Path $sal) { Get-Content $sal -TotalCount 2 })
    return @{ ok = $ok; error = $msg; primera = $(if ($lin.Count) { $lin[0] } else { $null }); corrida = $(if ($lin.Count -gt 1) { $lin[1] } else { $null })
        texto = $(if (Test-Path $sal) { Get-Content $sal -Raw } else { '' }); historico = @(Get-ChildItem (Join-Path (Split-Path $sal) 'historico') -File -ErrorAction SilentlyContinue) }
}
function Sembrar-Completo([string]$sal) {
    New-Item -ItemType Directory -Force -Path (Split-Path $sal) | Out-Null
    @('ESTADO|COMPLETO', 'CORRIDA|20261001T000000Z-anteri', 'servidor|17.6', 'fin|ok') | Out-File -Encoding utf8 $sal
    return (Get-FileHash $sal -Algorithm SHA256).Hash
}
$completa = @('servidor|17.6', 'solo_lectura|on', 'migraciones_total|25', 'objeto|public.deuda_pagos|false', 'funcion|guardar_cita_pos|true', 'trigger_deudas|(ninguno)',
    'deudas|3|cobradas=1|pendientes=2', 'deuda_pagos|sin tabla', 'deudas_incoherentes|sin tabla', 'cobradas_sin_pagos|sin tabla', 'recompensas_activo|false', 'conteo|productos|5', 'fotos_productos|supabase=3|r2=0', 'fin|ok') -join "`n"
foreach ($c in @(
    @{ n = 'conexion fallida (codigo 2, FATAL)'; ej = { param($s, $x) @{ Codigo = 2; Salida = 'psql: error: FATAL: fallo de conexion ficticio' } } },
    @{ n = 'proceso inexistente'; ej = { param($s, $x) throw 'docker: no se encontro el proceso (ficticio)' } },
    @{ n = 'SQL fallido a mitad (sin cierre)'; ej = { param($s, $x) @{ Codigo = 3; Salida = "servidor|17.6`nsolo_lectura|on`nmigraciones_total|25`nERROR: fallo ficticio" } } },
    @{ n = 'seccion obligatoria ausente (codigo 0)'; ej = { param($s, $x) @{ Codigo = 0; Salida = ($completa -replace "deudas\|3\|cobradas=1\|pendientes=2`n", '') } } },
    @{ n = 'sesion no declarada de solo lectura'; ej = { param($s, $x) @{ Codigo = 0; Salida = ($completa -replace 'solo_lectura\|on', 'solo_lectura|off') } } }
)) {
    $r = Inventario $c.ej
    $incompleto = (-not $r.ok) -and $r.primera -eq 'ESTADO|INCOMPLETO' -and $r.corrida -match '^CORRIDA\|'
    Caso "F10B-04: $($c.n) -> INCOMPLETO y error (sin COMPLETO)" $incompleto @{ error = $r.error; primera = $r.primera }
}
$r = Inventario { param($s, $x) @{ Codigo = 0; Salida = $completa } }
Caso 'F10B-04 control: salida completa -> ESTADO|COMPLETO, sin error' ($r.ok -and $r.primera -eq 'ESTADO|COMPLETO' -and $r.corrida -match '^CORRIDA\|') @{ error = $r.error }

# ---- F10B-04b: un arranque fallido nunca deja a la vista un COMPLETO de otra corrida ----
# Adaptador ORIGINAL con "docker" apuntando a un ejecutable inexistente (alias temporal): no se lanza Docker ni hay conexion.
$secreto = 'clave-ficticia-qa-' + [guid]::NewGuid().ToString('N').Substring(0, 8)
function Arranque-Fallido([string]$sal) {
    $env:PGPASSWORD = $secreto
    Set-Alias -Name docker -Value (Join-Path $tmp 'no-existe\docker.exe') -Scope Global
    try { return (Inventario $null $sal) } finally { Remove-Item Alias:docker -Force -ErrorAction SilentlyContinue; $env:PGPASSWORD = $null }
}
$sal = Join-Path (Join-Path $tmp 'inv-sembrado') 'inventario.txt'; $hashAnterior = Sembrar-Completo $sal
$r = Arranque-Fallido $sal
$hist = @($r.historico | Where-Object { $_.Name -match '\.anterior-' -and (Get-FileHash $_.FullName -Algorithm SHA256).Hash -eq $hashAnterior })
Caso 'F10B-04b: COMPLETO anterior + docker inexistente (adaptador original) -> error, la corrida actual queda INCOMPLETO con su id y el anterior pasa intacto a historico\*.anterior-*' ((-not $r.ok) -and $r.primera -eq 'ESTADO|INCOMPLETO' -and $r.corrida -match '^CORRIDA\|' -and $r.corrida -ne 'CORRIDA|20261001T000000Z-anteri' -and $hist.Count -eq 1 -and $r.texto -notmatch [regex]::Escape($secreto)) @{ error = $r.error; primera = $r.primera; corrida = $r.corrida; historico = @($r.historico | ForEach-Object Name) }
$sal = Join-Path (Join-Path $tmp 'inv-sin-previo') 'inventario.txt'
$r = Arranque-Fallido $sal
Caso 'F10B-04b: sin informe anterior + docker inexistente -> error e INCOMPLETO de la corrida actual, sin historico' ((-not $r.ok) -and $r.primera -eq 'ESTADO|INCOMPLETO' -and $r.corrida -match '^CORRIDA\|' -and $r.historico.Count -eq 0 -and $r.texto -notmatch [regex]::Escape($secreto)) @{ error = $r.error; primera = $r.primera }
$sal = Join-Path (Join-Path $tmp 'inv-excepcion') 'inventario.txt'; $null = Sembrar-Completo $sal
$env:PGPASSWORD = $secreto
try { $r = Inventario { param($s, $x) throw "fallo ficticio que menciona $env:PGPASSWORD" } $sal } finally { $env:PGPASSWORD = $null }
Caso 'F10B-04b: COMPLETO anterior + excepcion del ejecutor (con la clave en el mensaje) -> INCOMPLETO actual, clave ocultada en el informe' ((-not $r.ok) -and $r.primera -eq 'ESTADO|INCOMPLETO' -and $r.texto -match '\*\*\*' -and $r.texto -notmatch [regex]::Escape($secreto) -and $r.historico.Count -eq 1) @{ error = $r.error; primera = $r.primera }
$sal = Join-Path (Join-Path $tmp 'inv-psql-error') 'inventario.txt'; $null = Sembrar-Completo $sal
$r = Inventario { param($s, $x) @{ Codigo = 2; Salida = 'psql: error: FATAL: fallo de conexion ficticio' } } $sal
Caso 'F10B-04b: COMPLETO anterior + error de psql -> INCOMPLETO actual, anterior en historico' ((-not $r.ok) -and $r.primera -eq 'ESTADO|INCOMPLETO' -and $r.historico.Count -eq 1) @{ error = $r.error; primera = $r.primera }
$sal = Join-Path (Join-Path $tmp 'inv-sano') 'inventario.txt'; $null = Sembrar-Completo $sal
$r = Inventario { param($s, $x) @{ Codigo = 0; Salida = $completa } } $sal
Caso 'F10B-04b control: COMPLETO anterior + corrida sana -> COMPLETO con un id de corrida NUEVO, anterior en historico' ($r.ok -and $r.primera -eq 'ESTADO|COMPLETO' -and $r.corrida -match '^CORRIDA\|' -and $r.corrida -ne 'CORRIDA|20261001T000000Z-anteri' -and $r.historico.Count -eq 1) @{ error = $r.error; corrida = $r.corrida }

if ($ConLocal) {
    $local = { param($s, $x) $o = $s | docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' supabase_db_WedJaiseReact psql -U postgres -d postgres -X -At -v ON_ERROR_STOP=1 2>&1 | ForEach-Object { "$_" }; @{ Codigo = $LASTEXITCODE; Salida = ($o -join "`n") } }
    $r = Inventario $local
    Caso 'F10B-04 Local: esquema actual (real, solo lectura) -> COMPLETO con deuda_pagos, compatibilidad y funciones nuevas presentes' ($r.ok -and $r.primera -eq 'ESTADO|COMPLETO' -and $r.texto -match 'funcion\|productos_vitrina_publica\|true' -and $r.texto -match 'funcion\|registrar_reclamo\|true' -and $r.texto -match 'trigger_deudas\|deudas_compat_antes,deudas_compat_despues' -and $r.texto -match 'deudas_incoherentes\|0') @{ error = $r.error; primera = $r.primera }
    $ErrorActionPreference = 'Continue'
    docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres -X -q -c 'drop database if exists qa_inventario_antiguo' *> $null
    docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres -X -q -c 'create database qa_inventario_antiguo' *> $null
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key, name text); insert into supabase_migrations.schema_migrations values ('20261002000001','x');
     create table public.deudas(id uuid primary key default gen_random_uuid(), estado text, monto numeric); insert into public.deudas(estado, monto) values ('COBRADA', 10), ('PENDIENTE', 5);
     create table public.productos(id int, foto_url text); insert into public.productos values (1, 'https://x.supabase.co/storage/v1/a.png');" | docker exec -i supabase_db_WedJaiseReact psql -U postgres -d qa_inventario_antiguo -X -q *> $null
    $antiguo = { param($s, $x) $o = $s | docker exec -i -e 'PGOPTIONS=-c default_transaction_read_only=on' supabase_db_WedJaiseReact psql -U postgres -d qa_inventario_antiguo -X -At -v ON_ERROR_STOP=1 2>&1 | ForEach-Object { "$_" }; @{ Codigo = $LASTEXITCODE; Salida = ($o -join "`n") } }
    $r = Inventario $antiguo
    docker exec -i supabase_db_WedJaiseReact psql -U postgres -d postgres -X -q -c 'drop database if exists qa_inventario_antiguo' *> $null
    $ErrorActionPreference = 'Stop'
    Caso 'F10B-04 Local: esquema antiguo minimo (sin deuda_pagos ni recompensas_config) -> COMPLETO con ausencias explicitas "sin tabla"/false' ($r.ok -and $r.texto -match 'deuda_pagos\|sin tabla' -and $r.texto -match 'recompensas_activo\|sin tabla' -and $r.texto -match 'objeto\|public.deuda_pagos\|false' -and $r.texto -match 'funcion\|registrar_pago_deuda\|false') @{ error = $r.error; primera = $r.primera }
}

Remove-Item -Recurse -Force $tmp
$fallos = @($casos | Where-Object { -not $_.ok }).Count
if ($Salida) { [pscustomobject]@{ fecha = (Get-Date).ToUniversalTime().ToString('o'); total = $casos.Count; fallos = $fallos; casos = $casos } | ConvertTo-Json -Depth 6 | Set-Content -Path $Salida -Encoding UTF8 }
Write-Host ''
Write-Host "$($casos.Count - $fallos)/$($casos.Count) correctos"
if ($fallos) { exit 1 }
