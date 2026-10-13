# Fase 10B · INVENTARIO de PRODUCCION en SOLO LECTURA (no modifica nada). Lo ejecuta el usuario: las credenciales solo existen
# en SU terminal y nunca se escriben en archivos, chats ni registros.
# Uso (PowerShell, Docker abierto):   cd C:\WedJaiseReact\docs\lanzamiento\aplicar-produccion ; .\inventario-produccion-10b.ps1
# Pide el host del Session pooler (panel de Supabase > Connect > Session pooler) y la contrasena de la base (no se muestra).
# La sesion se abre con default_transaction_read_only=on: cualquier escritura fallaria.
# Resultado: .codex\evidencia-fase10b\inventario-produccion.txt (sin secretos: versiones de migraciones, objetos presentes y
# conteos agregados). Con ese archivo Claude prepara el lote EXACTO de migraciones de la 10B.
param([string]$HostDb, [int]$Puerto = 5432, [string]$Usuario = 'postgres.cmkelllerzjqjbsqsylc', [string]$SslMode = 'require')
$ErrorActionPreference = 'Stop'
$img = 'public.ecr.aws/supabase/postgres:17.6.1.171'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$salidaDir = Join-Path $repo '.codex\evidencia-fase10b'
New-Item -ItemType Directory -Force -Path $salidaDir | Out-Null
$salida = Join-Path $salidaDir 'inventario-produccion.txt'

if ($Usuario -notmatch '\.cmkelllerzjqjbsqsylc$') { throw 'El usuario no corresponde al proyecto de produccion (cmkelllerzjqjbsqsylc).' }
if (-not $HostDb) { $HostDb = Read-Host 'Host del Session pooler (panel > Connect > Session pooler)' }
if (-not $env:PGPASSWORD) {
    $s = Read-Host 'Contrasena de la base (no se muestra)' -AsSecureString
    $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}
$consulta = @'
select 'servidor|' || current_setting('server_version');
select 'solo_lectura|' || current_setting('transaction_read_only');
select 'migracion|' || version || '|' || coalesce(name, '') from supabase_migrations.schema_migrations where version >= '20261001000000' order by version;
select 'migraciones_total|' || count(*) from supabase_migrations.schema_migrations;
select 'objeto|' || o || '|' || (to_regclass(o) is not null)::text from unnest(array['public.recompensas_config','public.deuda_pagos','public.libro_reclamaciones','public.pasarela_eventos','public.resenas_moderacion','public.cupones_gestion','public.migracion_medios_operaciones']) o;
select 'funcion|' || f || '|' || exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = f)::text
  from unnest(array['guardar_cita_pos','confirmar_pedido_productos','registrar_pago_deuda','recalcular_estado_deuda','catalogo_publico_productos','normalizar_busqueda','deudas_compat_antes','confirmar_pago_pasarela','libro_reclamaciones_registrar']) f;
select 'trigger_deudas|' || coalesce(string_agg(tgname, ',' order by tgname), '(ninguno)') from pg_trigger where tgrelid = 'public.deudas'::regclass and not tgisinternal;
select 'deudas|' || count(*) || '|cobradas=' || count(*) filter (where estado = 'COBRADA') || '|pendientes=' || count(*) filter (where estado = 'PENDIENTE') from public.deudas;
select 'conteo|' || t || '|' || (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', t), false, true, '')))[1]::text
  from unnest(array['productos','servicios','clientes','ventas','citas','pedidos_web','usuarios','asistentes','galeria_web']) t where to_regclass('public.' || t) is not null;
select 'recompensas|' || coalesce((select activo::text from public.recompensas_config where id = 1), 'sin tabla o sin fila') where to_regclass('public.recompensas_config') is not null;
select 'fotos_supabase|' || count(*) filter (where foto_url like '%supabase.co/storage%') || '|r2=' || count(*) filter (where foto_url like 'r2:%') from public.productos;
'@
$a = @('run', '--rm', '-i', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$SslMode", '-e', 'PGOPTIONS=-c default_transaction_read_only=on', '--entrypoint', 'psql', $img,
       '-h', $HostDb, '-p', "$Puerto", '-U', $Usuario, '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=0')
try {
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    $r = $consulta | & docker @a 2>&1 | ForEach-Object { "$_" }
    $ErrorActionPreference = $previo
    $texto = @("# Inventario de produccion (solo lectura) · UTC $((Get-Date).ToUniversalTime().ToString('o'))") + $r
    $texto | Out-File -Encoding utf8 $salida
    Write-Host "Listo: $salida ($($r.Count) lineas). Avise a Claude para que lo lea." -ForegroundColor Green
} finally {
    $env:PGPASSWORD = $null
}
