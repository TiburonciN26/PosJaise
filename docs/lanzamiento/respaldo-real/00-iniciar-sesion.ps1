# PASO 0 - Datos de conexion (se piden en SU terminal; nada se guarda en disco ni se imprime).
# Uso:  . .\00-iniciar-sesion.ps1
# Copie los datos de: panel de Supabase > su proyecto > boton "Connect" > "Session pooler" (puerto 5432).
# Use el POOLER EN MODO SESION (5432). El modo transaccion (6543) NO sirve para pg_dump.
$ErrorActionPreference = 'Stop'
Write-Host ''
Write-Host 'Datos de conexion (Session pooler, puerto 5432). No son secretos, salvo la contrasena.' -ForegroundColor Cyan
$h = Read-Host 'Host del pooler (ej. aws-0-us-west-2.pooler.supabase.com; copielo del panel)'
$p = Read-Host 'Puerto [5432]'; if (-not $p) { $p = '5432' }
$u = Read-Host 'Usuario (ej. postgres.cmkelllerzjqjbsqsylc)'
$b = Read-Host 'Base [postgres]'; if (-not $b) { $b = 'postgres' }
$segura = Read-Host 'Contrasena de la base (no se mostrara)' -AsSecureString
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
try { $env:PGPASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $h -or -not $u -or -not $env:PGPASSWORD) { throw 'Faltan datos. Vuelva a ejecutar este paso.' }
$global:JaiseConn = [pscustomobject]@{ Host = $h.Trim(); Puerto = [int]$p; Usuario = $u.Trim(); Base = $b.Trim(); SslMode = $(if ($env:JAISE_SSLMODE) { $env:JAISE_SSLMODE } else { 'require' }) }
Write-Host 'Sesion lista (solo en esta ventana de PowerShell). Siga con 01-preflight.ps1' -ForegroundColor Green
