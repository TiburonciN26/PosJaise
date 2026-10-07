# PASO 3 - Roles globales (pg_dump NO los guarda). pg_dumpall --roles-only SIN contrasenas. SOLO LECTURA.
# Si el servidor no lo permite, este paso se DETIENE; la alternativa aprobada es 03b-roles-consulta.ps1.
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida; Exigir-Sesion; Exigir-Paso 'paso2'
Write-Host ''
Write-Host 'PASO 3 - Roles globales' -ForegroundColor Cyan
$sello = Sello-Utc
$nombre = "roles_$sello.sql"
$c = $global:JaiseConn
$r = Pg 'pg_dumpall' @('--roles-only', '--no-role-passwords', '-h', $c.Host, '-p', "$($c.Puerto)", '-U', $c.Usuario, '-l', $c.Base, '-f', "/backup/$nombre") -SinConexion
$f = Join-Path $global:Dir $nombre
if ($r.Codigo -ne 0) {
    if (Test-Path $f) { Rename-Item -Path $f -NewName "$nombre.fallido" }
    Detener "pg_dumpall termino con codigo $($r.Codigo): $($r.Salida)`n  Es posible en Supabase alojado (sin superusuario). Alternativa de solo lectura aprobada: ejecute 03b-roles-consulta.ps1"
}
Ok 'pg_dumpall --roles-only --no-role-passwords: codigo 0'
if (-not (Test-Path $f) -or (Get-Item $f).Length -lt 500) { Detener 'El archivo de roles no existe o esta vacio.' }
$txt = Get-Content $f
$crear = ($txt | Where-Object { $_ -match '^CREATE ROLE ' }).Count
$alter = ($txt | Where-Object { $_ -match '^ALTER ROLE ' }).Count
$grant = ($txt | Where-Object { $_ -match '^GRANT ' }).Count
if ($crear -lt 5) { Detener "El archivo de roles tiene solo $crear CREATE ROLE." }
if (($txt | Where-Object { $_ -match 'PASSWORD' }).Count -gt 0) { Rename-Item -Path $f -NewName "$nombre.CON_CONTRASENAS"; Detener 'El archivo de roles contiene la palabra PASSWORD (podria traer contrasenas). Se renombro a .CON_CONTRASENAS; no lo comparta ni lo use. Avise antes de seguir.' }
$sha = Hash-Archivo $f
Ok "Roles: $crear CREATE ROLE, $alter ALTER ROLE, $grant pertenencias; sin contrasenas; SHA-256 $sha"
Poner-Estado 'paso3' @{ ok = $true; metodo = 'pg_dumpall'; archivo = $nombre; codigo = 0; bytes = (Get-Item $f).Length; sha256 = $sha; create_role = $crear; alter_role = $alter; pertenencias = $grant; contiene_contrasenas = $false }
Write-Host ''
Write-Host 'PASO 3 COMPLETO. Siga con 04-respaldo-storage.ps1' -ForegroundColor Green
