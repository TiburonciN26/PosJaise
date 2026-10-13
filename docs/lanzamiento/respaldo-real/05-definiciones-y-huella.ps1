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
$lineas = @($r.Salida -split "`r?`n")
$funciones = ($lineas | Where-Object { $_ -like '-- FUNCION *' }).Count
$check = ($lineas | Where-Object { $_ -like '-- CHECK *' }).Count
if ($funciones -ne 14) { Detener "Se esperaban 14 funciones y se guardaron $funciones." }
if ($check -lt 1) { Detener 'No se encontro ventas_metodo_pago_check.' }

# Politicas: se guardan las presentes y se registran las AUSENTES de forma explicita, validando tabla y nombre exactos.
# movimientos_insert puede faltar solo si 20261002000008 (que la elimina) esta registrada; ventas_insert existe siempre
# (20261002000007 la reemplaza en la misma transaccion). Cualquier otro estado se detiene: no se baja el conteo a ciegas.
$tablas = @($lineas | Where-Object { $_ -like '-- TABLA AUSENTE *' })
if ($tablas.Count) { Detener "Falta la tabla de una politica esperada: $($tablas -join '; ')" }
$fuera = @($lineas | Where-Object { $_ -like '-- POLITICA FUERA DE LUGAR *' })
if ($fuera.Count) { Detener "Hay politicas con el nombre esperado en otra tabla o esquema: $($fuera -join '; ')" }
$m08 = @($lineas | Where-Object { $_ -match '^-- MIGRACION 20261002000008 registrada=(true|false)$' })
if ($m08.Count -ne 1) { Detener 'No se pudo leer si la migracion 20261002000008 esta registrada.' }
$registrada08 = $m08[0].EndsWith('=true')
$detallePoliticas = [ordered]@{}
foreach ($e in @(@('public.movimientos_stock', 'movimientos_insert'), @('public.ventas', 'ventas_insert'))) {
    $nombre = "$($e[0]).$($e[1])"
    $presente = @($lineas | Where-Object { $_ -like "-- POLITICA $nombre cmd=*" })
    $ausente = @($lineas | Where-Object { $_ -eq "-- POLITICA AUSENTE $nombre" })
    if ($presente.Count + $ausente.Count -ne 1) { Detener "La politica $nombre debia figurar una vez (presente o ausente) y figura $($presente.Count + $ausente.Count)." }
    if ($presente.Count -and $presente[0] -notlike "-- POLITICA $nombre cmd=INSERT *") { Detener "La politica $nombre no es de INSERT: $($presente[0].Substring(0, [Math]::Min(120, $presente[0].Length)))" }
    $detallePoliticas[$nombre] = if ($presente.Count) { 'presente' } else { 'ausente' }
}
if ($detallePoliticas['public.ventas.ventas_insert'] -eq 'ausente') { Detener 'Falta public.ventas.ventas_insert: ninguna migracion la elimina; estado desconocido.' }
if ($detallePoliticas['public.movimientos_stock.movimientos_insert'] -eq 'ausente' -and -not $registrada08) {
    Detener 'Falta public.movimientos_stock.movimientos_insert pero 20261002000008 (que la elimina) no esta registrada; estado desconocido.'
}
if ($detallePoliticas['public.movimientos_stock.movimientos_insert'] -eq 'presente' -and $registrada08) {
    Detener '20261002000008 esta registrada pero public.movimientos_stock.movimientos_insert sigue existiendo; estado incoherente.'
}
$politicas = @($detallePoliticas.Values | Where-Object { $_ -eq 'presente' }).Count
$ausentes = @($detallePoliticas.Keys | Where-Object { $detallePoliticas[$_] -eq 'ausente' })
foreach ($k in $detallePoliticas.Keys) { Info "Politica $k = $($detallePoliticas[$k])" }
Ok "Definiciones previas: $funciones funciones, $politicas politicas presentes, $($ausentes.Count) ausentes registradas, $check CHECK (20261002000008 registrada=$registrada08)"

$r = Pg 'psql' @('-At', '-F', '|', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/huella.sql')
if ($r.Codigo -ne 0) { Detener "La huella previa termino con codigo $($r.Codigo): $($r.Salida)" }
$fh = Join-Path $global:Dir "huella_previa_$sello.txt"
Set-Content -Path $fh -Value $r.Salida -Encoding UTF8
$h = Parsear-ClaveValor $r.Salida
if ($h.Count -ne 17) { Detener "La huella debia tener 17 tablas y tiene $($h.Count)." }
foreach ($k in $h.Keys | Sort-Object) { Info ("{0} = {1} filas" -f $k, $h[$k].Split(':')[0]) }
Ok 'Huella previa: 17 tablas (conteo + md5 de columnas de negocio)'

Poner-Estado 'paso5' @{ ok = $true; definiciones = (Split-Path $fd -Leaf); definiciones_sha256 = (Hash-Archivo $fd); funciones = $funciones; politicas = $politicas; politicas_ausentes = $ausentes; politicas_detalle = $detallePoliticas; migracion_20261002000008 = $registrada08; check = $check; huella = (Split-Path $fh -Leaf); huella_sha256 = (Hash-Archivo $fh); tablas_huella = $h.Count; huella_valores = $h }
Write-Host ''
Write-Host 'PASO 5 COMPLETO. Siga con 06-verificar-y-manifiesto.ps1' -ForegroundColor Green
