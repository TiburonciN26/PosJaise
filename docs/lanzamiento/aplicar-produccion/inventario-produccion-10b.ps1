# Fase 10B - INVENTARIO de PRODUCCION en SOLO LECTURA (no modifica nada). Lo ejecuta el usuario: las credenciales solo existen
# en SU terminal y nunca se escriben en archivos, chats ni registros.
# Uso (PowerShell, Docker abierto):   cd C:\WedJaiseReact\docs\lanzamiento\aplicar-produccion ; .\inventario-produccion-10b.ps1
# Pide el host del Session pooler (panel de Supabase > Connect > Session pooler) y la contrasena de la base (no se muestra).
# La sesion se abre con default_transaction_read_only=on: cualquier escritura fallaria.
# Resultado: .codex\evidencia-fase10b\inventario-produccion.txt (sin secretos: versiones de migraciones, objetos presentes y
# conteos agregados).
# V2 (F10B-04 de Codex): ON_ERROR_STOP=1; el informe declara en su primera linea COMPLETO o INCOMPLETO. Es COMPLETO solo si psql
# termina con codigo 0, la sesion es de solo lectura y estan todas las secciones obligatorias y el cierre "fin|ok". Si no, se
# conserva el diagnostico, NO se presentan las ausencias como datos y el script termina con error. Las tablas opcionales se
# consultan sin referenciarlas antes de comprobar que existen (query_to_xml dentro de un CASE).
# V2.1 (F10B-04b): la segunda linea es "CORRIDA|<id>". El informe anterior se mueve a historico\ y el de la corrida actual
# empieza como INCOMPLETO "en curso", asi que un arranque fallido nunca deja a la vista un COMPLETO de otra corrida.
param(
    [string]$HostDb, [int]$Puerto = 5432, [string]$Usuario = 'postgres.cmkelllerzjqjbsqsylc', [string]$SslMode = 'require',
    [string]$Salida,
    # Solo para las pruebas sin red (probar-guardas-10b.ps1): sustituye a docker/psql.
    [scriptblock]$EjecutorPsql
)
$ErrorActionPreference = 'Stop'
$img = 'public.ecr.aws/supabase/postgres:17.6.1.171'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
if (-not $Salida) { $Salida = Join-Path $repo '.codex\evidencia-fase10b\inventario-produccion.txt' }
New-Item -ItemType Directory -Force -Path (Split-Path $Salida) | Out-Null

