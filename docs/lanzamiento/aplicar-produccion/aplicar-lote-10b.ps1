# Fase 10B - aplica EN PRODUCCION las migraciones del candidato que falten (desde 20261009000001), con psql 17.6 en Docker.
# Lo ejecuta el usuario: credenciales SOLO en su terminal. Requiere la aprobacion de Codex de los controles criticos.
# Uso (PowerShell, Docker abierto, DESPUES del respaldo real completo de docs\lanzamiento\respaldo-real\ pasos 0-6):
#   cd C:\WedJaiseReact\docs\lanzamiento\aplicar-produccion ; .\aplicar-lote-10b.ps1
#   -SoloGenerar   no se conecta: escribe el SQL exacto de cada transaccion (asumiendo que faltan las 12).
#   -Corrida <dir> carpeta corrida_<UTC> del respaldo (por defecto, la de ultima_corrida.txt en la raiz del respaldo).
#
# Garantias (V2, revision F10B-01..04 de Codex):
#  1. Archivos exactos del candidato (SHA-256).
#  2. RESPALDO REAL acreditado ANTES de pedir credenciales: la corrida del procedimiento de respaldo (estado.json, manifiesto.json,
#     metadatos-para-compartir.txt) con los pasos 1-5 OK, proyecto de produccion, pg_dump con codigo 0, fin del manifiesto hace
#     menos de 24 h (fecha de la corrida, no la de un archivo) y los SHA-256 de dump, roles, definiciones y huella recalculados
#     e iguales a los registrados en estado.json y en manifiesto.json. Un marcador suelto o un archivo vacio no sirven.
#  3. Toda lectura que autoriza cambios exige codigo 0 y una respuesta con formato y cardinalidad validos; una lectura incierta
#     DETIENE el script, nunca se interpreta como "no hay nada aplicado".
#  4. La base debe tener las 23 versiones EXACTAS del lanzamiento anterior (admite versiones adicionales, nunca en su lugar), y el
#     mismo numero de migraciones registradas que el respaldo (el respaldo refleja el esquema actual).
#  5. Pendientes = SUFIJO del orden de aplicacion real (09.., 10+13, 11.., 12..): una repeticion tras un fallo intermedio continua
#     donde quedo; un hueco detiene.
#  6. Cada migracion se aplica en UNA transaccion con el registro de su version; 20261010000001 y 20261013000001 en LA MISMA.
#  7. Confirmacion escrita APLICAR. Se detiene ante el primer fallo.
#  8. Comprobaciones finales SIEMPRE (tambien si no habia nada pendiente): 35 versiones requeridas, 2 triggers de compatibilidad
#     y 0 deudas incoherentes.
param(
    [string]$HostDb, [int]$Puerto = 5432, [string]$Usuario = 'postgres.cmkelllerzjqjbsqsylc', [string]$SslMode = 'require',
    [switch]$SoloGenerar, [string]$Corrida,
    [string]$RaizRespaldo = $(if ($env:JAISE_RAIZ) { $env:JAISE_RAIZ } else { 'C:\JaiseBackups\Produccion' }),
    [string]$DirEvidencia,
    # Solo para las pruebas sin red (probar-guardas-10b.ps1): sustituyen a docker/psql y a Read-Host.
    [scriptblock]$EjecutorPsql, [scriptblock]$LeerTexto
)
$ErrorActionPreference = 'Stop'
$img = 'public.ecr.aws/supabase/postgres:17.6.1.171'
$REF = 'cmkelllerzjqjbsqsylc'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$migraciones = Join-Path $repo 'supabase\migrations'
if (-not $DirEvidencia) { $DirEvidencia = Join-Path $repo '.codex\evidencia-fase10b' }
New-Item -ItemType Directory -Force -Path $DirEvidencia | Out-Null
$registro = Join-Path $DirEvidencia ('lote-produccion_' + (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '.log')

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
# Las 23 versiones EXACTAS del lanzamiento anterior (docs/lanzamiento/aplicar-produccion/aplicar-23-migraciones.ps1 de main).
$REQUERIDAS_PREVIAS = @('20261002000001', '20261002000002', '20261002000003', '20261002000004', '20261002000005', '20261002000006',
    '20261002000007', '20261002000008', '20261003000001', '20261003000002', '20261003000003', '20261003000004', '20261004000001',
    '20261005000001', '20261005000002', '20261005000003', '20261005000004', '20261006000001', '20261006000002', '20261007000001',
    '20261007000002', '20261008000001', '20261008000002')
$PAR_A = '20261010000001_deuda_pagos.sql'; $PAR_B = '20261013000001_deudas_compatibilidad_convivencia.sql'

function Log([string]$t) { Write-Host $t; Add-Content -Path $registro -Value $t -Encoding UTF8 }
function Detener([string]$m) {
    Log ''; Log "DETENIDO: $m"
    Log 'Lo marcado OK arriba SI quedo aplicado y registrado (cada transaccion es completa o nada). Una repeticion continua donde quedo.'
    throw "DETENIDO: $m"
}
function Version([string]$nombre) { return $nombre.Split('_')[0] }

# ---------------- 2. respaldo real ----------------
function Validar-Respaldo([string]$raiz, [string]$corrida) {
    if (-not $corrida) {
        $marca = Join-Path $raiz 'ultima_corrida.txt'
        if (-not (Test-Path $marca)) { Detener "No hay respaldo: falta $marca (ejecute el procedimiento docs\lanzamiento\respaldo-real, pasos 0-6)." }
        $corrida = (Get-Content $marca -Raw).Trim()
    }
    if (-not (Test-Path $corrida -PathType Container)) { Detener "La corrida de respaldo no existe: $corrida" }
    foreach ($a in 'estado.json', 'manifiesto.json', 'metadatos-para-compartir.txt') {
        if (-not (Test-Path (Join-Path $corrida $a))) { Detener "La corrida de respaldo no termino: falta $a (paso 6)." }
    }
    try { $estado = Get-Content (Join-Path $corrida 'estado.json') -Raw | ConvertFrom-Json; $man = Get-Content (Join-Path $corrida 'manifiesto.json') -Raw | ConvertFrom-Json }
    catch { Detener 'estado.json o manifiesto.json ilegibles.' }
    foreach ($p in 'paso1', 'paso2', 'paso3', 'paso4', 'paso5') {
        if (-not ($estado.PSObject.Properties.Name -contains $p) -or $estado.$p.ok -ne $true) { Detener "El respaldo no completo el $p." }
    }
    if ($estado.paso1.proyecto -ne $REF) { Detener "El respaldo no acredita el proyecto de produccion ($REF): proyecto='$($estado.paso1.proyecto)'." }
    if ("$($estado.paso2.codigo_pg_dump)" -ne '0' -or [int64]$estado.paso2.bytes -le 0) { Detener 'El volcado de la base no termino con codigo 0 o esta vacio.' }
    if ((Get-Content (Join-Path $corrida 'metadatos-para-compartir.txt') -Raw) -notmatch 'RESULTADO: todas las verificaciones OK') { Detener 'Los metadatos del respaldo no declaran todas las verificaciones OK.' }
    $fin = [datetime]::MinValue
    if (-not [datetime]::TryParse("$($man.fin_utc)", [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::AdjustToUniversal, [ref]$fin)) { Detener 'El manifiesto no tiene una fecha de fin valida.' }
    if ($fin -lt (Get-Date).ToUniversalTime().AddHours(-24)) { Detener "El respaldo termino hace mas de 24 h ($($man.fin_utc)). Haga uno nuevo." }
    if ($fin -gt (Get-Date).ToUniversalTime().AddMinutes(5)) { Detener "La fecha de fin del respaldo esta en el futuro ($($man.fin_utc))." }
    $requeridos = @(
        @($estado.paso2.archivo, $estado.paso2.sha256, 'dump'), @($estado.paso3.archivo, $estado.paso3.sha256, 'roles'),
        @($estado.paso5.definiciones, $estado.paso5.definiciones_sha256, 'definiciones'), @($estado.paso5.huella, $estado.paso5.huella_sha256, 'huella'))
    foreach ($r in $requeridos) {
        $ruta = Join-Path $corrida "$($r[0])"
        if (-not $r[0] -or -not (Test-Path $ruta -PathType Leaf)) { Detener "Falta el archivo de $($r[2]) del respaldo." }
        $h = (Get-FileHash -Algorithm SHA256 -Path $ruta).Hash.ToLower()
        if ($h -ne "$($r[1])".ToLower()) { Detener "El SHA-256 del $($r[2]) no coincide con el registrado en estado.json (alterado)." }
        $enMan = @($man.archivos | Where-Object { $_.archivo -eq $r[0] })
        if ($enMan.Count -ne 1 -or "$($enMan[0].sha256)".ToLower() -ne $h) { Detener "El $($r[2]) no figura en manifiesto.json con ese SHA-256." }
    }
    return [pscustomobject]@{ Corrida = (Split-Path $corrida -Leaf); FinUtc = $fin.ToString('o'); Migraciones = "$($estado.paso1.preflight.migraciones_registradas)"; UltimaVenta = "$($estado.paso1.preflight.ventas_ultimo_codigo)" }
}

# ---------------- psql ----------------
function Psql([string]$sql, [string[]]$extra = @()) {
    if ($EjecutorPsql) { return (& $EjecutorPsql $sql $extra) }
    $a = @('run', '--rm', '-i', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$SslMode", '--entrypoint', 'psql', $img, '-h', $HostDb, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres', '-X') + $extra
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $salida = $sql | & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n").Trim() }
}
# Lectura que autoriza: codigo 0 y cada linea con el patron; si no, se detiene.
function Leer([string]$sql, [string]$patron, [string]$que) {
    $r = Psql $sql @('-At', '-v', 'ON_ERROR_STOP=1')
    if ($r.Codigo -ne 0) { Detener "Lectura incierta ($que): codigo $($r.Codigo). $($r.Salida)" }
    $lineas = @("$($r.Salida)" -split "`r?`n" | Where-Object { $_ -ne '' })
    foreach ($l in $lineas) { if ($l -notmatch $patron) { Detener "Lectura incierta ($que): respuesta con formato inesperado: '$l'" } }
    return , $lineas
}
function Leer-Entero([string]$sql, [string]$que) {
    $l = Leer $sql '^\d+$' $que
    if ($l.Count -ne 1) { Detener "Lectura incierta ($que): se esperaba un unico entero y llegaron $($l.Count) lineas." }
    return [int64]$l[0]
}
# Versiones registradas: cada una V|<14 digitos> y una ultima FIN|<n> con n = numero de versiones devueltas.
function Leer-Versiones {
    $l = Leer "select 'V|' || version from supabase_migrations.schema_migrations order by version; select 'FIN|' || count(*) from supabase_migrations.schema_migrations;" '^(V\|\d{14}|FIN\|\d+)$' 'versiones registradas'
    $fin = @($l | Where-Object { $_ -like 'FIN|*' })
    $v = @($l | Where-Object { $_ -like 'V|*' } | ForEach-Object { $_.Substring(2) })
    if ($fin.Count -ne 1 -or $l[-1] -notlike 'FIN|*' -or [int]$fin[0].Substring(4) -ne $v.Count) { Detener "Lectura incierta (versiones registradas): cardinalidad no coincide ($($v.Count) versiones; cierre '$($fin -join ',')')." }
    if (@($v | Select-Object -Unique).Count -ne $v.Count) { Detener 'Lectura incierta (versiones registradas): versiones duplicadas.' }
    return , $v
}

# ---------------- plan ----------------
function Cuerpo([string]$nombre) {
    $t = [IO.File]::ReadAllText((Join-Path $migraciones $nombre)) -replace "`r`n", "`n"
    $b = [regex]::Matches($t, '(?im)^begin;[ \t]*$').Count; $c = [regex]::Matches($t, '(?im)^commit;[ \t]*$').Count
    if ($b -ne 1 -or $c -ne 1) { Detener "$nombre no tiene exactamente un begin; y un commit; de nivel superior ($b/$c)." }
    return ([regex]::Replace(([regex]::Replace($t, '(?im)^begin;[ \t]*$', '-- (begin del archivo: lo da el lote)')), '(?im)^commit;[ \t]*$', '-- (commit del archivo: lo da el lote)'))
}
function Registro([string]$nombre) {
    $n = ($nombre -replace '^\d+_', '') -replace '\.sql$', ''
    return "insert into supabase_migrations.schema_migrations(version, name) values ('$(Version $nombre)', '$n') on conflict (version) do nothing;"
}
function Transaccion([string[]]$nombres) {
    $partes = @('\set ON_ERROR_STOP on', 'begin;')
    foreach ($n in $nombres) { $partes += "-- ===== $n ====="; $partes += (Cuerpo $n); $partes += (Registro $n) }
    $partes += 'commit;'
    return ($partes -join "`n")
}
# Orden REAL de aplicacion: el par de deudas ocupa el lugar de 20261010000001.
function Orden([string[]]$nombres) {
    $o = @()
    foreach ($n in $nombres) { if ($n -eq $PAR_B) { continue }; $o += $n; if ($n -eq $PAR_A) { $o += $PAR_B } }
    return , $o
}
# Pendientes como sufijo del orden real; transacciones (el par junto si faltan ambas).
function Plan([string[]]$nombres, [string[]]$hechas) {
    $orden = Orden $nombres
    $pend = @($orden | Where-Object { $hechas -notcontains (Version $_) })
    if ($pend.Count) {
        $primero = [array]::IndexOf($orden, $pend[0])
        $cola = @($orden[$primero..($orden.Count - 1)])
        if (Compare-Object $cola $pend) { Detener "Las pendientes no son un sufijo del orden de aplicacion (hay huecos): pendientes=$($pend -join ', ')" }
    }
    $plan = @()
    foreach ($n in $pend) {
        if ($n -eq $PAR_B -and ($pend -contains $PAR_A)) { continue }
        if ($n -eq $PAR_A) { $plan += , @($PAR_A, $PAR_B) } else { $plan += , @($n) }
    }
    return , $plan
}

# ---------------- comprobaciones finales ----------------
function Comprobar-Final([string[]]$nombres) {
    $v = Leer-Versiones
    $faltan = @(@($REQUERIDAS_PREVIAS) + @($nombres | ForEach-Object { Version $_ }) | Where-Object { $v -notcontains $_ })
    if ($faltan.Count) { Detener "Comprobacion final: faltan versiones $($faltan -join ', ')" }
    $t = Leer-Entero "select count(*) from pg_trigger where tgrelid = 'public.deudas'::regclass and tgname in ('deudas_compat_antes','deudas_compat_despues');" 'triggers de compatibilidad'
    $i = Leer-Entero "select count(*) from public.deudas d left join (select deuda_id, sum(monto) p from public.deuda_pagos group by deuda_id) q on q.deuda_id = d.id where (d.estado = 'COBRADA' and coalesce(q.p,0) < d.monto) or (d.estado = 'PENDIENTE' and coalesce(q.p,0) > 0 and coalesce(q.p,0) >= d.monto);" 'deudas incoherentes'
    if ($t -ne 2 -or $i -ne 0) { Detener "Comprobacion final: triggers de compatibilidad=$t (se esperan 2), deudas incoherentes=$i (se espera 0)." }
    Log "OK  Comprobacion final: $($REQUERIDAS_PREVIAS.Count + $nombres.Count) versiones requeridas presentes - triggers de compatibilidad: 2 - deudas incoherentes: 0"
}

# ================= ejecucion =================
Log "== Lote 10B en produccion. UTC $((Get-Date).ToUniversalTime().ToString('o')) =="
$nombres = @()
foreach ($e in $esperadas) {
    $n, $h = $e.Split('|'); $f = Join-Path $migraciones $n
    if (-not (Test-Path $f)) { Detener "Falta $n" }
    if ((Get-FileHash $f -Algorithm SHA256).Hash.ToLower() -ne $h) { Detener "$n no es el del candidato (SHA-256 distinto)." }
    $nombres += $n
}
Log "OK  Los $($nombres.Count) archivos son los del candidato (SHA-256 verificado)"

if ($SoloGenerar) {
    $dir = Join-Path $DirEvidencia 'lote-produccion'; New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $i = 0
    foreach ($t in (Plan $nombres @())) { $i++; $sal = Join-Path $dir ('{0:00}_{1}' -f $i, ($t -join '+')); [IO.File]::WriteAllText($sal, (Transaccion $t), (New-Object Text.UTF8Encoding($false))); Log "GEN $sal" }
    Log 'SoloGenerar: no se conecto a ninguna base.'
    return
}

$resp = Validar-Respaldo $RaizRespaldo $Corrida
Log "OK  Respaldo real acreditado: $($resp.Corrida) (fin $($resp.FinUtc); dump, roles, definiciones y huella con SHA-256 verificado)"
if ($Usuario -notmatch "\.$REF`$") { Detener 'El usuario no corresponde al proyecto de produccion.' }
if (-not $HostDb) { $HostDb = if ($LeerTexto) { & $LeerTexto 'host' } else { Read-Host 'Host del Session pooler (panel > Connect > Session pooler)' } }
if (-not $env:PGPASSWORD -and -not $EjecutorPsql) {
    $s = Read-Host 'Contrasena de la base (no se muestra)' -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
try {
    # 4. Estado previo (lecturas estrictas)
    $hechas = Leer-Versiones
    $faltanPrevias = @($REQUERIDAS_PREVIAS | Where-Object { $hechas -notcontains $_ })
    if ($faltanPrevias.Count) { Detener "Faltan versiones del lanzamiento anterior: $($faltanPrevias -join ', '). No se toca nada." }
    Log "OK  Las 23 versiones exactas del lanzamiento anterior estan registradas ($($hechas.Count) en total)"
    if ($resp.Migraciones -notmatch '^\d+$') { Detener 'El respaldo no registra cuantas migraciones tenia la base.' }
    if ($hechas.Count -ne [int]$resp.Migraciones) { Detener "La base tiene $($hechas.Count) migraciones registradas y el respaldo $($resp.Migraciones): el respaldo no refleja el esquema actual." }
    if ($resp.UltimaVenta) {
        if ($resp.UltimaVenta -notmatch '^[A-Za-z0-9-]+$') { Detener 'Codigo de venta del respaldo con formato inesperado.' }
        if ((Leer-Entero "select count(*) from public.ventas where codigo = '$($resp.UltimaVenta)';" 'venta del respaldo') -ne 1) { Detener 'La ultima venta del respaldo no existe en esta base: el respaldo no es de esta base.' }
    }
    Log 'OK  El respaldo corresponde a esta base y a su esquema actual'
    $plan = Plan $nombres $hechas
    if (-not $plan.Count) {
        Log 'Nada pendiente: produccion ya tiene todas las migraciones del candidato. Se verifica el backend igualmente.'
        Comprobar-Final $nombres
        return
    }
    Log "Pendientes en $($plan.Count) transacciones:"
    foreach ($t in $plan) { Log ('   - ' + ($t -join '  +  ')) }
    $nDeudas = Leer-Entero 'select count(*) from public.deudas;' 'deudas existentes'
    Log "Deudas existentes: $nDeudas"

    Write-Host ''
    Write-Host 'Se van a aplicar estas transacciones en PRODUCCION.' -ForegroundColor Yellow
    $conf = if ($LeerTexto) { & $LeerTexto 'confirmacion' } else { Read-Host 'Escriba APLICAR para continuar' }
    if ($conf -cne 'APLICAR') { Detener 'No se confirmo. No se aplico nada.' }

    $i = 0
    foreach ($t in $plan) {
        $i++
        $r = Psql (Transaccion $t) @('-q')
        if ($r.Codigo -ne 0) { Log "ERR $($t -join ' + ')"; Log $r.Salida; Detener "La transaccion $i de $($plan.Count) fallo y se deshizo entera: $($t -join ' + ')." }
        foreach ($n in $t) {
            if ((Leer-Entero "select count(*) from supabase_migrations.schema_migrations where version = '$(Version $n)';" "registro de $(Version $n)") -ne 1) { Detener "La version $(Version $n) no quedo registrada." }
        }
        Log ("OK  {0}/{1}  {2}" -f $i, $plan.Count, ($t -join '  +  '))
    }
    Comprobar-Final $nombres
    Log ''
    Log 'COMPLETO. Avise a Claude para verificar el backend en solo lectura antes de publicar el frontend.'
} finally {
    if (-not $EjecutorPsql) { $env:PGPASSWORD = $null }
}
