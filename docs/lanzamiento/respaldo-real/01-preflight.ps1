# PASO 1 - Pre-vuelo de conexion y permisos. SOLO LECTURA en produccion.
# Uso:  .\01-preflight.ps1      (antes: . .\00-iniciar-sesion.ps1)
. "$PSScriptRoot\00-comun.ps1"
Exigir-Sesion
Write-Host ''
Write-Host 'PASO 1 - Pre-vuelo (solo lectura)' -ForegroundColor Cyan

# 1. Docker e imagen con pg_dump 17.6
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Detener 'Docker no esta en marcha. Abra Docker Desktop y repita.' }
Ok 'Docker en marcha'
& docker image inspect $Imagen *> $null
if ($LASTEXITCODE -ne 0) {
    Info "Descargando la imagen $Imagen (herramientas PostgreSQL 17.6, software publico)..."
    & docker pull $Imagen
    if ($LASTEXITCODE -ne 0) { Detener 'No se pudo descargar la imagen de herramientas.' }
}
Ok "Herramientas PostgreSQL 17.6 disponibles ($Imagen)"

# 2. Carpeta privada, fuera del repositorio y de carpetas sincronizadas
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$sincronizadas = @($env:OneDrive, $env:OneDriveConsumer, $env:OneDriveCommercial) | Where-Object { $_ }
foreach ($s in $sincronizadas) { if ($Raiz.StartsWith($s, [StringComparison]::OrdinalIgnoreCase)) { Detener "La carpeta $Raiz esta dentro de una carpeta sincronizada ($s)." } }
if ($Raiz -match 'OneDrive|Dropbox|Google Drive|iCloud|Sync') { Detener "La ruta $Raiz parece una carpeta sincronizada." }
if ($Raiz.StartsWith($repo, [StringComparison]::OrdinalIgnoreCase)) { Detener "La carpeta $Raiz esta dentro del repositorio ($repo)." }
New-Item -ItemType Directory -Force -Path $Raiz | Out-Null
& icacls $Raiz /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" | Out-Null
if ($LASTEXITCODE -ne 0) { Detener 'No se pudo restringir el acceso de la carpeta a su usuario (icacls).' }
Ok "Carpeta privada lista: $Raiz (solo su usuario)"
$dir = Join-Path $Raiz ('corrida_' + (Sello-Utc))
New-Item -ItemType Directory -Force -Path $dir | Out-Null
Set-Content -Path (Join-Path $Raiz 'ultima_corrida.txt') -Value $dir -Encoding ASCII
Cargar-Corrida
Poner-Estado 'inicio_utc' ((Get-Date).ToUniversalTime().ToString('o'))
Info "Corrida: $global:Dir"

# 3. Conexion
$r = Pg 'psql' @('-At', '-c', 'select 1')
if ($r.Codigo -ne 0 -or $r.Salida.Trim() -ne '1') { Detener "No se pudo conectar (codigo $($r.Codigo)). Revise host, puerto, usuario y contrasena. Detalle: $($r.Salida)" }
Ok 'Conexion correcta'

# 4. Permisos y estado (solo lectura)
$r = Pg 'psql' @('-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/preflight.sql')
if ($r.Codigo -ne 0) { Detener "La consulta de pre-vuelo fallo (codigo $($r.Codigo)): $($r.Salida)" }
Set-Content -Path (Join-Path $global:Dir 'preflight.txt') -Value $r.Salida -Encoding UTF8
$v = Parsear-ClaveValor $r.Salida
foreach ($k in $v.Keys | Sort-Object) { Info ("{0} = {1}" -f $k, $v[$k]) }
if (-not $v['version_servidor'].StartsWith('17.')) { Detener "El servidor no es PostgreSQL 17.x ($($v['version_servidor'])); las herramientas son 17.6." }
if ($v['esquemas_presentes'] -ne '4') { Detener "Faltan esquemas: se esperaban 4 y hay $($v['esquemas_presentes'])." }
if ($v['esquemas_sin_uso'] -ne '0') { Detener "El usuario no tiene USAGE en $($v['esquemas_sin_uso']) esquema(s) a respaldar." }
if ($v['tablas_no_legibles'] -ne '0') { Detener "El usuario no puede leer $($v['tablas_no_legibles']) tabla(s)/vista(s): el respaldo estaria incompleto." }
if ($v['secuencias_no_legibles'] -ne '0') { Detener "El usuario no puede leer $($v['secuencias_no_legibles']) secuencia(s)." }
Ok 'Permisos de lectura suficientes sobre los 4 esquemas'

# 5. Pre-vuelo del volcado: solo estructura, a un archivo local
$args5 = @('--schema-only', '--format=plain', '--file=/backup/preflight_schema_only.sql') + ($Esquemas | ForEach-Object { "--schema=$_" })
$r = Pg 'pg_dump' $args5
if ($r.Codigo -ne 0) { Detener "pg_dump --schema-only termino con codigo $($r.Codigo): $($r.Salida)" }
$f = Join-Path $global:Dir 'preflight_schema_only.sql'
if (-not (Test-Path $f) -or (Get-Item $f).Length -lt 1000) { Detener 'El archivo de pre-vuelo del volcado no existe o esta vacio.' }
$tablas = (Select-String -Path $f -Pattern '^CREATE TABLE ' -AllMatches).Count
if ($tablas -lt 10) { Detener "El pre-vuelo contiene solo $tablas tablas: algo no esta bien." }
Ok "pg_dump --schema-only: codigo 0, $((Get-Item $f).Length) bytes, $tablas tablas"

Poner-Estado 'paso1' @{ ok = $true; version_servidor = $v['version_servidor']; preflight = $v; preflight_schema_only_bytes = (Get-Item $f).Length; tablas_en_preflight = $tablas }
Write-Host ''
Write-Host 'PASO 1 COMPLETO. Siga con 02-respaldo-base.ps1' -ForegroundColor Green