# F10B-04b de Codex: el archivo de salida es SIEMPRE el de esta corrida. Un informe anterior se mueve al historico (con
# "anterior" en el nombre) y, antes de cualquier otro paso, se escribe un INCOMPLETO "en curso" con el id de la corrida. Si el
# arranque o la ejecucion fallan (Docker ausente, excepcion, Ctrl+C), el archivo nunca conserva un COMPLETO de otra corrida.
$corrida = (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') + '-' + [guid]::NewGuid().ToString('N').Substring(0, 6)
if (Test-Path $Salida) {
    $historico = Join-Path (Split-Path $Salida) 'historico'
    New-Item -ItemType Directory -Force -Path $historico | Out-Null
    $base = [IO.Path]::GetFileNameWithoutExtension($Salida)
    $marca = (Get-Item $Salida).LastWriteTimeUtc.ToString('yyyyMMddTHHmmssZ')
    Move-Item -Force $Salida (Join-Path $historico "$base.anterior-$marca-$($corrida.Substring(17)).txt")
}
function Escribir-Incompleto([string[]]$motivos, [string[]]$recibido = @()) {
    $t = @('ESTADO|INCOMPLETO', "CORRIDA|$corrida", "# Inventario de produccion (solo lectura) - UTC $((Get-Date).ToUniversalTime().ToString('o'))",
        '# INCOMPLETO: las ausencias de este informe NO son datos confirmados. Diagnostico:')
    $t += ($motivos | ForEach-Object { "# - $_" })
    if ($recibido.Count) { $t += '# Salida recibida (diagnostico):'; $t += ($recibido | ForEach-Object { "#   $_" }) }
    $t | Out-File -Encoding utf8 $Salida
}
# Nunca escribir la contrasena en un diagnostico, aunque un mensaje de error la incluyera.
function Sin-Secretos([string]$s) { if ($env:PGPASSWORD) { return $s.Replace($env:PGPASSWORD, '***') } else { return $s } }
Escribir-Incompleto @('corrida en curso o interrumpida antes de terminar')

if ($Usuario -notmatch '\.cmkelllerzjqjbsqsylc$') {
    Escribir-Incompleto @('el usuario no corresponde al proyecto de produccion')
    throw 'El usuario no corresponde al proyecto de produccion (cmkelllerzjqjbsqsylc).'
}
# Valor de una tabla opcional SIN referenciarla si no existe: query_to_xml solo se evalua en la rama del CASE que aplica.
function Opcional([string]$tabla, [string]$sql) {
    return "coalesce(case when to_regclass('public.$tabla') is null then 'sin tabla' else (xpath('/row/v/text()', query_to_xml(`$q`$$sql`$q`$, false, true, '')))[1]::text end, 'sin fila')"
}
# V2.2: el Session pooler (Supavisor) NO reenvia PGOPTIONS, asi que la solo lectura se impone en el propio SQL: todo va en una
# transaccion READ ONLY que termina en ROLLBACK (QUIET evita las lineas BEGIN/ROLLBACK). PGOPTIONS se mantiene como refuerzo.
$consulta = @"
\set QUIET 1
begin transaction read only;
select 'servidor|' || current_setting('server_version');
select 'solo_lectura|' || current_setting('transaction_read_only');
select 'migracion|' || version || '|' || coalesce(name, '') from supabase_migrations.schema_migrations where version >= '20261001000000' order by version;
select 'migraciones_total|' || count(*) from supabase_migrations.schema_migrations;
select 'objeto|' || o || '|' || (to_regclass(o) is not null)::text from unnest(array['public.recompensas_config','public.deuda_pagos','public.libro_reclamaciones','public.pasarela_eventos','public.resenas_moderacion','public.cupones_gestion']) o;
select 'funcion|' || f || '|' || exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f)::text
  from unnest(array['guardar_cita_pos','confirmar_pedido_productos','recompensas_establecer_activo','registrar_pago_deuda','recalcular_estado_deuda','anular_pago_deuda',
    'productos_categorias_publicas','productos_vitrina_publica','servicios_categorias_publicas','servicios_vitrina_publica','normalizar_busqueda',
    'registrar_reclamo','responder_reclamo','confirmar_pago_pasarela_pedido','verificar_pago_pedido_web','migracion_medios_cambiar','deudas_compat_antes','deudas_compat_despues']) f;
select 'trigger_deudas|' || coalesce((select string_agg(tgname, ',' order by tgname) from pg_trigger where tgrelid = 'public.deudas'::regclass and not tgisinternal), '(ninguno)');
select 'deudas|' || count(*) || '|cobradas=' || count(*) filter (where estado = 'COBRADA') || '|pendientes=' || count(*) filter (where estado = 'PENDIENTE') from public.deudas;
select 'deuda_pagos|' || $(Opcional 'deuda_pagos' 'select count(*) as v from public.deuda_pagos');
select 'deudas_incoherentes|' || $(Opcional 'deuda_pagos' "select count(*) as v from public.deudas d left join (select deuda_id, sum(monto) p from public.deuda_pagos group by deuda_id) q on q.deuda_id = d.id where (d.estado = 'COBRADA' and coalesce(q.p,0) < d.monto) or (d.estado = 'PENDIENTE' and coalesce(q.p,0) > 0 and coalesce(q.p,0) >= d.monto)");
select 'cobradas_sin_pagos|' || $(Opcional 'deuda_pagos' "select count(*) as v from public.deudas d where d.estado = 'COBRADA' and not exists (select 1 from public.deuda_pagos p where p.deuda_id = d.id)");
select 'recompensas_activo|' || $(Opcional 'recompensas_config' 'select activo::text as v from public.recompensas_config where id = 1');
select 'conteo|' || t || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
  from unnest(array['productos','servicios','clientes','ventas','citas','pedidos_web','usuarios','asistentes','galeria_web']) t where to_regclass('public.' || t) is not null;
