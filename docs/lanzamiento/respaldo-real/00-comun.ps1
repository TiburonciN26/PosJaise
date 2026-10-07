# Funciones comunes. No se ejecuta solo: lo cargan los otros pasos con ". .\00-comun.ps1".
# SOLO LECTURA en produccion: ningun paso escribe en la base ni en Storage.
$ErrorActionPreference = 'Stop'
$Raiz   = if ($env:JAISE_RAIZ) { $env:JAISE_RAIZ } else { 'C:\JaiseBackups\Produccion' }
$Imagen = 'public.ecr.aws/supabase/postgres:17.6.1.171'   # pg_dump/psql/pg_restore 17.6 = version del servidor de produccion
$Ref    = 'cmkelllerzjqjbsqsylc'
$Esquemas = @('public','auth','storage','supabase_migrations')
$DirSql = Join-Path $PSScriptRoot 'sql'

function Detener([string]$mensaje) {
    Write-Host ''
    Write-Host "DETENIDO: $mensaje" -ForegroundColor Red
    Write-Host 'No continue con el siguiente paso. No se ha escrito nada en produccion.' -ForegroundColor Red
    throw "DETENIDO: $mensaje"
}
function Ok([string]$mensaje) { Write-Host "  OK  $mensaje" -ForegroundColor Green }
function Info([string]$mensaje) { Write-Host "      $mensaje" }

function Cargar-Corrida {
    $marca = Join-Path $Raiz 'ultima_corrida.txt'
    if (-not (Test-Path $marca)) { Detener 'No hay corrida iniciada. Ejecute primero 01-preflight.ps1' }
    $global:Dir = (Get-Content $marca -Raw).Trim()
    if (-not (Test-Path $global:Dir)) { Detener "No existe la carpeta de la corrida: $global:Dir" }
    $global:EstadoRuta = Join-Path $global:Dir 'estado.json'
    $global:Estado = if (Test-Path $global:EstadoRuta) { Get-Content $global:EstadoRuta -Raw | ConvertFrom-Json } else { [pscustomobject]@{} }
}
function Poner-Estado([string]$clave, $valor) {
    $global:Estado | Add-Member -NotePropertyName $clave -NotePropertyValue $valor -Force
    $global:Estado | ConvertTo-Json -Depth 8 | Set-Content -Path $global:EstadoRuta -Encoding UTF8
}
function Exigir-Paso([string]$clave) {
    if (-not ($global:Estado.PSObject.Properties.Name -contains $clave) -or $global:Estado.$clave.ok -ne $true) { Detener "El paso previo '$clave' no termino bien. Repitalo antes de seguir." }
}

function Exigir-Sesion {
    if (-not $global:JaiseConn -or -not $env:PGPASSWORD) { Detener 'No hay sesion de conexion. Ejecute primero:  . .\00-iniciar-sesion.ps1' }
}

# Ejecuta una herramienta de PostgreSQL 17.6 dentro de un contenedor desechable (docker run --rm). La contrasena viaja por la
# variable de entorno PGPASSWORD (no aparece en la linea de comandos). Devuelve @{ Codigo; Salida }.
function Pg([string]$herramienta, [string[]]$argumentos, [switch]$SinConexion) {
    Exigir-Sesion
    $c = $global:JaiseConn
    $ssl = if ($c.SslMode) { $c.SslMode } else { 'require' }
    $conexion = if ($SinConexion) { @() } else { @('-h', $c.Host, '-p', "$($c.Puerto)", '-U', $c.Usuario, '-d', $c.Base) }
    $a = @('run', '--rm', '-e', 'PGPASSWORD', '-e', "PGSSLMODE=$ssl", '-v', "$($global:Dir):/backup", '-v', "$($DirSql):/sql:ro", '--entrypoint', $herramienta, $Imagen) + $conexion + $argumentos
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $salida = & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n") }
}
# Variante para herramientas que NO se conectan (p. ej. pg_restore --list sobre un archivo local).
function PgLocal([string]$herramienta, [string[]]$argumentos) {
    $a = @('run', '--rm', '-v', "$($global:Dir):/backup", '--entrypoint', $herramienta, $Imagen) + $argumentos
    $previo = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
    try { $salida = & docker @a 2>&1 | ForEach-Object { "$_" } } finally { $ErrorActionPreference = $previo }
    return @{ Codigo = $LASTEXITCODE; Salida = ($salida -join "`n") }
}
function Hash-Archivo([string]$ruta) { return (Get-FileHash -Algorithm SHA256 -Path $ruta).Hash.ToLower() }
function Sello-Utc { return (Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ') }
function Parsear-ClaveValor([string]$texto) {
    $h = @{}
    foreach ($l in ($texto -split "`n")) { $p = $l.Split('|', 2); if ($p.Count -eq 2 -and $p[0]) { $h[$p[0].Trim()] = $p[1].Trim() } }
    return $h
}
