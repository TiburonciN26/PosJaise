# PASO 4 - Descarga de los archivos de Storage (separada de la base). SOLO LECTURA: solo GET/POST de listado; no sube, borra ni modifica.
# Pide la clave service_role en SU terminal (oculta). La clave no se imprime ni se guarda.
. "$PSScriptRoot\00-comun.ps1"
Cargar-Corrida; Exigir-Sesion; Exigir-Paso 'paso3'
Write-Host ''
Write-Host 'PASO 4 - Archivos de Storage' -ForegroundColor Cyan
$base = if ($env:JAISE_STORAGE_BASE) { $env:JAISE_STORAGE_BASE } else { "https://$Ref.supabase.co/storage/v1" }

# Lo que dice la base (referencia para cuadrar)
$r = Pg 'psql' @('-At', '-v', 'ON_ERROR_STOP=1', '-f', '/sql/storage-conteo.sql')
if ($r.Codigo -ne 0) { Detener "No se pudo leer el conteo de Storage de la base (codigo $($r.Codigo)): $($r.Salida)" }
$db = @{}
foreach ($l in ($r.Salida -split "`n")) { $p = $l.Split('|'); if ($p.Count -eq 3) { $db[$p[0]] = @{ Objetos = [int]$p[1]; Bytes = [int64]$p[2] } } }
if ($db.Count -eq 0) { Detener 'La base no informa buckets de Storage.' }
Ok "La base informa $($db.Count) buckets y $((($db.Values | ForEach-Object { $_.Objetos }) | Measure-Object -Sum).Sum) objetos"

