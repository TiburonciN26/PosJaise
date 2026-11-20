# Copia los DATOS de Producción a la base Local, para reproducir en Local los fallos que reporta la
# clienta sin tocar Producción (en Producción solo se LEE: pg_dump no escribe nada).
#
# El esquema y los permisos de Local ya son iguales a Producción (implementacionesWed.md §93); esto
# reemplaza solo los datos: todas las tablas de `public` y los usuarios de login (auth.users y
# auth.identities). Las contraseñas de Producción pasan tal cual: en Local se entra con las mismas.
#
# Antes de borrar nada guarda un respaldo de los datos locales actuales en %TEMP%. Para volver a ellos:
#   powershell -ExecutionPolicy Bypass -File scripts\copiar-datos-prod-a-local.ps1 -DesdeRespaldo "<carpeta del respaldo>"
#
# Uso normal (pide la cadena de conexión y la contraseña de la base de Producción; no se guardan):
#   powershell -ExecutionPolicy Bypass -File scripts\copiar-datos-prod-a-local.ps1
#
# La cadena de conexión: Supabase > proyecto WedJaiseReact > botón "Connect" > "Session pooler".
# Se pega tal cual, con [YOUR-PASSWORD]; la contraseña se pide aparte (no se muestra en pantalla).
#
# No copia los archivos de Storage (fotos, PDFs): en Local esas imágenes no cargan. El volcado de
# Producción contiene datos personales de clientas: se borra del disco al terminar.
param([string]$DesdeRespaldo)

$ErrorActionPreference = 'Stop'
$contenedor = 'supabase_db_WedJaiseReact'

function Invoke-Docker {
  param([string[]]$Argumentos)
  & docker @Argumentos
  if ($LASTEXITCODE -ne 0) { throw "Falló: docker $($Argumentos[0..2] -join ' ') ..." }
}

$estado = (& docker inspect -f '{{.State.Running}}' $contenedor 2>$null)
if ($estado -ne 'true') { throw "La base local no está corriendo. Ejecuta primero: npx supabase start" }

$marca = Get-Date -Format 'yyyyMMdd-HHmmss'

if (-not $DesdeRespaldo) {
  # 1) Respaldo de los datos locales actuales.
  $respaldo = Join-Path $env:TEMP "jaise-respaldo-local-$marca"
  New-Item -ItemType Directory -Force $respaldo | Out-Null
  Write-Host "1/4 Respaldando los datos locales actuales en $respaldo ..."
  Invoke-Docker @('exec', $contenedor, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--schema=public', '-f', '/tmp/respaldo_public.sql')
  Invoke-Docker @('exec', $contenedor, 'pg_dump', '-U', 'supabase_admin', '-d', 'postgres', '--data-only', '--table=auth.users', '--table=auth.identities', '-f', '/tmp/respaldo_auth.sql')
  Invoke-Docker @('cp', "${contenedor}:/tmp/respaldo_public.sql", (Join-Path $respaldo 'datos_public.sql'))
  Invoke-Docker @('cp', "${contenedor}:/tmp/respaldo_auth.sql", (Join-Path $respaldo 'datos_auth.sql'))

  # 2) Volcado (solo lectura) de los datos de Producción.
  $cadena = Read-Host 'Pega la cadena "Session pooler" de Produccion (con [YOUR-PASSWORD])'
  $m = [regex]::Match($cadena.Trim(), '^postgres(?:ql)?://([^:@/]+)(?::[^@]*)?@([^:/@]+):(\d+)/([^?\s]+)')
  if (-not $m.Success) { throw 'La cadena no tiene el formato postgresql://usuario:[YOUR-PASSWORD]@host:puerto/base' }
  $usuario = $m.Groups[1].Value; $servidor = $m.Groups[2].Value; $puerto = $m.Groups[3].Value; $base = $m.Groups[4].Value
  if ($servidor -notmatch 'supabase\.(com|co)$') { throw "El servidor '$servidor' no parece de Supabase." }
  $seguro = Read-Host 'Contrasena de la base de Produccion' -AsSecureString
  $clave = [Runtime.InteropServices.Marshal]::PtrToStringBSTR([Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro))

  Write-Host "2/4 Descargando los datos de Produccion ($servidor) ..."
  $conexion = @('-h', $servidor, '-p', $puerto, '-U', $usuario, '-d', $base)
  try {
    Invoke-Docker (@('exec', '-e', "PGPASSWORD=$clave", '-e', 'PGSSLMODE=require', $contenedor, 'pg_dump') + $conexion + @('--data-only', '--schema=public', '-f', '/tmp/fuente_public.sql'))
    Invoke-Docker (@('exec', '-e', "PGPASSWORD=$clave", '-e', 'PGSSLMODE=require', $contenedor, 'pg_dump') + $conexion + @('--data-only', '--table=auth.users', '--table=auth.identities', '-f', '/tmp/fuente_auth.sql'))
  } finally {
    $clave = $null
  }
} else {
  if (-not (Test-Path (Join-Path $DesdeRespaldo 'datos_public.sql'))) { throw "No encuentro datos_public.sql en $DesdeRespaldo" }
  Write-Host "1-2/4 Usando el respaldo $DesdeRespaldo ..."
  Invoke-Docker @('cp', (Join-Path $DesdeRespaldo 'datos_public.sql'), "${contenedor}:/tmp/fuente_public.sql")
  Invoke-Docker @('cp', (Join-Path $DesdeRespaldo 'datos_auth.sql'), "${contenedor}:/tmp/fuente_auth.sql")
}

# 3) Vaciar Local y cargar los datos, todo en UNA transacción: si algo falla, Local queda como estaba.
#    session_replication_role = replica apaga triggers (auditoría, notificaciones) y revisión de FKs
#    mientras se carga, para que los datos entren tal cual vienen.
Write-Host '3/4 Reemplazando los datos locales (una sola transaccion) ...'
$vaciar = 'do $$ declare r record; begin truncate auth.users cascade; for r in select tablename from pg_tables where schemaname = ''public'' loop execute format(''truncate table public.%I cascade'', r.tablename); end loop; end $$;'
Invoke-Docker @('exec', $contenedor, 'psql', '-U', 'supabase_admin', '-d', 'postgres', '-q', '-1', '-v', 'ON_ERROR_STOP=1', '-o', '/dev/null',
  '-c', 'set client_min_messages = warning;', '-c', 'set session_replication_role = replica;', '-c', $vaciar, '-f', '/tmp/fuente_auth.sql', '-f', '/tmp/fuente_public.sql')

# 4) Limpieza: el volcado de Producción tiene datos personales; no se deja en el contenedor.
Invoke-Docker @('exec', $contenedor, 'rm', '-f', '/tmp/fuente_public.sql', '/tmp/fuente_auth.sql', '/tmp/respaldo_public.sql', '/tmp/respaldo_auth.sql')
Write-Host '4/4 Listo. Conteos en Local:'
Invoke-Docker @('exec', $contenedor, 'psql', '-U', 'postgres', '-d', 'postgres', '-t', '-A', '-c',
  'select ''usuarios: '' || (select count(*) from auth.users) || '' | clientes: '' || (select count(*) from public.clientes) || '' | citas: '' || (select count(*) from public.citas) || '' | ventas: '' || (select count(*) from public.ventas);')
if (-not $DesdeRespaldo) { Write-Host "Respaldo de tus datos locales anteriores: $respaldo" }
