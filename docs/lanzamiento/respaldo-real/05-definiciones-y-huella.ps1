# PASO 5 - Definiciones previas (funciones/politicas/privilegios que se reemplazaran) y huella previa de negocio. SOLO LECTURA.
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida; Exigir-Sesion; Exigir-Paso 'paso4'
Write-Host ''
Write-Host 'PASO 5 - Definiciones previas y huella previa' -ForegroundColor Cyan
$sello = Sello-Utc

$r = Pg 'psql' @('-At', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/definiciones.sql')
if ($r.Codigo -ne 0) { Detener "La consulta de definiciones termino con codigo $($r.Codigo): $($r.Salida)" }
$fd = Join-Path $global:Dir "definiciones_previas_$sello.sql"
Set-Content -Path $fd -Value $r.Salida -Encoding UTF8
$funciones = ($r.Salida -split "`n" | Where-Object { $_ -like '-- FUNCION *' }).Count
$politicas = ($r.Salida -split "`n" | Where-Object { $_ -like '-- POLITICA *' }).Count
$check = ($r.Salida -split "`n" | Where-Object { $_ -like '-- CHECK *' }).Count
if ($funciones -ne 14) { Detener "Se esperaban 14 funciones y se guardaron $funciones." }
if ($politicas -lt 2) { Detener "Se esperaban las politicas ventas_insert y movimientos_insert y hay $politicas." }
if ($check -lt 1) { Detener 'No se encontro ventas_metodo_pago_check.' }
Ok "Definiciones previas: $funciones funciones, $politicas politicas, $check CHECK"

$r = Pg 'psql' @('-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/huella.sql')
if ($r.Codigo -ne 0) { Detener "La huella previa termino con codigo $($r.Codigo): $($r.Salida)" }
$fh = Join-Path $global:Dir "huella_previa_$sello.txt"
Set-Content -Path $fh -Value $r.Salida -Encoding UTF8
$h = Parsear-ClaveValor $r.Salida
if ($h.Count -ne 17) { Detener "La huella debia tener 17 tablas y tiene $($h.Count)." }
foreach ($k in $h.Keys | Sort-Object) { Info ("{0} = {1} filas" -f $k, $h[$k].Split(':')[0]) }
Ok 'Huella previa: 17 tablas (conteo + md5 de columnas de negocio)'

Poner-Estado 'paso5' @{ ok = $true; definiciones = (Split-Path $fd -Leaf); definiciones_sha256 = (Hash-Archivo $fd); funciones = $funciones; politicas = $politicas; check = $check; huella = (Split-Path $fh -Leaf); huella_sha256 = (Hash-Archivo $fh); tablas_huella = $h.Count; huella_valores = $h }
Write-Host ''
Write-Host 'PASO 5 COMPLETO. Siga con 06-verificar-y-manifiesto.ps1' -ForegroundColor Green