# Clave
if ($env:JAISE_SERVICE_KEY) { $k = $env:JAISE_SERVICE_KEY }
else {
    $segura = Read-Host 'Clave service_role de Storage (no se mostrara)' -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($segura)
    try { $k = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}
if (-not $k) { Detener 'No se recibio la clave.' }
$h = @{ apikey = $k; Authorization = "Bearer $k" }

try {
    $buckets = Invoke-RestMethod -Method Get -Uri "$base/bucket" -Headers $h
} catch { Detener "No se pudo listar los buckets (la clave o la URL no son correctas): $($_.Exception.Message)" }
$nombres = @($buckets | ForEach-Object { $_.id })
$faltan = @($db.Keys | Where-Object { $nombres -notcontains $_ })
$sobran = @($nombres | Where-Object { -not $db.ContainsKey($_) })
if ($faltan.Count -or $sobran.Count) { Detener "Los buckets de la API no coinciden con los de la base. Faltan: $($faltan -join ',') Sobran: $($sobran -join ',')" }
Ok "Buckets de la API = buckets de la base ($($nombres.Count))"

$global:ObjetosStorage = New-Object System.Collections.Generic.List[object]
function Listar-Storage([string]$bucket, [string]$prefijo, [int]$nivel = 0) {
    if ($nivel -gt 20) { throw "Carpetas anidadas a mas de 20 niveles en el bucket $bucket" }
    $offset = 0
    do {
        $cuerpo = @{ prefix = $prefijo; limit = 100; offset = $offset; sortBy = @{ column = 'name'; order = 'asc' } } | ConvertTo-Json -Depth 4
        $respuesta = Invoke-RestMethod -Method Post -Uri "$base/object/list/$bucket" -Headers $h -ContentType 'application/json' -Body $cuerpo
        # Windows PowerShell 5.1 entrega un arreglo JSON como UN solo objeto: se desenrolla elemento por elemento
        $pagina = @($respuesta | ForEach-Object { $_ } | Where-Object { $null -ne $_ -and $_.name })
        foreach ($it in $pagina) {
            $ruta = if ($prefijo) { "$prefijo/$($it.name)" } else { $it.name }
            if ($null -eq $it.id) { Listar-Storage $bucket $ruta ($nivel + 1) }
            else { $global:ObjetosStorage.Add([pscustomobject]@{ Bucket = $bucket; Ruta = $ruta; Bytes = [int64]$it.metadata.size }) }
        }
        $offset += $pagina.Count
    } while ($pagina.Count -eq 100)
}
try { foreach ($b in $nombres) { Listar-Storage $b '' } } catch { Detener "Fallo al listar objetos: $($_.Exception.Message)" }
Ok "Listados $($global:ObjetosStorage.Count) objetos"

$sello = Sello-Utc
# Si un intento anterior se interrumpio, su carpeta parcial se CONSERVA con otro nombre (nunca se borra)
if ($global:Estado.PSObject.Properties.Name -notcontains 'paso4') {
    Get-ChildItem -Path $global:Dir -Directory -Filter 'storage_*' | Where-Object { $_.Name -notlike '*INCOMPLETO*' } | ForEach-Object {
        Rename-Item -Path $_.FullName -NewName ($_.Name + '_INCOMPLETO_' + $sello)
    }
    Get-ChildItem -Path $global:Dir -File -Filter 'storage_indice_*' | Where-Object { $_.Name -notlike '*INCOMPLETO*' } | ForEach-Object { Rename-Item -Path $_.FullName -NewName ($_.Name + '.INCOMPLETO_' + $sello) }
}
$destino = Join-Path $global:Dir "storage_$sello"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$indice = New-Object System.Collections.Generic.List[object]
$n = 0
foreach ($o in $global:ObjetosStorage) {
    $n++
    $hoja = ($o.Ruta -split '/')[-1] -replace '[<>:"/\\|?*]', '_'
    $carpeta = Join-Path $destino $o.Bucket
    New-Item -ItemType Directory -Force -Path $carpeta | Out-Null
    $local = Join-Path $carpeta ('{0:000000}__{1}' -f $n, $hoja)
    $rutaUrl = (($o.Ruta -split '/') | ForEach-Object { [uri]::EscapeDataString($_) }) -join '/'
    try { Invoke-WebRequest -Method Get -Uri "$base/object/authenticated/$($o.Bucket)/$rutaUrl" -Headers $h -OutFile $local -UseBasicParsing | Out-Null }
    catch { Detener "Fallo al descargar el objeto $n de $($global:ObjetosStorage.Count) (bucket $($o.Bucket)): $($_.Exception.Message)" }
    $len = (Get-Item $local).Length
    if ($len -ne $o.Bytes) { Detener "El objeto $n (bucket $($o.Bucket)) mide $len bytes y el listado decia $($o.Bytes)." }
    $indice.Add([pscustomobject]@{ bucket = $o.Bucket; ruta_original = $o.Ruta; archivo_local = $local.Substring($global:Dir.Length + 1); bytes = $len; sha256 = (Hash-Archivo $local) })
}
$k = $null; $h = $null; $segura = $null
$indice | Export-Csv -Path (Join-Path $global:Dir "storage_indice_$sello.csv") -NoTypeInformation -Encoding UTF8
Ok "Descargados $n objetos"

# Cuadre: disco = listado de la API = base, por bucket
$porBucket = @()
foreach ($b in ($nombres | Sort-Object)) {
    $d = @($indice | Where-Object { $_.bucket -eq $b })
    $bytesDisco = [int64](($d | Measure-Object -Property bytes -Sum).Sum)
    if ($d.Count -ne $db[$b].Objetos) { Detener "Bucket ${b}: descargados $($d.Count) objetos y la base informa $($db[$b].Objetos)." }
    if ($bytesDisco -ne $db[$b].Bytes) { Detener "Bucket ${b}: descargados $bytesDisco bytes y la base informa $($db[$b].Bytes)." }
    $porBucket += [pscustomobject]@{ bucket = $b; objetos = $d.Count; bytes = $bytesDisco }
    Ok "Bucket ${b}: $($d.Count) objetos, $bytesDisco bytes (coincide con la base)"
}
Poner-Estado 'paso4' @{ ok = $true; carpeta = "storage_$sello"; objetos = $n; bytes = [int64](($indice | Measure-Object -Property bytes -Sum).Sum); buckets = $porBucket; coincide_con_base = $true; indice = "storage_indice_$sello.csv" }
Write-Host ''
Write-Host 'PASO 4 COMPLETO. Siga con 05-definiciones-y-huella.ps1' -ForegroundColor Green