select 'fotos_productos|supabase=' || count(*) filter (where foto_url like '%supabase.co/storage%') || '|r2=' || count(*) filter (where foto_url like 'r2:%') from public.productos;
select 'fin|ok';
rollback;
"@
$OBLIGATORIAS = @('servidor', 'solo_lectura', 'migraciones_total', 'objeto', 'funcion', 'trigger_deudas', 'deudas', 'deuda_pagos', 'deudas_incoherentes', 'recompensas_activo', 'conteo', 'fotos_productos', 'fin')

function Ejecutar([string]$sql) {
    if ($EjecutorPsql) { return (& $EjecutorPsql $sql @()) }
    $a = @('run', '--rm', '-i', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$SslMode", '-e', 'PGOPTIONS=-c default_transaction_read_only=on', '--entrypoint', 'psql', $img,
        '-h', $HostDb, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1')
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $r = $sql | & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($r -join "`n") }
}

if (-not $EjecutorPsql) {
    if (-not $HostDb) { $HostDb = Read-Host 'Host del Session pooler (panel > Connect > Session pooler)' }
    if (-not $env:PGPASSWORD) {
        $s = Read-Host 'Contrasena de la base (no se muestra)' -AsSecureString
        $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
    }
}
try {
    try { $r = Ejecutar $consulta } catch {
        $m = Sin-Secretos "$($_.Exception.Message)"
        Escribir-Incompleto @("no se pudo iniciar o ejecutar psql: $m")
        Write-Host "INVENTARIO INCOMPLETO: no se pudo iniciar o ejecutar psql. Diagnostico en $Salida" -ForegroundColor Red
        throw "INVENTARIO INCOMPLETO: no se pudo iniciar o ejecutar psql: $m"
    }
    $lineas = @("$($r.Salida)" -split "`r?`n" | Where-Object { $_ -ne '' })
    $secciones = @($lineas | ForEach-Object { ($_ -split '\|')[0] } | Select-Object -Unique)
    $problemas = @()
    if ($r.Codigo -ne 0) { $problemas += "psql termino con codigo $($r.Codigo)" }
    foreach ($o in $OBLIGATORIAS) { if ($secciones -notcontains $o) { $problemas += "falta la seccion obligatoria '$o'" } }
    if ($lineas.Count -and $lineas[-1] -ne 'fin|ok') { $problemas += 'la salida no termina en "fin|ok" (corte o error intermedio)' }
    if (@($lineas | Where-Object { $_ -eq 'solo_lectura|on' }).Count -ne 1) { $problemas += 'la sesion no se declaro de solo lectura (solo_lectura|on)' }
    if ($problemas.Count) {
        Escribir-Incompleto $problemas @($lineas | ForEach-Object { Sin-Secretos $_ })
    } else {
        @('ESTADO|COMPLETO', "CORRIDA|$corrida", "# Inventario de produccion (solo lectura) - UTC $((Get-Date).ToUniversalTime().ToString('o'))") + $lineas |
            Out-File -Encoding utf8 $Salida
    }
    if ($problemas.Count) {
        Write-Host "INVENTARIO INCOMPLETO: $($problemas -join '; '). Diagnostico en $Salida" -ForegroundColor Red
        throw "INVENTARIO INCOMPLETO: $($problemas -join '; ')"
    }
    Write-Host "Inventario COMPLETO (corrida $corrida): $Salida ($($lineas.Count) lineas). Avise a Claude para que lo lea." -ForegroundColor Green
} finally {
    if (-not $EjecutorPsql) { $env:PGPASSWORD = $null }
}
