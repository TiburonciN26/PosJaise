# PASO 3b - SOLO si pg_dumpall (paso 3) fue rechazado. Alternativa aprobada de SOLO LECTURA: consulta de roles (sin contrasenas).
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida; Exigir-Sesion; Exigir-Paso 'paso2'
Write-Host ''
Write-Host 'PASO 3b - Roles por consulta (alternativa de solo lectura)' -ForegroundColor Cyan
$sello = Sello-Utc
$nombre = "roles_consulta_$sello.txt"
$r = Pg 'psql' @('-At', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/roles-consulta.sql')
if ($r.Codigo -ne 0) { Detener "La consulta de roles termino con codigo $($r.Codigo): $($r.Salida)" }
$f = Join-Path $global:Dir $nombre
Set-Content -Path $f -Value $r.Salida -Encoding UTF8
$roles = ($r.Salida -split "`n" | Where-Object { $_ -like 'ROL|*' }).Count
$pert = ($r.Salida -split "`n" | Where-Object { $_ -like 'PERTENENCIA|*' }).Count
if ($roles -lt 5) { Detener "Solo se obtuvieron $roles roles." }
if ($r.Salida -match 'PASSWORD|rolpassword') { Detener 'La salida contiene texto de contrasenas.' }
$sha = Hash-Archivo $f
Ok "Roles por consulta: $roles roles, $pert pertenencias; sin contrasenas; SHA-256 $sha"
Poner-Estado 'paso3' @{ ok = $true; metodo = 'consulta'; archivo = $nombre; codigo = 0; bytes = (Get-Item $f).Length; sha256 = $sha; create_role = $roles; alter_role = 0; pertenencias = $pert; contiene_contrasenas = $false }
Write-Host ''
Write-Host 'PASO 3b COMPLETO. Siga con 04-respaldo-storage.ps1' -ForegroundColor Green
