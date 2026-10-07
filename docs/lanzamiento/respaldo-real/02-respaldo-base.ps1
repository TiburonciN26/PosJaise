# PASO 2 - Respaldo de la base de datos (pg_dump, formato custom). SOLO LECTURA en produccion.
# Conserva propietarios y privilegios (NO usa --no-owner ni --no-acl).
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida; Exigir-Sesion; Exigir-Paso 'paso1'
Write-Host ''
Write-Host 'PASO 2 - Respaldo de la base de datos' -ForegroundColor Cyan
$sello = Sello-Utc
$nombre = "prod_$sello.dump"
$args2 = @('--format=custom', "--file=/backup/$nombre") + ($Esquemas | ForEach-Object { "--schema=$_" })
$r = Pg 'pg_dump' $args2
if ($r.Codigo -ne 0) { Detener "pg_dump termino con codigo $($r.Codigo): $($r.Salida)" }
Ok 'pg_dump: codigo 0'

$f = Join-Path $global:Dir $nombre
if (-not (Test-Path $f)) { Detener "No se creo el archivo $nombre." }
$bytes = (Get-Item $f).Length
if ($bytes -lt 50000) { Detener "El archivo es sospechosamente pequeno ($bytes bytes)." }
$sha = Hash-Archivo $f
Ok "Archivo creado: $nombre ($bytes bytes)"
Ok "SHA-256: $sha"

# Lectura del archivo (NO restaura nada): lista de contenido y estructura
$r = PgLocal 'pg_restore' @('--list', "/backup/$nombre")
if ($r.Codigo -ne 0) { Detener "pg_restore --list termino con codigo $($r.Codigo): $($r.Salida)" }
Set-Content -Path (Join-Path $global:Dir "lista_$sello.txt") -Value $r.Salida -Encoding UTF8
$lineas = $r.Salida -split "`n"
$entradas = ($lineas | Where-Object { $_ -match '^\d+;' }).Count
$acl = ($lineas | Where-Object { $_ -match ' ACL ' }).Count
$datos = ($lineas | Where-Object { $_ -match ' TABLE DATA ' }).Count
$cabecera = ($lineas | Where-Object { $_ -match 'Dumped from database version|Dumped by pg_dump version' }) -join ' / '
if ($entradas -lt 500) { Detener "El archivo tiene solo $entradas entradas." }
if ($acl -lt 1) { Detener 'El archivo no contiene entradas ACL (privilegios).' }
if ($datos -lt 1) { Detener 'El archivo no contiene datos de tablas.' }
if ($cabecera -notmatch 'Dumped by pg_dump version: 17\.') { Detener "Cabecera inesperada: $cabecera" }
Ok "pg_restore --list: codigo 0, $entradas entradas, $acl ACL, $datos tablas con datos"
Info $cabecera

$r = PgLocal 'pg_restore' @('--schema-only', '-f', '/backup/esquema_desde_dump.sql', "/backup/$nombre")
if ($r.Codigo -ne 0) { Detener "pg_restore --schema-only termino con codigo $($r.Codigo): $($r.Salida)" }
$esq = Join-Path $global:Dir 'esquema_desde_dump.sql'
$owner = (Select-String -Path $esq -Pattern 'OWNER TO' -AllMatches).Count
$grants = (Select-String -Path $esq -Pattern '^(GRANT|REVOKE) ' -AllMatches).Count
if ($owner -lt 1) { Detener 'El archivo no contiene propietarios (OWNER TO).' }
Ok "Propietarios: $owner sentencias OWNER TO; privilegios: $grants GRANT/REVOKE"

Poner-Estado 'paso2' @{ ok = $true; archivo = $nombre; codigo_pg_dump = 0; bytes = $bytes; sha256 = $sha; entradas_toc = $entradas; entradas_acl = $acl; tablas_con_datos = $datos; owner_to = $owner; grant_revoke = $grants; cabecera = $cabecera }
Write-Host ''
Write-Host 'PASO 2 COMPLETO. Siga con 03-respaldo-roles.ps1' -ForegroundColor Green
